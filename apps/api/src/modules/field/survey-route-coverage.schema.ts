import { z } from "zod";

export const FIELD_COVERAGE_RATE_LIMIT = { max: 60, timeWindow: "1 minute" };

export const surveyCoverageWorkStatusSchema = z.enum([
    "not_started",
    "partial",
    "finished",
]);

export const surveyRouteCoverageQuerySchema = z.object({
    surveyorPublicId: z.string().uuid().optional(),
    workStatus: surveyCoverageWorkStatusSchema.optional(),
    routeSearch: z.string().trim().max(64).optional(),
});

export type SurveyRouteCoverageQuery = z.infer<typeof surveyRouteCoverageQuerySchema>;
export type SurveyCoverageWorkStatus = z.infer<typeof surveyCoverageWorkStatusSchema>;
