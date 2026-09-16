import { z } from "zod";

export const SURVEY_SESSION_PAGE_SIZE = 20;
export const SURVEY_SESSION_MAX_PAGE_SIZE = 100;

export const surveySessionTrackingStateSchema = z.enum(["idle", "active"]);
export const surveySessionCompletionStatusSchema = z.enum(["partial", "finished"]);
export const surveySessionLifecycleEventSchema = z.enum(["START", "STOP", "FINISH", "REOPEN"]);

export const surveySessionCreateBodySchema = z.object({
    clientSessionId: z.string().uuid(),
    routeVariantPublicId: z.string().uuid(),
    snapshotRevision: z.string().trim().min(1).max(80),
    startedAt: z.coerce.date(),
    totalStopCount: z.number().int().min(0).max(50_000).optional(),
    clientEventId: z.string().uuid().optional(),
});

export const surveySessionEndBodySchema = z.object({
    endedAt: z.coerce.date(),
    accumulatedActiveSeconds: z.number().int().min(0).max(31_536_000).optional(),
    clientEventId: z.string().uuid().optional(),
});

export const surveySessionSummaryBodySchema = z
    .object({
        accumulatedActiveSeconds: z.number().int().min(0).max(31_536_000),
        lastActivityAt: z.coerce.date(),
        lastCheckedStopSequence: z.number().int().min(0).max(100_000).nullable().optional(),
        checkedStopCount: z.number().int().min(0).max(50_000),
        totalStopCount: z.number().int().min(0).max(50_000),
        pendingSyncCount: z.number().int().min(0).max(50_000),
        lastGpsAccuracyM: z.number().min(0).max(100_000).nullable().optional(),
        lastLat: z.number().min(-90).max(90).nullable().optional(),
        lastLng: z.number().min(-180).max(180).nullable().optional(),
        lastGpsAt: z.coerce.date().nullable().optional(),
        clientSyncState: z.string().trim().min(1).max(40).optional(),
    })
    .superRefine((value, ctx) => {
        const hasLat = value.lastLat != null;
        const hasLng = value.lastLng != null;
        if (hasLat !== hasLng) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "lastLat and lastLng must both be set or both omitted",
            });
        }
    });

export const surveySessionFinishBodySchema = z.object({
    finishedAt: z.coerce.date(),
    stoppedAt: z.coerce.date().optional(),
    accumulatedActiveSeconds: z.number().int().min(0).max(31_536_000).optional(),
    clientEventId: z.string().uuid().optional(),
});

export const surveySessionReopenBodySchema = z.object({
    reopenedAt: z.coerce.date(),
    clientEventId: z.string().uuid().optional(),
});

export const surveySessionClientIdParamSchema = z.object({
    clientSessionId: z.string().uuid(),
});

export const surveySessionPublicIdParamSchema = z.object({
    publicId: z.string().uuid(),
});

export const surveySessionListQuerySchema = z.object({
    cursor: z.string().trim().min(1).max(2_000).optional(),
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(SURVEY_SESSION_MAX_PAGE_SIZE)
        .default(SURVEY_SESSION_PAGE_SIZE),
});

export const fieldReportSurveySessionSchema = z
    .object({
        publicId: z.string().uuid().optional(),
        clientSessionId: z.string().uuid().optional(),
    })
    .superRefine((value, ctx) => {
        if ((value.publicId ? 1 : 0) + (value.clientSessionId ? 1 : 0) !== 1) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Provide exactly one survey session identifier",
            });
        }
    });

export type SurveySessionCreateBody = z.infer<typeof surveySessionCreateBodySchema>;
export type SurveySessionEndBody = z.infer<typeof surveySessionEndBodySchema>;
export type SurveySessionSummaryBody = z.infer<typeof surveySessionSummaryBodySchema>;
export type SurveySessionFinishBody = z.infer<typeof surveySessionFinishBodySchema>;
export type SurveySessionReopenBody = z.infer<typeof surveySessionReopenBodySchema>;
export type SurveySessionIdentifier = z.infer<typeof fieldReportSurveySessionSchema>;

type SurveySessionCursor = {
    v: 1;
    startedAt: string;
    publicId: string;
};

export class InvalidSurveySessionCursorError extends Error {
    constructor() {
        super("Invalid survey session cursor");
        this.name = "InvalidSurveySessionCursorError";
    }
}

export function encodeSurveySessionCursor(input: {
    startedAt: Date;
    publicId: string;
}): string {
    const payload: SurveySessionCursor = {
        v: 1,
        startedAt: input.startedAt.toISOString(),
        publicId: input.publicId,
    };
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeSurveySessionCursor(cursor: string): {
    startedAt: Date;
    publicId: string;
} {
    let value: unknown;
    try {
        value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
        throw new InvalidSurveySessionCursorError();
    }
    const parsed = z
        .object({
            v: z.literal(1),
            startedAt: z.string().datetime({ offset: true }),
            publicId: z.string().uuid(),
        })
        .safeParse(value);
    if (!parsed.success) {
        throw new InvalidSurveySessionCursorError();
    }
    return {
        startedAt: new Date(parsed.data.startedAt),
        publicId: parsed.data.publicId,
    };
}
