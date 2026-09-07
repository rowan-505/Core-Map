import { z } from "zod";

export const SURVEY_SESSION_PAGE_SIZE = 20;
export const SURVEY_SESSION_MAX_PAGE_SIZE = 100;

export const surveySessionCreateBodySchema = z.object({
    clientSessionId: z.string().uuid(),
    routeVariantPublicId: z.string().uuid(),
    snapshotRevision: z.string().trim().min(1).max(80),
    startedAt: z.coerce.date(),
});

export const surveySessionEndBodySchema = z.object({
    endedAt: z.coerce.date(),
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
