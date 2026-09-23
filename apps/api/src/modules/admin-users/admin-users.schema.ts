import { z } from "zod";

export const ACCOUNT_STATUSES = ["active", "disabled", "deleted"] as const;
export const ANALYTICS_BUCKETS = ["day", "week", "month"] as const;
export const ADMIN_MANAGED_ROLE_CODES = [
    "user",
    "viewer",
    "surveyor",
    "admin",
    "super_admin",
] as const;

const roleCodeSchema = z
    .string()
    .trim()
    .regex(/^[a-z_]+$/, "Invalid role code");

const passwordSchema = z.string().min(8).max(200);

export const createUserBodySchema = z.object({
    email: z.string().trim().email(),
    displayName: z.string().trim().min(2).max(120),
    password: passwordSchema,
    roleCode: z.enum(ADMIN_MANAGED_ROLE_CODES),
});

export const userPublicIdParamSchema = z.object({
    id: z.string().trim().uuid(),
});

export const userRoleParamSchema = z.object({
    id: z.string().trim().uuid(),
    roleCode: roleCodeSchema,
});

export const listUsersQuerySchema = z.object({
    search: z.string().trim().min(1).max(200).optional(),
    role: roleCodeSchema.optional(),
    emailVerified: z.coerce.boolean().optional(),
    accountStatus: z.enum(ACCOUNT_STATUSES).optional(),
    primaryRegionId: z.coerce.number().int().positive().optional(),
    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const updateStatusBodySchema = z.object({
    accountStatus: z.enum(ACCOUNT_STATUSES),
});

export const updateAdminNoteBodySchema = z.object({
    adminNote: z.string().max(2000).nullable(),
});

export const updateUserProfileBodySchema = z
    .object({
        email: z.string().trim().email().optional(),
        displayName: z.string().trim().min(2).max(120).optional(),
        phone: z.string().trim().min(3).max(40).nullable().optional(),
        preferredLanguage: z.enum(["my", "en"]).optional(),
        primaryRegionId: z.number().int().positive().nullable().optional(),
        emailVerified: z.boolean().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
        message: "Provide at least one field to update",
    });

export const resetUserPasswordBodySchema = z.object({
    password: passwordSchema,
});

export const assignRoleBodySchema = z.object({
    roleCode: roleCodeSchema,
});

export const growthQuerySchema = z.object({
    bucket: z.enum(ANALYTICS_BUCKETS).default("day"),
    days: z.coerce.number().int().min(1).max(365).default(30),
});

export const auditQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
});
