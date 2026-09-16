import { z } from "zod";

import { assertPasswordPolicy } from "./password-policy.js";

const passwordField = (privileged = false) =>
    z
        .string()
        .min(8)
        .max(200)
        .superRefine((value, ctx) => {
            try {
                assertPasswordPolicy(value, { privileged });
            } catch (error) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: error instanceof Error ? error.message : "Invalid password",
                });
            }
        });

export const registerBodySchema = z.object({
    email: z.string().trim().email(),
    displayName: z.string().trim().min(2).max(120),
    password: passwordField(false),
    preferredLanguage: z.enum(["my", "en"]).optional(),
    primaryRegionId: z.number().int().positive().optional(),
});

export const loginBodySchema = z
    .object({
        email: z.string().trim().email().optional(),
        username: z.string().trim().min(3).optional(),
        password: z.string().min(1).max(200),
    })
    .superRefine((value, ctx) => {
        if (!value.email && !value.username) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Either email or username is required",
                path: ["email"],
            });
        }
        if (value.email && value.username) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Provide either email or username",
                path: ["username"],
            });
        }
    });

export const refreshBodySchema = z.object({
    refreshToken: z.string().min(1).optional(),
});

export const logoutBodySchema = z.object({
    refreshToken: z.string().min(1).optional(),
});

export const authUserSchema = z.object({
    public_id: z.string().uuid(),
    email: z.string().email(),
    display_name: z.string(),
    roles: z.array(z.string()),
    // Native clients historically required `id`. It is the public UUID, never the internal bigint.
    id: z.string().uuid().optional(),
});

export const authProfileSchema = z.object({
    public_id: z.string().uuid(),
    email: z.string().email(),
    display_name: z.string(),
    phone: z.string().nullable(),
    roles: z.array(z.string()),
    email_verified: z.boolean(),
    account_status: z.string(),
    primary_region_id: z.string().nullable(),
    preferred_language: z.string(),
    total_points: z.number().int(),
});

export const updateProfileBodySchema = z
    .object({
        displayName: z.string().trim().min(2).max(120).optional(),
        phone: z.string().trim().min(3).max(40).nullable().optional(),
        preferredLanguage: z.enum(["my", "en"]).optional(),
        primaryRegionId: z.number().int().positive().nullable().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
        message: "Provide at least one field to update",
    });

export const sessionResponseSchema = z.object({
    accessToken: z.string(),
    refreshToken: z.string().optional(),
    expiresIn: z.string(),
    user: authUserSchema,
    mfaRequired: z.boolean().optional(),
    mfaToken: z.string().optional(),
});

export const registerResponseSchema = z.object({
    message: z.literal("Account created"),
    user: authProfileSchema,
});

export const logoutResponseSchema = z.object({
    message: z.literal("Logged out"),
});

export const verifyEmailOtpBodySchema = z.object({
    code: z
        .string()
        .trim()
        .regex(/^\d{6}$/, "Code must be 6 digits"),
});

export const emailOtpStatusResponseSchema = z.object({
    status: z.enum(["sent", "verified", "already_verified"]),
});

export const forgotPasswordBodySchema = z.object({
    email: z.string().trim().email(),
});

export const resetPasswordBodySchema = z.object({
    token: z.string().min(20).max(200),
    password: passwordField(false),
});

export const changePasswordBodySchema = z.object({
    currentPassword: z.string().min(1, "Current password is required").max(200),
    // Full length/whitespace policy is enforced in the service (privileged roles need 12+).
    newPassword: z.string().min(1, "New password is required").max(200),
});

export const verifyMfaBodySchema = z.object({
    mfaToken: z.string().min(1),
    code: z.string().trim().min(6).max(20),
});

export const enrollMfaVerifyBodySchema = z.object({
    code: z
        .string()
        .trim()
        .regex(/^\d{6}$/, "Code must be 6 digits"),
});

export const mfaEnrollmentTokenBodySchema = z.object({
    enrollmentToken: z.string().min(1),
});

export const mfaEnrollmentCompleteBodySchema = z.object({
    enrollmentToken: z.string().min(1),
    code: z
        .string()
        .trim()
        .regex(/^\d{6}$/, "Code must be 6 digits"),
});

export const changeEmailBodySchema = z.object({
    password: z.string().min(1).max(200),
    newEmail: z
        .string()
        .trim()
        .min(3)
        .max(254)
        .email("Enter a valid email address")
        .refine((value) => !/^\d+$/.test(value), {
            message: "Enter a valid email address",
        }),
});

export const confirmEmailChangeBodySchema = z.object({
    code: z
        .string()
        .trim()
        .regex(/^\d{6}$/, "Code must be 6 digits"),
});

export const deleteAccountBodySchema = z.object({
    password: z.string().min(1).max(200),
    confirm: z.literal("DELETE"),
});

export const completeProfileSendOtpBodySchema = z.object({
    flowToken: z.string().trim().min(20).max(200),
    email: z
        .string()
        .trim()
        .min(3)
        .max(254)
        .email("Enter a valid email address")
        .refine((value) => !/^\d+$/.test(value), {
            message: "Enter a valid email address",
        }),
});

export const completeProfileVerifyBodySchema = z.object({
    flowToken: z.string().trim().min(20).max(200),
    email: z
        .string()
        .trim()
        .min(3)
        .max(254)
        .email("Enter a valid email address"),
    code: z
        .string()
        .trim()
        .regex(/^\d{6}$/, "Code must be 6 digits"),
});

export const sessionListItemSchema = z.object({
    public_id: z.string().uuid(),
    current: z.boolean(),
    created_at: z.string(),
    last_used_at: z.string().nullable(),
    user_agent: z.string().nullable(),
    device_label: z.string(),
    client_type: z.enum(["web", "dashboard", "android", "ios"]).default("web"),
});

export const securityEventItemSchema = z.object({
    event_type: z.string(),
    success: z.boolean(),
    provider: z.string().nullable(),
    created_at: z.string(),
    ip_address: z.string().nullable(),
});
