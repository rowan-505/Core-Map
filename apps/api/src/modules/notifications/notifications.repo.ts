import {
    Prisma,
    type CommunityNotificationType,
    type CommunityReactionType,
    type PrismaClient,
} from "@prisma/client";

import type { NotificationType } from "./notifications.schema.js";

export type NotificationListRow = {
    publicId: string;
    type: string;
    title: string;
    message: string;
    reactionType: CommunityReactionType | null;
    isRead: boolean;
    createdAt: Date;
    actorPublicId: string | null;
    actorDisplayName: string | null;
    relatedPostPublicId: string | null;
    relatedPostTitle: string | null;
    relatedPostPublicationStatus: string | null;
    relatedPostDeletedAt: Date | null;
};

export type CreateNotificationInput = {
    recipientUserId: bigint;
    actorUserId: bigint | null;
    type: NotificationType;
    eventKey: string;
    title: string;
    message: string;
    relatedPostId: bigint | null;
    reactionType?: CommunityReactionType | null;
};

export type CreateNotificationResult = "created" | "skipped_self" | "skipped_duplicate";

type DbClient = PrismaClient | Prisma.TransactionClient;

export class NotificationsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async findUsableUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM app_auth.auth_users
            WHERE public_id::text = ${publicId}
              AND deleted_at IS NULL
              AND is_active = true
              AND account_status = 'active'
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async countUnread(userId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT COUNT(*)::bigint AS count
            FROM community.notifications
            WHERE user_id = ${userId}
              AND is_read = false
              AND deleted_at IS NULL
        `);
        return Number(rows[0]?.count ?? 0);
    }

    async listForUser(input: {
        userId: bigint;
        limit: number;
        unreadOnly?: boolean;
        cursor?: { createdAt: Date; publicId: string };
    }): Promise<NotificationListRow[]> {
        const where: Prisma.Sql[] = [
            Prisma.sql`n.user_id = ${input.userId}`,
            Prisma.sql`n.deleted_at IS NULL`,
            Prisma.sql`n.type::text = ANY(${NOTIFICATION_TYPE_SQL_ARRAY}::text[])`,
        ];

        if (input.unreadOnly) {
            where.push(Prisma.sql`n.is_read = false`);
        }

        if (input.cursor) {
            where.push(Prisma.sql`
                (n.created_at, n.public_id) < (${input.cursor.createdAt}, ${input.cursor.publicId}::uuid)
            `);
        }

        return this.prisma.$queryRaw<NotificationListRow[]>(Prisma.sql`
            SELECT
                n.public_id::text AS "publicId",
                n.type::text AS type,
                n.title,
                n.message,
                n.reaction_type AS "reactionType",
                n.is_read AS "isRead",
                n.created_at AS "createdAt",
                actor.public_id::text AS "actorPublicId",
                actor.display_name AS "actorDisplayName",
                p.public_id::text AS "relatedPostPublicId",
                p.title AS "relatedPostTitle",
                p.publication_status::text AS "relatedPostPublicationStatus",
                p.deleted_at AS "relatedPostDeletedAt"
            FROM community.notifications n
            LEFT JOIN app_auth.auth_users actor ON actor.id = n.actor_user_id
            LEFT JOIN community.community_posts p ON p.id = n.related_post_id
            WHERE ${Prisma.join(where, " AND ")}
            ORDER BY n.created_at DESC, n.public_id DESC
            LIMIT ${input.limit + 1}
        `);
    }

    async markOneRead(input: {
        userId: bigint;
        publicId: string;
    }): Promise<"updated" | "already_read" | "not_found"> {
        const existing = await this.prisma.$queryRaw<
            { is_read: boolean }[]
        >(Prisma.sql`
            SELECT is_read
            FROM community.notifications
            WHERE public_id::text = ${input.publicId}
              AND user_id = ${input.userId}
              AND deleted_at IS NULL
            LIMIT 1
        `);

        if (!existing[0]) {
            return "not_found";
        }
        if (existing[0].is_read) {
            return "already_read";
        }

        await this.prisma.$executeRaw(Prisma.sql`
            UPDATE community.notifications
            SET is_read = true
            WHERE public_id::text = ${input.publicId}
              AND user_id = ${input.userId}
              AND deleted_at IS NULL
              AND is_read = false
        `);
        return "updated";
    }

    async markAllRead(userId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            WITH updated AS (
                UPDATE community.notifications
                SET is_read = true
                WHERE user_id = ${userId}
                  AND deleted_at IS NULL
                  AND is_read = false
                RETURNING 1
            )
            SELECT COUNT(*)::bigint AS count FROM updated
        `);
        return Number(rows[0]?.count ?? 0);
    }

    /**
     * Idempotent create: skips self-notify and duplicate event_key.
     * Safe inside a community transaction via `client`.
     */
    async createIfAbsent(
        input: CreateNotificationInput,
        client: DbClient = this.prisma
    ): Promise<CreateNotificationResult> {
        if (input.actorUserId !== null && input.actorUserId === input.recipientUserId) {
            return "skipped_self";
        }

        const rows = await client.$queryRaw<{ public_id: string }[]>(Prisma.sql`
            INSERT INTO community.notifications (
                user_id,
                actor_user_id,
                type,
                reaction_type,
                title,
                message,
                related_post_id,
                event_key,
                is_read,
                created_at
            )
            SELECT
                ${input.recipientUserId},
                ${input.actorUserId},
                ${input.type}::community.notification_type,
                ${input.reactionType ?? null}::community.reaction_type,
                ${input.title},
                ${input.message},
                ${input.relatedPostId},
                ${input.eventKey},
                false,
                now()
            WHERE NOT EXISTS (
                SELECT 1
                FROM community.notifications existing
                WHERE existing.user_id = ${input.recipientUserId}
                  AND existing.event_key = ${input.eventKey}
            )
            RETURNING public_id::text AS public_id
        `);

        return rows[0] ? "created" : "skipped_duplicate";
    }
}

/** Keep SQL filter aligned with first-release API types. */
const NOTIFICATION_TYPE_SQL_ARRAY = [
    "post_reaction",
    "post_community_confirmed",
    "post_admin_verified",
    "post_resolved",
    "post_reopened",
    "post_rejected",
    "post_expired",
    "moderation_message",
] as const satisfies readonly CommunityNotificationType[];
