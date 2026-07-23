import express, { Request, Response } from "express";
import { z } from "zod";

const NOTE_DURATIONS = [1,2,4,8,16,32]
const USERNAME_MAX_SIZE = 25
const SCORE_NAME_MAX_SIZE = 25
const PRIMARY_GENRE_MAX_SIZE = 25
const PRIMARY_INSTRUMENT_MAX_SIZE = 25



export function validateUserID(req: Request, res: Response, next: Function){
    if (!req.body.userID){
        return res.status(400).json({
            error: "Missing userID."
        })
    } else {
        next();
    }
}

export const ScoreSchema = z.object({
    Masures: z.object({
        Notes: z.array(z.object({
            Keys: z.array(z.string()),
            Duration: z.union(NOTE_DURATIONS.map((d) => z.literal(d))),
            Type: z.string().optional(),
            Color: z.string().optional()
        }))
    }),
    Clef: z.union([z.literal("treble"), z.literal("bass")])
})
export type ScoreObject = z.infer<typeof ScoreSchema>;

export function validateScore(req: Request, res: Response, next: Function){
    const parsed = ScoreSchema.safeParse(req.body.score);
    if (parsed.success){
        res.locals.parsedScore = parsed.data as ScoreObject;
        next();
    } else {
        return res.status(400).json({
            error: "Invalid score.",
            details: parsed.error.issues
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
        return res.status(400).json({
            error: "Invalid score metadata.",
            details: parsed.error.issues
        })
    }
}