// access patterns:
//
// For scores we want to be able to fetch the metadata for a score for search results, but not the massive
// score itself. For that we have 2 sort key formats in the table: Meta and Data. 
// For user profiles, we have the Profile sort key format. 
// Meta and Data entries are linked via their item ids. The item ids for the data and meta entries for a particular 
// score will be the same. Ex: #SCORE1234#META and #SCORE1234#DATA
// We also want to view popular scores for a genre. For that we need a GSI with PK = primary genre, and SK = popularity
// We also want to view popular scores for an instrument. For that we need a GSI with PK = primary instrument,
// and SK = popularity
// For usernames, we will add a new PK type #HANDLE<username> with SK #RESERVED that signifies that a username is in use.
// When deleting a user or changing their username, we will query the table for their handle and delete the item.
//
// Main Table:
//  Partition key: user_id : "S"
//  Second PK format: #HANDLE<username>
//  Sort Key: #SCORE<score_id>#META : "S"
//  Second Sort Key format: #SCORE<score_id>#DATA
//  Third Sort Key format: #PROFILE
//  Fourth Sort Key format: #RESERVED // used for #HANDLE pk
//
//
//  For #META suffix:
//  Attribute: Name : "S" // application wont enforce as unique
//  Attribute: AuthorName: "S"
//  Attribute: DateTime created : "S"
//  Attribute: DateTime last edited : "S"
//  Attribute: Primary Genre : "S"
//  Attribute: Secondary Genres : "SS" (string set)
//  Attribute: NumberOfRatings: "N"
//  Attribute: TotalNumberOfStars: "N"
//  Attribute: PopularityScore : "N"  // will be a funtion of average number of stars and the total number of ratings
//  // Each rating will be from 1-5 stars. 
//  Attribute: TotalMeasures : "N"
//  Attribute: BPM : "N"
//  Attribute: Primary Instrument : "S"
//  Attribute: Secondary Instruments : "SS"
//
//  For #DATA suffix:
//  Attribute: Score object (not EditorScore) : "M" (Map)
//  
//  For #PROFILE suffix:
//  Attribute: Email : "S"
//  Attribute: Username : "S"
//  Attribute: NumberOfScores: "N"
//  Attribute: Bio : "S"
//  // In client code, will fetch all META objects and aggregate their ratings into a user rating.
//  // Can add more later
//
// Scores GSI for genre:
//  Partition key: Primary Genre : "S"
//  Sort Key: PopularityScore : "N"
//  Projected Attribute: Name : "S"
//  Projected Attribute: AuthorName : "S"
//  Projected Attribute: NumberOfRatings : "N"
//  Projected Attribute: TotalNumberOfStars : "N"
//  Projected Attribute: DateTime created : "S"
//  Projected Attribute: Secondary Genres : "SS"
//  Projected Attribute: TotalMeasures : "N"
//  Projected Attribute: BPM : "N"
//  Projected Attribute: Primary Instrument : "S"
//  Projected Attribute : Secondary Instruments : "SS"
//  Partition Key of user_id will automatically be projected
//  Sort key containing score_id will automatically be projected
//
// Scores GSI for instrument:
//  Partition key: Primary Instrument : "S"
//  Sort Key: PopularityScore : "N"
//  Projected Attribute: Name : "S"
//  Projected Attribute: AuthorName : "S"
//  Projected Attribute: NumberOfRatings : "N"
//  Projected Attribute: TotalNumberOfStars : "N"
//  Projected Attribute: DateTime created : "S"
//  Projected Attribute: Secondary Instruments : "SS"
//  Projected Attribute: TotalMeasures : "N"
//  Projected Attribute: BPM : "N"
//  Projected Attribute: Primary Genre : "S"
//  Projected Attribute : Secondary Genres : "SS"
//  Partition Key of user_id will automatically be projected
//  Sort key containing score_id will automatically be projected


