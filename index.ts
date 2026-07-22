// access patterns:
//
// For scores we want to be able to fetch the metadata for a score for search results, but not the massive
// score itself. For that we have 2 sort key formats in the table: Meta and Data. For user profiles, we have
// the Profile sort key format. 
// We also want to view popular scores for a genre. For that we need a GSI with PK = primary genre, and SK = popularity
// We also want to view popular scores for an instrument. For that we need a GSI with PK = primary instrument,
// and SK = popularity
//
// Main Table:
//  Partition key: user_id : "S"
//  // each user's first score starts with score_id = 1. Each subsequent score increments this, so theres
//  // no need for a LSI with sort key for time created.
//  Sort Key: #SCORE<score_id>#META : "S"
//  Second Sort Key format: #SCORE<score_id>#DATA
//  Third Sort Key formal: #PROFILE
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
import { validateScore, validateScoreMetadata } from "./middleware";
import { z } from "zod";

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");

const dynamo_client = new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
})

const dynamo_document_client = DynamoDBDocumentClient.from(dynamo_client);





const app = express();
app.use(express.json());

app.get("/", (req: Request, res: Response) => res.send("hello world"));

app.post("/scores", validateScore, validateScoreMetadata, (req: Request, res: Response) => {
    
});

app.post("/", )



app.listen(3000, () => console.log("Server is up on port 3000"));

