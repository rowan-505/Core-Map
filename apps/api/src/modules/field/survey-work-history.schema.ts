import { z } from "zod";

export const FIELD_WORK_HISTORY_RATE_LIMIT = { max: 60, timeWindow: "1 minute" };

export const surveyWorkHistoryQuerySchema = z
    .object({
        surveyorPublicId: z.string().uuid().optional(),
        routeSearch: z.string().trim().max(64).optional(),
        sessionStatus: z.enum(["active", "completed", "abandoned"]).optional(),
        from: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        to: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
        includeShortSessions: z.preprocess((value) => {
            if (value === undefined || value === null || value === "") return false;
            if (value === true || value === "true") return true;
            if (value === false || value === "false") return false;
            return false;
        }, z.boolean()).default(false),
    })
    .superRefine((value, ctx) => {
        if (value.from && value.to && value.from > value.to) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "from must be on or before to",
                path: ["from"],
            });
        }
    });

export const surveySessionTimelineParamSchema = z.object({
    publicId: z.string().uuid(),
});

export type SurveyWorkHistoryQuery = z.infer<typeof surveyWorkHistoryQuerySchema>;
