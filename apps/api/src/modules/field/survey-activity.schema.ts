import { z } from "zod";

export const FIELD_ACTIVITY_RATE_LIMIT = { max: 60, timeWindow: "1 minute" };

export const surveyActivityWorkStatusSchema = z.enum([
    "not_started",
    "partial",
    "finished",
]);

export const surveyActivityListQuerySchema = z.object({
    date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    surveyorPublicId: z.string().uuid().optional(),
    workStatus: surveyActivityWorkStatusSchema.optional(),
    routeSearch: z.string().trim().max(64).optional(),
});

export type SurveyActivityListQuery = z.infer<typeof surveyActivityListQuerySchema>;
export type SurveyActivityWorkStatus = z.infer<typeof surveyActivityWorkStatusSchema>;