import type { Request, Response } from "express";
import express from "express";
import { ProfileSchemaType, validateProfile, validateScore, validateScoreMetadata, verifyAuth } from "./trebleClefMiddleware";
import { z } from "zod";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ReturnValue, ReturnValuesOnConditionCheckFailure, TransactWriteItem } from "@aws-sdk/client-dynamodb";


const cors = require("cors")
const TABLE_NAME = "Treble_Clef"

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");

const awsRegion = process.env.MY_AWS_REGION?.trim();
const awsAccessKeyId = process.env.MY_AWS_ACCESS_KEY_ID?.trim();
const awsSecretAccessKey = process.env.MY_AWS_SECRET_ACCESS_KEY?.trim();
const awsSessionToken = process.env.MY_AWS_SESSION_TOKEN?.trim();

const dynamoClientConfig = {
    region: awsRegion,
    credentials: {
        accessKeyId: awsAccessKeyId!,
        secretAccessKey: awsSecretAccessKey!,
        ...(awsSessionToken ? { sessionToken: awsSessionToken } : {}),
    }
}

const dynamo_client = new DynamoDBClient(dynamoClientConfig)
const dynamo_document_client = DynamoDBDocumentClient.from(dynamo_client);


const app = express();
app.use(cors({origin: ["http://localhost:5173", "https://treble-clef.vercel.app"], credentials: true}))
app.use(express.json());
app.use(verifyAuth);

app.get("/", (req: Request, res: Response) => res.send("hello world"));

app.get("/test", (req : Request, res: Response) => {
    return res.status(200).json({
        error: null,
        data: "Test endpoint working."
    });
});

const updateProfileWithNewHandleTransactionBody = (profile: ProfileSchemaType, userID: string, assertProfileNotExits: boolean) => [
    {
        Put: {
            TableName : TABLE_NAME,
            Item : {
                User_id : `#HANDLE${profile.Username}`,
                Item_id : "#RESERVED"
            },
            ConditionExpression: "attribute_not_exists(User_id)"
        }
    },
    {
        
        Put: (assertProfileNotExits ? {
            TableName: TABLE_NAME,
            Item: {
                User_id: userID, 
                Item_id: "#PROFILE",
                ...profile
            },
            ConditionExpression: "attribute_not_exists(User_id)",
        } : {
            TableName: TABLE_NAME,
            Item: {
                User_id: userID, 
                Item_id: "#PROFILE",
                ...profile
            },
        })
    }
]

// creates a user's profile and reserves their desired username.
app.post("/users/profile", validateProfile, async (req: Request, res: Response) => {
    const profile = res.locals.parsedProfile;
    const userID = res.locals.userId
    profile.Number_of_scores = 0;
    
    try {
        const response = await dynamo_document_client.send(new TransactWriteCommand({
            "TransactItems": updateProfileWithNewHandleTransactionBody(profile, userID, true)
        }))
        return res.status(200).json({
            error: null,
            data: "Successfully created profile."
        })
    } catch (err : any) {
        if (err.name == "TransactionCanceledException"){
            let messages : string[] = [];
            // collect the preexistance of item errors into array
            err.CancellationReasons.forEach((element : any, index : number) => {
                if (element.Code == "ConditionalCheckFailed"){
                    if (index === 0)
                        messages.push("Username is already in use. ")
                    else if (index === 1)
                        messages.push("Profile already exists for current user.")
                }
            });
            return res.status(400).json({
                error: "Preexistance of username or profile",
                data: messages
            })
        } else {
            return res.status(500).json({
                error: err.name,
                data: err.message
            })
        }
    }
})


//
// TODO
// when updating username, need to update the author name of all scores for this user.
//

