import {Router, Request, Response} from "express"
import zod from "zod"
import { validateScore, validateScoreMetadata, MAX_SCORES_PER_USER } from "../middleware/trebleClefMiddleware"
import { dynamo_document_client, TABLE_NAME } from "../index"
import { QueryCommand, TransactWriteCommand, TransactGetCommand,UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getProfileForUserID} from "../utilities/utilities.js"

const router = Router();

router.get("/getScore/:scoreID", async (req: Request, res: Response) => {
    const scoreID = req.params.scoreID;
    try {
        const scoreResponse = await dynamo_document_client.send(new TransactGetCommand({
            TransactItems: [
                {
                    Get: {
                        TableName: TABLE_NAME,
                        Key: {
                            User_id: res.locals.userId,
                            Item_id: `#SCORE#META${scoreID}`
                        },
                        ProjectionExpression: "Author_name, #Name, Primary_genre, Primary_instrument, Secondary_instruments, " +
                        "Secondary_genres, Popularity_score, Number_of_ratings, Total_number_of_stars, DateTime_created, " +
                        "BPM, Total_measures",
                        ExpressionAttributeNames: {
                            "#Name": "Name"
                        },
                    }
                },
                {
                    Get: {
                        TableName: TABLE_NAME,
                        Key: {
                            User_id: res.locals.userId,
                            Item_id: `#SCORE#DATA${scoreID}`
                        },
                        ProjectionExpression: "measures, clef"
                    }
                }
            ]
        }))
        if (scoreResponse.Responses.length < 2 || !scoreResponse.Responses[0].Item || !scoreResponse.Responses[1].Item){
            return res.status(404).json({
                error: "Score not found.",
                data: `No score with this id found for this user.`
            })
        }
        return res.status(200).json({
            error: null,
            data: {
                metadata: scoreResponse.Responses[0].Item,
                score: scoreResponse.Responses[1].Item
            }
        })
    } catch (err : any) {
        return res.status(500).json({
            error: err.message,
            data: null
        })
    }
})

router.get("/allMyScoreMetadatas", async (req: Request, res: Response) => {
    try {
        const getAllScoresResponse = await dynamo_document_client.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :scoreMeta)",
            ProjectionExpression: "Item_id, Author_name, #Name, Primary_genre, Primary_instrument, Secondary_instruments, " +
            "Secondary_genres, Popularity_score, Number_of_ratings, Total_number_of_stars, Date_time_created, " +
            "BPM, Total_measures",
            ExpressionAttributeNames: {
                "#pk": "User_id",
                "#sk": "Item_id",
                "#Name": "Name"
            },
            ExpressionAttributeValues: {
                ":pk": res.locals.userId,
                ":scoreMeta": "#SCORE#META",
            },
        }))
        if (getAllScoresResponse.Count == 0){
            return res.status(404).json({
                error: "No scores found.",
                data: "No scores found for this user."
            })
        }
        let filteredItems = getAllScoresResponse.Items?.map((item : any) => {
            const scoreID = item.Item_id.slice("#SCORE#META".length);
            return {
                scoreID: scoreID,
                ...item
            }
        })
        return res.status(200).json({
            error: null,
            data: filteredItems
        })
    } catch (err : any) {
        if (err.name == "ResourceNotFoundException"){
            return res.status(404).json({
                error: "User profile not found.",
                data: "No profile found for this user. Please create a profile first."
            })
        }
        return res.status(500).json({
            error: "An error has occurred while retrieving your scores.",
            data: err.message
        })
    }
})


