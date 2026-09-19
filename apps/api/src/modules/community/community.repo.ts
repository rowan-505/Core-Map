import {
    Prisma,
    type CommunityPublicationStatus,
    type CommunityReactionType,
    type CommunityVerificationStatus,
    type PrismaClient,
} from "@prisma/client";

import { NotificationsRepository } from "../notifications/notifications.repo.js";
import {
    NotificationsWriter,
    type CommunityStatusNotifyAction,
} from "../notifications/notifications.writer.js";

export type CommunityAuthorPublic = {
    publicId: string;
    displayName: string;
};

export type CommunityPostRow = {
    id: bigint;
    publicId: string;
    authorId: bigint;
    title: string;
    description: string;
    topic: string;
    publicationStatus: CommunityPublicationStatus;
    verificationStatus: CommunityVerificationStatus;
    trustScore: number;
    locationLabel: string | null;
    lng: number | null;
    lat: number | null;
    publishedAt: Date;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    authorPublicId: string;
    authorDisplayName: string;
};

export type ReactionCountRow = {
    confirm: number;
    helpful: number;
    incorrect: number;
};

export type ListPostsFilters = {
    feed: "latest" | "trusted" | "mine" | "admin";
    authorId?: bigint;
    category?: string;
    bbox?: { west: number; south: number; east: number; north: number };
    publicationStatus?: CommunityPublicationStatus;
    verificationStatus?: CommunityVerificationStatus;
    /** When true, restrict to Community Confirmed or CoreMap Verified. */
    trustedOnly?: boolean;
    /** When true, restrict to resolved | expired | rejected | removed. */
    closedOnly?: boolean;
    search?: string;
    sort?: "published_at_desc" | "published_at_asc";
    cursor?: { publishedAt: Date; publicId: string };
    limit: number;
    /** When false, include soft-deleted / non-published rows (admin/mine). */
    publicOnly: boolean;
};

export type CommunityAdminCountsRow = {
    needsReview: number;
    live: number;
    trusted: number;
    closed: number;
};

export type UpsertReactionResult = {
    post: CommunityPostRow;
    previousReaction: CommunityReactionType | null;
    nextReaction: CommunityReactionType;
    verificationChanged: boolean;
    autoAction: "community_auto_confirm" | "community_auto_unconfirm" | null;
};

export type RemoveReactionResult = {
    post: CommunityPostRow;
    previousReaction: CommunityReactionType;
    verificationChanged: boolean;
    autoAction: "community_auto_confirm" | "community_auto_unconfirm" | null;
};

export type ModerationActionCode =
    | "verify"
    | "unverify"
    | "reject"
    | "resolve"
    | "expire"
    | "remove"
    | "restore"
    | "community_auto_confirm"
    | "community_auto_unconfirm"
    | "author_update"
    | "author_delete"
    | "other";

type TxClient = Prisma.TransactionClient;

const postSelectSql = Prisma.sql`
    p.id,
    p.public_id AS "publicId",
    p.author_id AS "authorId",
    p.title,
    p.description,
    p.topic,
    p.publication_status AS "publicationStatus",
    p.verification_status AS "verificationStatus",
    p.trust_score AS "trustScore",
    p.location_label AS "locationLabel",
    CASE WHEN p.location IS NULL THEN NULL ELSE ST_X(p.location::geometry) END AS lng,
    CASE WHEN p.location IS NULL THEN NULL ELSE ST_Y(p.location::geometry) END AS lat,
    p.published_at AS "publishedAt",
    p.created_at AS "createdAt",
    p.updated_at AS "updatedAt",
    p.deleted_at AS "deletedAt",
    u.public_id::text AS "authorPublicId",
    u.display_name AS "authorDisplayName"
`;

export class CommunityRepository {
    private readonly notifications: NotificationsWriter;

    constructor(
        private readonly prisma: PrismaClient,
        notificationsWriter?: NotificationsWriter
    ) {
        this.notifications =
            notificationsWriter ??
            new NotificationsWriter(new NotificationsRepository(prisma));
    }

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

