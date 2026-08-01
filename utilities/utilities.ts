import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { dynamo_document_client, TABLE_NAME } from "../index.js";


class ProfileNotFoundError extends Error {
    $metadata: {
        httpStatusCode: number
    }
    constructor(message: string) {
        super(message);
        this.name = "ProfileNotFoundError";
        this.$metadata = {
            httpStatusCode: 404
        }
    }
}

export const getProfileForUserID = async (userID: string) => {
    const getProfileResponse = await dynamo_document_client.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: {
                User_id: userID,
                Item_id: "#PROFILE"
            }
        }))

        if (!getProfileResponse.Item){
            throw new ProfileNotFoundError("Profile not found corresponding to logged in user.")
        }
        return getProfileResponse;
}