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
//  Attribute: EncryptedPassword : "S"
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
import { validateScore, validateScoreMetadata, verifyAuth } from "./trebleClefMiddleware";
import { z } from "zod";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ReturnValue, TransactWriteItem } from "@aws-sdk/client-dynamodb";


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
app.use(cors({origin: ["http://localhost:5173", "https://treble-clef.vercel.app/"], credentials: true}))
app.use(express.json());
app.use(verifyAuth);

app.get("/", (req: Request, res: Response) => res.send("hello world"));

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

app.get("/test", (req : Request, res: Response) => {
    return res.status(200).json({
        error: null,
        data: "Test endpoint working."
    });
});

app.get("/username/:name", async (req: Request, res: Response) => {
    try {
        const resp = await dynamo_document_client.send(new GetCommand(
        {
            TableName : TABLE_NAME,
            Key : {
                User_id : `#HANDLE${req.params.name}`,
                Item_id : "#RESERVED"
            }
        }));
        if (!resp.Item){
            return res.status(404).json({
                result: "false",
                message: "Username not found."
            })
        }
        return res.status(200).json({
            result: "true",
            message: "The username \"" + req.params.name + "\" is in use."
        })
    } catch (err : any){
        return res.status(err.$metadata?.httpStatusCode ?? 500).json({
            error: err.name,
            message: err.message
        })
    }
})

app.post("/username/:name", async (req: Request, res: Response) => {
    try {
        const resp = await dynamo_document_client.send(new PutCommand(
        {
            TableName : TABLE_NAME,
            Item : {
                User_id : `#HANDLE${req.params.name}`,
                Item_id : "#RESERVED"
            },
            ConditionExpression: "attribute_not_exists(User_id)"
        }));
        return res.status(200).json({
            error: null,
            data: "Username successfully reserved."
        })
    } catch (err : any){
        if (err.name == "ConditionalCheckFailedException"){
            return res.status(400).json({
                error: err.name,
                data: "The username \"" + req.params.name + "\" is already in use."
            })
        }
        return res.status(err.$metadata?.httpStatusCode ?? 500).json({
            error: err.name,
            data: err.message
        })
    }
})



//
// TODO
// NEED TO ONLY ALLOW DELETION OF USERNAME BY THE ACCOUNT ASSOCIATED WITH IT


app.delete("/username/:name", async (req : Request, res : Response) => {
    return res.status(100).json(
        {
            error: null,
            message: "username deletion currently disabled."
        }
    )
    try {
        const awsResponse = await dynamo_document_client.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: {
                User_id: `#HANDLE${req.params.name}`,
                Item_id: "#RESERVED"
            }
        }))
        return res.status(200).json({
            error: null,
            data: "Successfully deleted handle reservation: " + req.params.name,

        })
    } catch (err : any) {
        return res.status(err.$metadata?.httpStatusCode ?? 500).json({
            error: err.name,
            data: err.message
        })
    }
})


// app.delete("/scores:scoreID", async (req: Request, res: Response) => {
    
// })


app.listen(3000, () => console.log("Server is up on port 3000"));