    async findUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM app_auth.auth_users
            WHERE public_id::text = ${publicId}
              AND deleted_at IS NULL
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async findPostByPublicId(publicId: string): Promise<CommunityPostRow | null> {
        const rows = await this.prisma.$queryRaw<CommunityPostRow[]>(Prisma.sql`
            SELECT ${postSelectSql}
            FROM community.community_posts p
            JOIN app_auth.auth_users u ON u.id = p.author_id
            WHERE p.public_id::text = ${publicId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async listPosts(filters: ListPostsFilters): Promise<CommunityPostRow[]> {
        const where: Prisma.Sql[] = [];
        const sortAsc = filters.sort === "published_at_asc";

        if (filters.publicOnly) {
            where.push(Prisma.sql`p.deleted_at IS NULL`);
            where.push(Prisma.sql`p.publication_status = 'published'`);
        }

        if (filters.feed === "trusted" || filters.trustedOnly) {
            where.push(Prisma.sql`p.verification_status IN ('community_confirmed', 'admin_verified')`);
        }

        if (filters.authorId !== undefined) {
            where.push(Prisma.sql`p.author_id = ${filters.authorId}`);
        }

        if (filters.category) {
            where.push(Prisma.sql`p.topic = ${filters.category}`);
        }

        if (filters.publicationStatus) {
            where.push(Prisma.sql`p.publication_status = ${filters.publicationStatus}::community.publication_status`);
        } else if (filters.closedOnly) {
            where.push(
                Prisma.sql`p.publication_status IN ('resolved', 'expired', 'rejected', 'removed')`
            );
        }

        if (filters.verificationStatus) {
            where.push(
                Prisma.sql`p.verification_status = ${filters.verificationStatus}::community.verification_status`
            );
        }

        if (filters.search) {
            const pattern = `%${escapeIlikePattern(filters.search)}%`;
            where.push(Prisma.sql`
                (
                    p.title ILIKE ${pattern} ESCAPE '\\'
                    OR p.description ILIKE ${pattern} ESCAPE '\\'
                    OR u.display_name ILIKE ${pattern} ESCAPE '\\'
                )
            `);
        }

        if (filters.bbox) {
            const { west, south, east, north } = filters.bbox;
            where.push(Prisma.sql`p.location IS NOT NULL`);
            where.push(Prisma.sql`
                p.location && ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)
            `);
        }

        if (filters.cursor) {
            if (sortAsc) {
                where.push(Prisma.sql`
                    (p.published_at, p.public_id) > (${filters.cursor.publishedAt}, ${filters.cursor.publicId}::uuid)
                `);
            } else {
                where.push(Prisma.sql`
                    (p.published_at, p.public_id) < (${filters.cursor.publishedAt}, ${filters.cursor.publicId}::uuid)
                `);
            }
        }

        const whereSql =
            where.length > 0
                ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}`
                : Prisma.empty;

        const orderSql = sortAsc
            ? Prisma.sql`ORDER BY p.published_at ASC, p.public_id ASC`
            : Prisma.sql`ORDER BY p.published_at DESC, p.public_id DESC`;

        return this.prisma.$queryRaw<CommunityPostRow[]>(Prisma.sql`
            SELECT ${postSelectSql}
            FROM community.community_posts p
            JOIN app_auth.auth_users u ON u.id = p.author_id
            ${whereSql}
            ${orderSql}
            LIMIT ${filters.limit + 1}
        `);
    }

    async getAdminCounts(): Promise<CommunityAdminCountsRow> {
        const rows = await this.prisma.$queryRaw<
            {
                needsReview: bigint;
                live: bigint;
                trusted: bigint;
                closed: bigint;
            }[]
        >(Prisma.sql`
            SELECT
                COUNT(*) FILTER (
                    WHERE publication_status = 'published'
                      AND verification_status = 'unverified'
                      AND deleted_at IS NULL
                )::bigint AS "needsReview",
                COUNT(*) FILTER (
                    WHERE publication_status = 'published'
                      AND deleted_at IS NULL
                )::bigint AS live,
                COUNT(*) FILTER (
                    WHERE publication_status = 'published'
                      AND verification_status IN ('community_confirmed', 'admin_verified')
                      AND deleted_at IS NULL
                )::bigint AS trusted,
                COUNT(*) FILTER (
                    WHERE publication_status IN ('resolved', 'expired', 'rejected', 'removed')
                )::bigint AS closed
            FROM community.community_posts
        `);

        const row = rows[0];
        return {
            needsReview: Number(row?.needsReview ?? 0),
            live: Number(row?.live ?? 0),
            trusted: Number(row?.trusted ?? 0),
            closed: Number(row?.closed ?? 0),
        };
    }

