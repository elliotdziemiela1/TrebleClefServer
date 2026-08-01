import {Router, Request, Response} from "express"
import zod from "zod"
import { validateScore, validateScoreMetadata, MAX_SCORES_PER_USER, ProfileSchemaType, validateProfile } from "../middleware/trebleClefMiddleware"
import { dynamo_document_client, TABLE_NAME } from "../index"
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getProfileForUserID} from "../utilities/utilities.js"

const router = Router();
    
const updateProfileWithNewHandleTransactionBody = (profile: ProfileSchemaType, userID: string, assertProfileNotExits: boolean) => {
    return [
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
}


// creates a user's profile and reserves their desired username.
router.post("/profile", validateProfile, async (req: Request, res: Response) => {
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


// updates a user's profile.
router.put("/profile", validateProfile, async (req: Request, res: Response) => {
    const profile = res.locals.parsedProfile;
    const userID = res.locals.userId
    
    try {
        const getProfileResponse = await getProfileForUserID(userID); // will throw error if profile doesn't exist

        // For now, disable email changes
        if (profile.Email !== getProfileResponse.Item.Email){
            return res.status(400).json({
                error: "Disabled Feature",
                data: "Email changes are currently disabled."
            })
        }

        // For now, disable number_of_scores changes
        if (profile.Number_of_scores !== getProfileResponse.Item.Number_of_scores){
            return res.status(400).json({
                error: "Inconsistent Number of Scores",
                data: "The number of scores you provided does not match your actual number."
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
                "TransactItems": updateProfileWithNewHandleTransactionBody(profile,userID,false)
            }))

            //
            // change author name for all scores owned by this user
            // 
            
            // get all scores owned by this user
            let metaQueryResult = await dynamo_document_client.send(new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "(#pk = :pk) AND (begins_with(#sk, :score))",
                ExpressionAttributeValues: {
                    ":pk": userID,
                    ":score": "#SCORE"
                },
                ProjectionExpression: "#sk",
                ExpressionAttributeNames: {
                    "#pk": "User_id",
                    "#sk": "Item_id"
                }
            }))

            

            // if there are any scores, update their author names to the new username
            if (metaQueryResult.Count > 0){
                // isolate the metadata entries from the score data entries
                let metaItems = metaQueryResult.Items?.filter((itm : any) =>
                        itm.Item_id.slice(itm.Item_id.length - "#META".length) == "#META"
                )

                const transacts = (metaItems.map((itm : any) => {
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

                // Change the author name of all such scores
                await dynamo_document_client.send(new TransactWriteCommand({
                    TransactItems: transacts
                }))
            }
            
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

export default router;