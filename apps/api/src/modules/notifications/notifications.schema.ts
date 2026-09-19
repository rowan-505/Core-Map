import { z } from "zod";

/** First-release notification types exposed by the API. */
export const NOTIFICATION_TYPES = [
    "post_reaction",
    "post_community_confirmed",
    "post_admin_verified",
    "post_resolved",
    "post_reopened",
    "post_rejected",
    "post_expired",
    "moderation_message",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_PAGE_SIZE = 20;
export const NOTIFICATION_MAX_PAGE_SIZE = 50;

export const notificationsListQuerySchema = z.object({
    cursor: z.string().trim().min(1).max(2_000).optional(),
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(NOTIFICATION_MAX_PAGE_SIZE)
        .default(NOTIFICATION_PAGE_SIZE),
    unreadOnly: z
        .union([z.literal("true"), z.literal("false"), z.boolean()])
        .optional()
        .transform((value) => value === true || value === "true"),
});

export const notificationPublicIdParamSchema = z.object({
    publicId: z.string().trim().uuid(),
});

type NotificationCursor = {
    v: 1;
    createdAt: string;
    publicId: string;
};

export class InvalidNotificationCursorError extends Error {
    constructor() {
        super("Invalid notification cursor");
        this.name = "InvalidNotificationCursorError";
    }
}

export function encodeNotificationCursor(input: {
    createdAt: Date;
    publicId: string;
}): string {
    const payload: NotificationCursor = {
        v: 1,
        createdAt: input.createdAt.toISOString(),
        publicId: input.publicId,
    };
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeNotificationCursor(cursor: string): {
    createdAt: Date;
    publicId: string;
} {
    let value: unknown;
    try {
        value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
        throw new InvalidNotificationCursorError();
    }

    const parsed = z
        .object({
            v: z.literal(1),
            createdAt: z.string().datetime({ offset: true }),
            publicId: z.string().uuid(),
        })
        .safeParse(value);

    if (!parsed.success) {
        throw new InvalidNotificationCursorError();
    }

    return {
        createdAt: new Date(parsed.data.createdAt),
        publicId: parsed.data.publicId,
    };
}

export function isFirstReleaseNotificationType(type: string): type is NotificationType {
    return (NOTIFICATION_TYPES as readonly string[]).includes(type);
}