router.post("/", validateScore, validateScoreMetadata, async (req: Request, res: Response) => {
    if (!req.body.scoreID){
        return res.status(400).json({
            error: "Missing scoreID.",
            data: "You must provide a scoreID for the score you are trying to save."
        })
    }

    // validate score id
    if (!zod.uuidv4().safeParse(req.body.scoreID).success){
        return res.status(400).json({
            error: "Invalid scoreID.",
            data: "The scoreID you provided is not a valid UUIDv4."
        })
    }

    try {

        // get current user's profile to check if they have exceeded their max number of scores
        const getProfileResponse = await getProfileForUserID(res.locals.userId); // will throw error if profile doesn't exist

        if (getProfileResponse.Item.Number_of_scores >= MAX_SCORES_PER_USER){
            return res.status(400).json({
                error: "Max number of scores reached.",
                data: "You have reached the maximum number of scores allowed for your account."
            })
        }

        // check that provided author name matches the author name of the user's profile
        if (res.locals.parsedScoreMetadata.Author_name !== getProfileResponse.Item.Username){
            return res.status(400).json({
                error: "Author name mismatch.",
                data: "The author name provided in the score metadata does not match your profile."
            })
        }
        
        await dynamo_document_client.send( new TransactWriteCommand({
            "TransactItems": [
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: {
                            User_id: res.locals.userId,
                            Item_id: `#SCORE#META${req.body.scoreID}`,
                            ...res.locals.parsedScoreMetadata
                        },
                        ConditionExpression: "attribute_not_exists(#User_id) AND attribute_not_exists(#Item_id)",
                        ExpressionAttributeNames: {
                            "#User_id": "User_id",
                            "#Item_id": "Item_id"
                        }
                    },
                },
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: {
                            User_id: res.locals.userId,
                            Item_id: `#SCORE#DATA${req.body.scoreID}`,
                            ...res.locals.parsedScore
                        },
                        ConditionExpression: "attribute_not_exists(#User_id) AND attribute_not_exists(#Item_id)",
                        ExpressionAttributeNames: {
                            "#User_id": "User_id",
                            "#Item_id": "Item_id"
                        }
                    },
                }
            ]
        }))

        // increment the user's number of scores
        await dynamo_document_client.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
                User_id: res.locals.userId,
                Item_id: "#PROFILE"
            },
            UpdateExpression: "SET #numScores = #numScores + :inc",
            ExpressionAttributeNames: {
                "#numScores": "Number_of_scores"
            },
            ExpressionAttributeValues: {
                ":inc": 1
            }
        }))
    } catch (err : any){
        if (err.name == "TransactionCanceledException"){
            let messages : string[] = [];
            // collect the preexistance of item errors into array
            err.CancellationReasons.forEach((element : any, index : number) => {
                if (element.Code == "ConditionalCheckFailed"){
                    if (index === 0)
                        messages.push("A score metadata item with this scoreID already exists for this user.");
                    if (index === 1)
                        messages.push("A score data item with this scoreID already exists for this user.");
                }
            });
            return res.status(400).json({
                error: "Score with this id already exists for this user.",
                data: messages.join(" ")
            })
        }
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

router.put("/", validateScore, validateScoreMetadata, async (req: Request, res: Response) => {
    if (!req.body.scoreID){
        return res.status(400).json({
            error: "Missing scoreID.",
            data: "You must provide a scoreID for the score you are trying to save."
        })
    }

    // validate score id
    if (!zod.uuidv4().safeParse(req.body.scoreID).success){
        return res.status(400).json({
            error: "Invalid scoreID.",
            data: "The scoreID you provided is not a valid UUIDv4."
        })
    }

    try {
        // check that provided author name matches the author name of the user's profile
        const getProfileResponse = await getProfileForUserID(res.locals.userId); // will throw error if profile doesn't exist

        if (res.locals.parsedScoreMetadata.Author_name !== getProfileResponse.Item.Username){
            return res.status(400).json({
                error: "Author name mismatch.",
                data: "The author name provided in the score metadata does not match your profile."
            })
        }

        await dynamo_document_client.send( new TransactWriteCommand({
            "TransactItems": [
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: {
                            User_id: res.locals.userId,
                            Item_id: `#SCORE#META${req.body.scoreID}`,
                            ...res.locals.parsedScoreMetadata
                        },
                        ConditionExpression: "attribute_exists(#User_id) AND attribute_exists(#Item_id)",
                        ExpressionAttributeNames: {
                            "#User_id": "User_id",
                            "#Item_id": "Item_id"
                        }
                    },
                },
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: {
                            User_id: res.locals.userId,
                            Item_id: `#SCORE#DATA${req.body.scoreID}`,
                            ...res.locals.parsedScore
                        },
                        ConditionExpression: "attribute_exists(#User_id) AND attribute_exists(#Item_id)",
                        ExpressionAttributeNames: {
                            "#User_id": "User_id",
                            "#Item_id": "Item_id"
                        }
                    },
                }
            ]
        }))
    } catch (err : any){
        if (err.name == "TransactionCanceledException"){
            let messages : string[] = [];
            // collect the preexistance of item errors into array
            err.CancellationReasons.forEach((element : any, index : number) => {
                if (element.Code == "ConditionalCheckFailed"){
                    if (index === 0)
                        messages.push("A score metadata item with this scoreID does not exist for this user.");
                    if (index === 1)
                        messages.push("A score data item with this scoreID does not exist for this user.");
                }
            });
            return res.status(400).json({
                error: "Score not found.",
                data: messages.join(" ")
            })
        }
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

router.delete("/:scoreID", async (req: Request, res: Response) => {
    if (!req.params.scoreID){
        return res.status(400).json({
            error: "Missing scoreID",
            data: "You must provide a scoreID in the request parameters."
        })
    }
    // send a delete transaction to delete both the score metadata and score data items for this user
    // Also, decrement the user's number of scores in their profile item
    try {
        await dynamo_document_client.send(new TransactWriteCommand({
            TransactItems: [
                // delete score metadata
                {
                    Delete: {
                        TableName: TABLE_NAME,
                        Key: {
                            User_id: res.locals.userId,
                            Item_id: `#SCORE#META${req.params.scoreID}`
                        }
                    }
                },
                // delete score data
                {
                    Delete: {
                        TableName: TABLE_NAME,
                        Key: {
                            User_id: res.locals.userId,
                            Item_id: `#SCORE#DATA${req.params.scoreID}`
                        },
                        ConditionExpression: "attribute_exists(#User_id) AND attribute_exists(#Item_id)",
                        ExpressionAttributeNames: {
                            "#User_id": "User_id",
                            "#Item_id": "Item_id"
                        }
                    }
                },
                // update user profile to decrement number of scores
                {
                    Update: {
                        TableName: TABLE_NAME,
                        Key: {
                            User_id: res.locals.userId,
                            Item_id: "#PROFILE"
                        },
                        UpdateExpression: "SET #numScores = #numScores - :dec",
                        ExpressionAttributeNames: {
                            "#numScores": "Number_of_scores"
                        },
                        ExpressionAttributeValues: {
                            ":dec": 1
                        }
                    }
                }
            ]
        }))

        res.status(200).json({
            error: null,
            data: "Score deleted successfully."
        })
    } catch (err : any) {
        if (err.name == "TransactionCanceledException"){
            let messages : string[] = [];
            // collect the preexistance of item errors into array
            if (!!err.CancellationReasons[1] && err.CancellationReasons[1].Code == "ConditionalCheckFailed"){
                messages.push("A score data item with this scoreID does not exist for this user.");
            }
            return res.status(400).json({
                error: "Score not found.",
                data: messages.join(" ")
            })
        }
        return res.status(err.$metadata?.httpStatusCode ?? 500).json({
            error: err.name,
            data: err.message
        })
    }
})
export default router;