    async getReactionCounts(postId: bigint): Promise<ReactionCountRow> {
        const rows = await this.prisma.$queryRaw<
            { reaction_type: CommunityReactionType; count: bigint }[]
        >(Prisma.sql`
            SELECT reaction_type, COUNT(*)::bigint AS count
            FROM community.post_reactions
            WHERE post_id = ${postId}
            GROUP BY reaction_type
        `);

        const counts: ReactionCountRow = { confirm: 0, helpful: 0, incorrect: 0 };
        for (const row of rows) {
            counts[row.reaction_type] = Number(row.count);
        }
        return counts;
    }

    async getViewerReaction(
        postId: bigint,
        userId: bigint
    ): Promise<CommunityReactionType | null> {
        const row = await this.prisma.communityPostReaction.findUnique({
            where: { postId_userId: { postId, userId } },
            select: { reactionType: true },
        });
        return row?.reactionType ?? null;
    }

    async createPost(input: {
        authorId: bigint;
        title: string;
        description: string;
        category: string;
        location: { lng: number; lat: number; label?: string | null } | null;
    }): Promise<CommunityPostRow> {
        const created = await this.prisma.$transaction(async (tx) => {
            const rows = input.location
                ? await tx.$queryRaw<{ public_id: string }[]>(Prisma.sql`
                    INSERT INTO community.community_posts (
                        author_id, title, description, topic,
                        publication_status, verification_status, trust_score,
                        location, location_label, published_at, created_at, updated_at
                    )
                    VALUES (
                        ${input.authorId},
                        ${input.title},
                        ${input.description},
                        ${input.category},
                        'published'::community.publication_status,
                        'unverified'::community.verification_status,
                        0,
                        ST_SetSRID(ST_MakePoint(${input.location.lng}, ${input.location.lat}), 4326),
                        ${input.location.label ?? null},
                        now(), now(), now()
                    )
                    RETURNING public_id::text AS public_id
                `)
                : await tx.$queryRaw<{ public_id: string }[]>(Prisma.sql`
                    INSERT INTO community.community_posts (
                        author_id, title, description, topic,
                        publication_status, verification_status, trust_score,
                        location, location_label, published_at, created_at, updated_at
                    )
                    VALUES (
                        ${input.authorId},
                        ${input.title},
                        ${input.description},
                        ${input.category},
                        'published'::community.publication_status,
                        'unverified'::community.verification_status,
                        0,
                        NULL,
                        NULL,
                        now(), now(), now()
                    )
                    RETURNING public_id::text AS public_id
                `);

            const publicId = rows[0]?.public_id;
            if (!publicId) {
                throw new Error("Failed to create community post");
            }

            const post = await this.findPostByPublicIdInTx(tx, publicId);
            if (!post) {
                throw new Error("Failed to load created community post");
            }

            await this.insertModerationEvent(tx, {
                postId: post.id,
                actorUserId: input.authorId,
                actionCode: "publish",
                fromPublicationStatus: null,
                toPublicationStatus: "published",
                fromVerificationStatus: null,
                toVerificationStatus: "unverified",
                note: null,
                metadata: { source: "author_create" },
            });

            return post;
        });

        return created;
    }

    async updatePost(input: {
        postId: bigint;
        publicId: string;
        actorUserId: bigint;
        title?: string;
        description?: string;
        category?: string;
        location?: { lng: number; lat: number; label?: string | null } | null;
        clearLocation?: boolean;
    }): Promise<CommunityPostRow> {
        return this.prisma.$transaction(async (tx) => {
            await this.lockPost(tx, input.postId);

            const sets: Prisma.Sql[] = [Prisma.sql`updated_at = now()`];
            if (input.title !== undefined) {
                sets.push(Prisma.sql`title = ${input.title}`);
            }
            if (input.description !== undefined) {
                sets.push(Prisma.sql`description = ${input.description}`);
            }
            if (input.category !== undefined) {
                sets.push(Prisma.sql`topic = ${input.category}`);
            }
            if (input.clearLocation) {
                sets.push(Prisma.sql`location = NULL`);
                sets.push(Prisma.sql`location_label = NULL`);
            } else if (input.location) {
                sets.push(
                    Prisma.sql`location = ST_SetSRID(ST_MakePoint(${input.location.lng}, ${input.location.lat}), 4326)`
                );
                sets.push(Prisma.sql`location_label = ${input.location.label ?? null}`);
            }

            await tx.$executeRaw(Prisma.sql`
                UPDATE community.community_posts
                SET ${Prisma.join(sets, ", ")}
                WHERE id = ${input.postId}
            `);

            await this.insertModerationEvent(tx, {
                postId: input.postId,
                actorUserId: input.actorUserId,
                actionCode: "other",
                fromPublicationStatus: null,
                toPublicationStatus: null,
                fromVerificationStatus: null,
                toVerificationStatus: null,
                note: null,
                metadata: {
                    source: "author_update",
                    fields: Object.keys(input).filter(
                        (k) => k !== "postId" && k !== "publicId" && k !== "actorUserId"
                    ),
                },
            });

            const post = await this.findPostByPublicIdInTx(tx, input.publicId);
            if (!post) {
                throw new Error("Community post missing after update");
            }
            return post;
        });
    }

