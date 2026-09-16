import { z } from "zod";

export const FIELD_ASSIGNMENT_RATE_LIMIT = { max: 60, timeWindow: "1 minute" };

export const surveyAssignmentStatusSchema = z.enum(["active", "cancelled"]);
export const surveyAssignmentWorkStatusSchema = z.enum([
    "not_started",
    "partial",
    "finished",
]);

export const surveyAssignmentListQuerySchema = z.object({
    status: z.enum(["active", "cancelled", "all"]).default("active"),
    surveyorPublicId: z.string().uuid().optional(),
});

export const surveyAssignmentCreateBodySchema = z.object({
    surveyorPublicId: z.string().uuid(),
    routeVariantPublicId: z.string().uuid(),
    assignedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional(),
});

export const surveyAssignmentUpdateBodySchema = z
    .object({
        assignedDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        dueDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable()
            .optional(),
    })
    .refine((body) => body.assignedDate !== undefined || body.dueDate !== undefined, {
        message: "At least one field is required",
    });

export const surveyAssignmentPublicIdParamSchema = z.object({
    publicId: z.string().uuid(),
});

export type SurveyAssignmentListQuery = z.infer<typeof surveyAssignmentListQuerySchema>;
export type SurveyAssignmentCreateBody = z.infer<typeof surveyAssignmentCreateBodySchema>;
export type SurveyAssignmentUpdateBody = z.infer<typeof surveyAssignmentUpdateBodySchema>;
export type SurveyAssignmentWorkStatus = z.infer<typeof surveyAssignmentWorkStatusSchema>;
