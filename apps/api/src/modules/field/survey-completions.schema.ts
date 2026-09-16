import { z } from "zod";

export const surveyCompletionVariantParamSchema = z.object({
    routeVariantPublicId: z.string().uuid(),
});

export const surveyCompletionPutBodySchema = z.object({
    finished: z.boolean(),
});

export type SurveyCompletionPutBody = z.infer<typeof surveyCompletionPutBodySchema>;