    async softDeletePost(input: {
        postId: bigint;
        publicId: string;
        actorUserId: bigint;
        fromPublicationStatus: CommunityPublicationStatus;
        fromVerificationStatus: CommunityVerificationStatus;
        note?: string | null;
    }): Promise<CommunityPostRow> {
        return this.prisma.$transaction(async (tx) => {
            await this.lockPost(tx, input.postId);

            await tx.$executeRaw(Prisma.sql`
                UPDATE community.community_posts
                SET publication_status = 'removed'::community.publication_status,
                    deleted_at = now(),
                    updated_at = now()
                WHERE id = ${input.postId}
            `);

            await this.insertModerationEvent(tx, {
                postId: input.postId,
                actorUserId: input.actorUserId,
                actionCode: "remove",
                fromPublicationStatus: input.fromPublicationStatus,
                toPublicationStatus: "removed",
                fromVerificationStatus: input.fromVerificationStatus,
                toVerificationStatus: input.fromVerificationStatus,
                note: input.note ?? null,
                metadata: { source: "author_or_admin_delete" },
            });

            const post = await this.findPostByPublicIdInTx(tx, input.publicId);
            if (!post) {
                throw new Error("Community post missing after delete");
            }
            return post;
        });
    }

    async upsertReaction(input: {
        postPublicId: string;
        userId: bigint;
        reactionType: CommunityReactionType;
        applyVerification: (
            current: CommunityVerificationStatus,
            trustScore: number
        ) => {
            next: CommunityVerificationStatus;
            autoAction: "community_auto_confirm" | "community_auto_unconfirm" | null;
        };
        scoreFor: (reactionType: CommunityReactionType) => number;
    }): Promise<UpsertReactionResult> {
        return this.prisma.$transaction(async (tx) => {
            const post = await this.lockPostByPublicId(tx, input.postPublicId);
            const previous = await tx.communityPostReaction.findUnique({
                where: { postId_userId: { postId: post.id, userId: input.userId } },
                select: { reactionType: true },
            });

            await tx.communityPostReaction.upsert({
                where: { postId_userId: { postId: post.id, userId: input.userId } },
                create: {
                    postId: post.id,
                    userId: input.userId,
                    reactionType: input.reactionType,
                },
                update: {
                    reactionType: input.reactionType,
                    updatedAt: new Date(),
                },
            });

            const trust = await this.recalculateTrustInTx(tx, post.id, input.scoreFor);
            const verification = input.applyVerification(post.verificationStatus, trust);
            await this.applyTrustAndVerification(tx, {
                post,
                trustScore: trust,
                verification,
                actorUserId: null,
            });

            const refreshed = await this.findPostByPublicIdInTx(tx, post.publicId);
            if (!refreshed) {
                throw new Error("Community post missing after reaction upsert");
            }

            if (previous?.reactionType !== input.reactionType) {
                await this.notifications.notifyPostReaction(
                    {
                        recipientUserId: post.authorId,
                        actorUserId: input.userId,
                        postId: post.id,
                        reactionType: input.reactionType,
                    },
                    tx
                );
            }

            return {
                post: refreshed,
                previousReaction: previous?.reactionType ?? null,
                nextReaction: input.reactionType,
                verificationChanged: verification.next !== post.verificationStatus,
                autoAction: verification.autoAction,
            };
        });
    }

