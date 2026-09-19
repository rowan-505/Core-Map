import {
    decodeNotificationCursor,
    encodeNotificationCursor,
    InvalidNotificationCursorError,
    isFirstReleaseNotificationType,
    type NotificationType,
} from "./notifications.schema.js";
import {
    NotificationsRepository,
    type NotificationListRow,
} from "./notifications.repo.js";

export class NotificationsError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code?: string
    ) {
        super(message);
        this.name = "NotificationsError";
    }
}

export type NotificationActorDto = {
    public_id: string;
    display_name: string;
};

export type NotificationRelatedPostDto = {
    public_id: string;
    title: string | null;
    available: boolean;
};

export type NotificationItemDto = {
    public_id: string;
    type: NotificationType;
    title: string;
    message: string;
    reaction_type: string | null;
    is_read: boolean;
    created_at: string;
    actor: NotificationActorDto | null;
    related_post: NotificationRelatedPostDto | null;
};

export type NotificationPageDto = {
    items: NotificationItemDto[];
    next_cursor: string | null;
};

export class NotificationsService {
    constructor(private readonly repo: NotificationsRepository) {}

    async list(
        viewerPublicId: string,
        input: { cursor?: string; limit: number; unreadOnly?: boolean }
    ): Promise<NotificationPageDto> {
        const userId = await this.requireUsableUser(viewerPublicId);
        let cursor: { createdAt: Date; publicId: string } | undefined;
        if (input.cursor) {
            try {
                cursor = decodeNotificationCursor(input.cursor);
            } catch (error) {
                if (error instanceof InvalidNotificationCursorError) {
                    throw new NotificationsError("Invalid cursor", 400, "INVALID_CURSOR");
                }
                throw error;
            }
        }

        const rows = await this.repo.listForUser({
            userId,
            limit: input.limit,
            unreadOnly: input.unreadOnly,
            cursor,
        });
        const hasMore = rows.length > input.limit;
        const page = hasMore ? rows.slice(0, input.limit) : rows;
        const last = page[page.length - 1];
        return {
            items: page.map(toItemDto),
            next_cursor:
                hasMore && last
                    ? encodeNotificationCursor({
                          createdAt: last.createdAt,
                          publicId: last.publicId,
                      })
                    : null,
        };
    }

    async unreadCount(viewerPublicId: string): Promise<{ unread_count: number }> {
        const userId = await this.requireUsableUser(viewerPublicId);
        const unread_count = await this.repo.countUnread(userId);
        return { unread_count };
    }

    async markRead(
        viewerPublicId: string,
        notificationPublicId: string
    ): Promise<{ public_id: string; is_read: true }> {
        const userId = await this.requireUsableUser(viewerPublicId);
        const result = await this.repo.markOneRead({
            userId,
            publicId: notificationPublicId,
        });
        if (result === "not_found") {
            throw new NotificationsError("Notification not found", 404);
        }
        return { public_id: notificationPublicId, is_read: true };
    }

    async markAllRead(viewerPublicId: string): Promise<{ updated_count: number }> {
        const userId = await this.requireUsableUser(viewerPublicId);
        const updated_count = await this.repo.markAllRead(userId);
        return { updated_count };
    }

    private async requireUsableUser(publicId: string): Promise<bigint> {
        const userId = await this.repo.findUsableUserIdByPublicId(publicId);
        if (userId === null) {
            throw new NotificationsError("User account is inactive", 403, "INACTIVE_ACCOUNT");
        }
        return userId;
    }
}

function toItemDto(row: NotificationListRow): NotificationItemDto {
    const type = isFirstReleaseNotificationType(row.type) ? row.type : "moderation_message";

    const related_post = toRelatedPostDto(row);
    const actor =
        row.actorPublicId && row.actorDisplayName
            ? { public_id: row.actorPublicId, display_name: row.actorDisplayName }
            : null;

    return {
        public_id: row.publicId,
        type,
        title: row.title,
        message: row.message,
        reaction_type: row.reactionType,
        is_read: row.isRead,
        created_at: row.createdAt.toISOString(),
        actor,
        related_post,
    };
}

/**
 * Privacy: missing/deleted/non-public posts do not leak titles.
 */
export function toRelatedPostDto(row: NotificationListRow): NotificationRelatedPostDto | null {
    if (!row.relatedPostPublicId) {
        return null;
    }

    const available =
        row.relatedPostDeletedAt === null && row.relatedPostPublicationStatus === "published";

    return {
        public_id: row.relatedPostPublicId,
        title: available ? row.relatedPostTitle : null,
        available,
    };
}
