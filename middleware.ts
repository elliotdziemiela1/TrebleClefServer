import express, { Request, Response } from "express";
import { z } from "zod";

const NOTE_DURATIONS = [1,2,4,8,16,32]
const USERNAME_MAX_SIZE = 25
const SCORE_NAME_MAX_SIZE = 25
const PRIMARY_GENRE_MAX_SIZE = 25
const PRIMARY_INSTRUMENT_MAX_SIZE = 25





export const ScoreSchema = z.object({
    measures: z.object({
        notes: z.array(z.object({
            keys: z.array(z.string()),
            duration: z.union(NOTE_DURATIONS.map((d) => z.literal(d))),
            type: z.string().optional(),
            color: z.string().optional()
        }))
    }),
    clef: z.union([z.literal("treble"), z.literal("bass")])
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
    name: z.string().min(1).max(SCORE_NAME_MAX_SIZE),
    authorName: z.string().min(1).max(USERNAME_MAX_SIZE),
    // Requires exact UTC format: YYYY-MM-DDTHH:mm:ssZ
    dateTimeCreated: z.iso.datetime(),
    dateTimeLastEdited: z.iso.datetime(),
    primaryGenre: z.string().min(1).max(PRIMARY_GENRE_MAX_SIZE),
    secondaryGenres: z.array(z.string()).optional(),
    numberOfRatings: z.number().int().nonnegative(),
    totalNumberOfStars: z.number().int().nonnegative(),
    popularityScore: z.number().nonnegative(),
    totalMeasures: z.number().int().positive(),
    bpm: z.number().int().positive(),
    primaryInstrument: z.string().min(1).max(PRIMARY_INSTRUMENT_MAX_SIZE),
    secondaryInstruments: z.array(z.string()).optional(),
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