    async removeReaction(input: {
        postPublicId: string;
        userId: bigint;
        applyVerification: (
            current: CommunityVerificationStatus,
            trustScore: number
        ) => {
            next: CommunityVerificationStatus;
            autoAction: "community_auto_confirm" | "community_auto_unconfirm" | null;
        };
        scoreFor: (reactionType: CommunityReactionType) => number;
    }): Promise<RemoveReactionResult | null> {
        return this.prisma.$transaction(async (tx) => {
            const post = await this.lockPostByPublicId(tx, input.postPublicId);
            const existing = await tx.communityPostReaction.findUnique({
                where: { postId_userId: { postId: post.id, userId: input.userId } },
                select: { reactionType: true },
            });
            if (!existing) {
                return null;
            }

            await tx.communityPostReaction.delete({
                where: { postId_userId: { postId: post.id, userId: input.userId } },
            });

            const trust = await this.recalculateTrustInTx(tx, post.id, input.scoreFor);
            const verification = input.applyVerification(post.verificationStatus, trust);
            await this.applyTrustAndVerification(tx, {
                post,
                trustScore: trust,
                verification,
                actorUserId: null,
            });

            const refreshed = await this.findPostByPublicIdInTx(tx, post.publicId);
            if (!refreshed) {
                throw new Error("Community post missing after reaction delete");
            }

            return {
                post: refreshed,
                previousReaction: existing.reactionType,
                verificationChanged: verification.next !== post.verificationStatus,
                autoAction: verification.autoAction,
            };
        });
    }