// updates a user's profile.
app.put("/users/profile", validateProfile, async (req: Request, res: Response) => {
    const profile = res.locals.parsedProfile;
    const userID = res.locals.userId
    
    try {
        // fetch current profile for this userID in db
        const getProfileResponse = await dynamo_document_client.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: {
                User_id: userID,
                Item_id: "#PROFILE"
            }
        }))
        if (!getProfileResponse.Item){
            return res.status(404).json({
                error: "Profile not found.",
                data: "This profile doesn't exist yet."
            })
        }

        // For now, disable email changes
        if (profile.Email !== getProfileResponse.Item.Email){
            return res.status(400).json({
                error: "Disabled Feature",
                data: "Email changes are currently disabled."
            })
        }

        // if no username update needed, just the profile
        if (profile.Username === getProfileResponse.Item.Username){
            // simply put the profile
            await dynamo_document_client.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: {
                    User_id: userID, 
                    Item_id: "#PROFILE",
                    ...profile
                },
            }))
        } else { // else we are updating the username and the profile
            // check if new username is available
            const nameCheckResponse = await dynamo_document_client.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: {
                    "User_id": "#HANDLE" + profile.Username,
                    "Item_id": "#RESERVED"
                }
            }))
            // if the new desired new username is already taken
            if (!!nameCheckResponse.Item){
                return res.status(400).json({
                    error: "Username Taken",
                    data: "The updated username you provided is already taken"
                })
            }

            // delete the old username reservation
            await dynamo_document_client.send(new DeleteCommand({
                TableName: TABLE_NAME,
                Key: {
                    User_id: "#HANDLE" + getProfileResponse.Item.Username,
                    Item_id: "#RESERVED"
                }
            }))
            
            // Create new profile and username reservation
            await dynamo_document_client.send(new TransactWriteCommand({
                "TransactItems": [
                    ...updateProfileWithNewHandleTransactionBody(profile,userID,false)
                ]
            }))

            //
            // change author name for all scores owned by this user
            // 
            
            // get all scores owned by this user
            const metaQueryResult = await dynamo_document_client.send(new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "PK = :pk AND SK begins_with(:meta)",
                ExpressionAttributeValues: {
                    ":pk": userID,
                    ":meta": "#META" 
                },
                ProjectionExpression: "SK",
            }))

            // Change the author name of all such scores
            await dynamo_document_client.send(new TransactWriteCommand({
                ...(metaQueryResult.Items?.forEach((itm : any) => {
                    return {
                        Update: {
                            TableName: TABLE_NAME,
                            Key: {
                                "User_id": userID,
                                "Item_id": itm.Item_id
                            },
                            UpdateExpression: "SET #authorName = :authorName",
                            ExpressionAttributeNames: {
                                "#authorName": "Author_name"
                            },
                            ExpressionAttributeValues: {
                                ":authorName": profile.Username
                            }
                        }
                    }
                }))
            }))
            
        }
        return res.status(200).json({
            error: null,
            data: "Successfully updated profile."
        })
    } catch (err : any) {
        return res.status(500).json({
            error: err.name,
            data: err.message
        })
    }
})

// TODO
// 
// need to also increment the user's number of scores attribute.
// Creates a new score entry and a new metadata entry for that score.
app.post("/scores", validateScore, validateScoreMetadata, async (req: Request, res: Response) => {
    if (!req.body.scoreID){
        return res.status(400).json({
            error: "Missing scoreID."
        })
    }

    try {
        await dynamo_document_client.send( new TransactWriteCommand({
            "TransactItems": [
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: {
                            User_id: res.locals.userId,
                            Item_id: `#SCORE${req.body.scoreID}#META`,
                            ...res.locals.parsedScoreMetadata
                        }
                    },
                },
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: {
                            User_id: res.locals.userId,
                            Item_id: `#SCORE${req.body.scoreID}#DATA`,
                            ...res.locals.parsedScore
                        }
                    },
                }
            ]
        }))
    } catch (err : any){
        return res.status(err.$metadata?.httpStatusCode ?? 500).json({
            error: err.name,
            data: err.message
        })
    }

    return res.status(200).json({
        error: null,
        data: "Score saved successfully."
    })
});

// app.delete("/scores:scoreID", async (req: Request, res: Response) => {
    
// })


app.listen(3000, () => console.log("Server is up on port 3000"));

