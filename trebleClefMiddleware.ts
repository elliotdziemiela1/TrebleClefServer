import express, { Request, Response } from "express";
import { z } from "zod";
import { CognitoJwtVerifier } from "aws-jwt-verify";

const NOTE_DURATIONS = [1,2,4,8,16,32]
const USERNAME_MAX_SIZE = 25
const SCORE_NAME_MAX_SIZE = 25
const PRIMARY_GENRE_MAX_SIZE = 25
const PRIMARY_INSTRUMENT_MAX_SIZE = 25
const MAX_SCORES_PER_USER = 20
const MAX_BIO_SIZE = 800

const cognitoVerifier = CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID!,
    tokenUse: "access",
    clientId: process.env.COGNITO_CLIENT_ID!,
});

// Verifies the caller's Cognito access token and derives the user id (sub) from it,
// rather than trusting whatever userID the client claims in the request body.
export async function verifyAuth(req: Request, res: Response, next: Function){
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")){
        return res.status(401).json({
            error: "Missing bearer token."
        })
    }

    const token = authHeader.slice("Bearer ".length);

    try {
        const payload = await cognitoVerifier.verify(token);
        res.locals.userId = payload.sub;
        next();
    } catch (error) {
        return res.status(401).json({
            error: "Invalid or expired token."
        })
    }
}

export const ScoreSchema = z.object({
    measures: z.array(z.object({
        notes: z.array(z.object({
            keys: z.array(z.string()),
            duration: z.union(NOTE_DURATIONS.map((d) => z.literal(d))),
            type: z.string().optional(),
            color: z.string().optional()
        }))
    })),
    clef: z.union([z.literal("treble"), z.literal("bass")])
})
export type ScoreObject = z.infer<typeof ScoreSchema>;

export function validateScore(req: Request, res: Response, next: Function){
    const parsed = ScoreSchema.safeParse(req.body.score);
    if (parsed.success){
        res.locals.parsedScore = parsed.data as ScoreObject;
        next();
    } else {
        return res.status(415).json({
            error: "Invalid score.",
            data: parsed.error.issues
        })
    }
}


const ScoreMetadataSchema = z.object({
    Name: z.string().min(1).max(SCORE_NAME_MAX_SIZE),
    Author_name: z.string().min(1).max(USERNAME_MAX_SIZE),
    // Requires exact UTC format: YYYY-MM-DDTHH:mm:ssZ
    Date_time_created: z.iso.datetime(),
    Date_time_last_edited: z.iso.datetime(),
    Primary_genre: z.string().min(1).max(PRIMARY_GENRE_MAX_SIZE),
    Secondary_genres: z.array(z.string()).optional(),
    Number_of_ratings: z.number().int().nonnegative(),
    Total_number_of_stars: z.number().int().nonnegative(),
    Popularity_score: z.number().nonnegative(),
    Total_measures: z.number().int().positive(),
    BPM: z.number().int().positive(),
    Primary_instrument: z.string().min(1).max(PRIMARY_INSTRUMENT_MAX_SIZE),
    Secondary_instruments: z.array(z.string()).optional(),
})
export type ScoreMetaDataObject = z.infer<typeof ScoreMetadataSchema>

export function validateScoreMetadata(req : Request, res: Response, next: Function){
    const parsed = ScoreMetadataSchema.safeParse(req.body.metadata);

    if (parsed.success){
        res.locals.parsedScoreMetadata = parsed.data;
        next();
    } else {
        return res.status(415).json({
            error: "Invalid score metadata.",
            data: parsed.error.issues
        })
    }
}

const ProfileSchema = z.object({
    Email: z.string(),
    Username: z.string().min(1).max(USERNAME_MAX_SIZE),
    Number_of_scores: z.number().int().nonnegative().max(MAX_SCORES_PER_USER),
    Bio: z.string().min(1).max(MAX_BIO_SIZE).optional()
})

export type ProfileSchemaType = z.infer<typeof ProfileSchema>

export function validateProfile(req: Request, res: Response, next: Function){
    const parsed = ProfileSchema.safeParse(req.body.profile)
    if (!parsed.success){
        return res.status(415).json({
            error: "Invalid profile",
            data: parsed.error.message
        })
    }
    res.locals.parsedProfile = parsed.data;
    next();
}