    async applyAdminModeration(input: {
        postPublicId: string;
        actorUserId: bigint;
        actionCode: Exclude<
            ModerationActionCode,
            | "community_auto_confirm"
            | "community_auto_unconfirm"
            | "author_update"
            | "author_delete"
            | "other"
        >;
        toPublicationStatus: CommunityPublicationStatus;
        toVerificationStatus: CommunityVerificationStatus;
        note?: string | null;
        softDelete?: boolean;
    }): Promise<CommunityPostRow> {
        return this.prisma.$transaction(async (tx) => {
            const post = await this.lockPostByPublicId(tx, input.postPublicId);

            if (input.softDelete) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE community.community_posts
                    SET publication_status = ${input.toPublicationStatus}::community.publication_status,
                        verification_status = ${input.toVerificationStatus}::community.verification_status,
                        deleted_at = now(),
                        updated_at = now()
                    WHERE id = ${post.id}
                `);
            } else {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE community.community_posts
                    SET publication_status = ${input.toPublicationStatus}::community.publication_status,
                        verification_status = ${input.toVerificationStatus}::community.verification_status,
                        updated_at = now()
                    WHERE id = ${post.id}
                `);
            }

            const moderation = await this.insertModerationEvent(tx, {
                postId: post.id,
                actorUserId: input.actorUserId,
                actionCode: input.actionCode,
                fromPublicationStatus: post.publicationStatus,
                toPublicationStatus: input.toPublicationStatus,
                fromVerificationStatus: post.verificationStatus,
                toVerificationStatus: input.toVerificationStatus,
                note: input.note ?? null,
                metadata: null,
            });

            await this.notifications.notifyCommunityStatusChange(
                {
                    recipientUserId: post.authorId,
                    actorUserId: input.actorUserId,
                    postId: post.id,
                    actionCode: input.actionCode as CommunityStatusNotifyAction,
                    moderationEventPublicId: moderation.publicId,
                    note: input.note ?? null,
                },
                tx
            );

            const refreshed = await this.findPostByPublicIdInTx(tx, post.publicId);
            if (!refreshed) {
                throw new Error("Community post missing after moderation");
            }
            return refreshed;
        });
    }

    async listModerationEvents(postId: bigint): Promise<
        {
            publicId: string;
            actionCode: string;
            fromPublicationStatus: CommunityPublicationStatus | null;
            toPublicationStatus: CommunityPublicationStatus | null;
            fromVerificationStatus: CommunityVerificationStatus | null;
            toVerificationStatus: CommunityVerificationStatus | null;
            note: string | null;
            createdAt: Date;
            actorPublicId: string | null;
            actorDisplayName: string | null;
        }[]
    > {
        return this.prisma.$queryRaw`
            SELECT
                e.public_id::text AS "publicId",
                e.action_code AS "actionCode",
                e.from_publication_status AS "fromPublicationStatus",
                e.to_publication_status AS "toPublicationStatus",
                e.from_verification_status AS "fromVerificationStatus",
                e.to_verification_status AS "toVerificationStatus",
                e.note,
                e.created_at AS "createdAt",
                u.public_id::text AS "actorPublicId",
                u.display_name AS "actorDisplayName"
            FROM community.post_moderation_events e
            LEFT JOIN app_auth.auth_users u ON u.id = e.actor_user_id
            WHERE e.post_id = ${postId}
            ORDER BY e.created_at DESC, e.id DESC
            LIMIT 100
        `;
    }

    private async applyTrustAndVerification(
        tx: TxClient,
        input: {
            post: CommunityPostRow;
            trustScore: number;
            verification: {
                next: CommunityVerificationStatus;
                autoAction: "community_auto_confirm" | "community_auto_unconfirm" | null;
            };
            actorUserId: bigint | null;
        }
    ): Promise<void> {
        // Only auto-adjust verification while published and not soft-deleted.
        const canAuto =
            input.post.publicationStatus === "published" && input.post.deletedAt === null;

        const nextVerification = canAuto
            ? input.verification.next
            : input.post.verificationStatus;
        const autoAction = canAuto ? input.verification.autoAction : null;

        await tx.$executeRaw(Prisma.sql`
            UPDATE community.community_posts
            SET trust_score = ${input.trustScore},
                verification_status = ${nextVerification}::community.verification_status,
                updated_at = now()
            WHERE id = ${input.post.id}
        `);

        if (autoAction) {
            const moderation = await this.insertModerationEvent(tx, {
                postId: input.post.id,
                actorUserId: input.actorUserId,
                actionCode: autoAction,
                fromPublicationStatus: input.post.publicationStatus,
                toPublicationStatus: input.post.publicationStatus,
                fromVerificationStatus: input.post.verificationStatus,
                toVerificationStatus: nextVerification,
                note: null,
                metadata: { trust_score: input.trustScore },
            });

            await this.notifications.notifyCommunityStatusChange(
                {
                    recipientUserId: input.post.authorId,
                    actorUserId: input.actorUserId,
                    postId: input.post.id,
                    actionCode: autoAction,
                    moderationEventPublicId: moderation.publicId,
                },
                tx
            );
        }
    }

    private async recalculateTrustInTx(
        tx: TxClient,
        postId: bigint,
        scoreFor: (reactionType: CommunityReactionType) => number
    ): Promise<number> {
        const reactions = await tx.communityPostReaction.findMany({
            where: { postId },
            select: { reactionType: true },
        });
        return reactions.reduce((sum, row) => sum + scoreFor(row.reactionType), 0);
    }

    private async lockPost(tx: TxClient, postId: bigint): Promise<void> {
        await tx.$queryRaw`SELECT id FROM community.community_posts WHERE id = ${postId} FOR UPDATE`;
    }

    private async lockPostByPublicId(tx: TxClient, publicId: string): Promise<CommunityPostRow> {
        const rows = await tx.$queryRaw<CommunityPostRow[]>(Prisma.sql`
            SELECT ${postSelectSql}
            FROM community.community_posts p
            JOIN app_auth.auth_users u ON u.id = p.author_id
            WHERE p.public_id::text = ${publicId}
            FOR UPDATE OF p
        `);
        const post = rows[0];
        if (!post) {
            throw new Error("POST_NOT_FOUND");
        }
        return post;
    }

    private async findPostByPublicIdInTx(
        tx: TxClient,
        publicId: string
    ): Promise<CommunityPostRow | null> {
        const rows = await tx.$queryRaw<CommunityPostRow[]>(Prisma.sql`
            SELECT ${postSelectSql}
            FROM community.community_posts p
            JOIN app_auth.auth_users u ON u.id = p.author_id
            WHERE p.public_id::text = ${publicId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    private async insertModerationEvent(
        tx: TxClient,
        input: {
            postId: bigint;
            actorUserId: bigint | null;
            actionCode: string;
            fromPublicationStatus: CommunityPublicationStatus | null;
            toPublicationStatus: CommunityPublicationStatus | null;
            fromVerificationStatus: CommunityVerificationStatus | null;
            toVerificationStatus: CommunityVerificationStatus | null;
            note: string | null;
            metadata: Prisma.InputJsonValue | null;
        }
    ): Promise<{ publicId: string }> {
        const created = await tx.communityPostModerationEvent.create({
            data: {
                postId: input.postId,
                actorUserId: input.actorUserId,
                actionCode: input.actionCode,
                fromPublicationStatus: input.fromPublicationStatus,
                toPublicationStatus: input.toPublicationStatus,
                fromVerificationStatus: input.fromVerificationStatus,
                toVerificationStatus: input.toVerificationStatus,
                note: input.note,
                metadata: input.metadata ?? undefined,
            },
            select: { publicId: true },
        });
        return { publicId: created.publicId };
    }
}

/** Escape `%`, `_`, and `\` for PostgreSQL ILIKE … ESCAPE '\\'. */
function escapeIlikePattern(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
