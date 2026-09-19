import type {
    CommunityPublicationStatus,
    CommunityReactionType,
    CommunityVerificationStatus,
} from "@prisma/client";

import {
    decodeCommunityCursor,
    encodeCommunityCursor,
    InvalidCommunityCursorError,
    parseBbox,
    type CommunityListQuery,
    type CreateCommunityPostBody,
    type PatchCommunityPostBody,
} from "./community.schema.js";
import {
    CommunityRepository,
    type CommunityPostRow,
    type ReactionCountRow,
} from "./community.repo.js";
import { nextVerificationStatus, scoreForReaction } from "./community.trust.js";

export class CommunityError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code?: string
    ) {
        super(message);
        this.name = "CommunityError";
    }
}

export type CommunityAuthorDto = {
    public_id: string;
    display_name: string;
};

export type CommunityLocationDto = {
    lng: number;
    lat: number;
    label: string | null;
};

export type CommunityPostListItemDto = {
    public_id: string;
    title: string;
    description_preview: string;
    category: string;
    publication_status: CommunityPublicationStatus;
    verification_status: CommunityVerificationStatus;
    trust_score: number;
    published_at: string;
    has_location: boolean;
    /** Compact coords when geotagged — needed for map markers without a detail fetch. */
    location: CommunityLocationDto | null;
    author: CommunityAuthorDto;
    reaction_counts: ReactionCountRow;
};

export type CommunityAdminCountsDto = {
    needs_review: number;
    live: number;
    trusted: number;
    closed: number;
};

export type CommunityPostDetailDto = CommunityPostListItemDto & {
    description: string;
    location: CommunityLocationDto | null;
    updated_at: string;
    viewer_reaction: CommunityReactionType | null;
};

export type CommunityModerationEventDto = {
    public_id: string;
    action_code: string;
    from_publication_status: string | null;
    to_publication_status: string | null;
    from_verification_status: string | null;
    to_verification_status: string | null;
    note: string | null;
    created_at: string;
    actor: CommunityAuthorDto | null;
};

export type CommunityAdminPostDetailDto = CommunityPostDetailDto & {
    created_at: string;
    moderation_history: CommunityModerationEventDto[];
};

export type CommunityPostPageDto = {
    items: CommunityPostListItemDto[];
    next_cursor: string | null;
};

type Viewer = {
    publicId: string;
    roles: string[];
};

function isAdmin(roles: readonly string[]): boolean {
    return roles.includes("admin") || roles.includes("super_admin");
}

function assertAuthorEditable(post: CommunityPostRow): void {
    if (post.deletedAt !== null || post.publicationStatus !== "published") {
        throw new CommunityError(
            "Only published posts can be edited by the author",
            409,
            "INVALID_TRANSITION"
        );
    }
}

function assertReactable(post: CommunityPostRow): void {
    if (post.deletedAt !== null || post.publicationStatus !== "published") {
        throw new CommunityError(
            "Reactions are only allowed on published posts",
            409,
            "INVALID_TRANSITION"
        );
    }
}

function toAuthorDto(post: CommunityPostRow): CommunityAuthorDto {
    return {
        public_id: post.authorPublicId,
        display_name: post.authorDisplayName,
    };
}

function toLocationDto(post: CommunityPostRow): CommunityLocationDto | null {
    if (post.lng === null || post.lat === null) {
        return null;
    }
    return {
        lng: Number(post.lng),
        lat: Number(post.lat),
        label: post.locationLabel,
    };
}

function previewText(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export class CommunityService {
    constructor(private readonly repo: CommunityRepository) {}

    async listPublicFeed(
        query: CommunityListQuery,
        viewerPublicId?: string | null
    ): Promise<CommunityPostPageDto> {
        void viewerPublicId;
        let cursor: { publishedAt: Date; publicId: string } | undefined;
        if (query.cursor) {
            try {
                cursor = decodeCommunityCursor(query.cursor);
            } catch (error) {
                if (error instanceof InvalidCommunityCursorError) {
                    throw new CommunityError("Invalid cursor", 400, "INVALID_CURSOR");
                }
                throw error;
            }
        }

        const rows = await this.repo.listPosts({
            feed: query.feed,
            category: query.category,
            bbox: query.bbox ? parseBbox(query.bbox) : undefined,
            cursor,
            limit: query.limit,
            publicOnly: true,
        });

        return this.toPage(rows, query.limit);
    }

    async getPublicPost(
        publicId: string,
        viewer?: Viewer | null
    ): Promise<CommunityPostDetailDto> {
        const post = await this.requirePost(publicId);
        const isOwner = viewer ? post.authorPublicId === viewer.publicId : false;
        const admin = viewer ? isAdmin(viewer.roles) : false;

        if (post.deletedAt !== null || post.publicationStatus !== "published") {
            if (!isOwner && !admin) {
                throw new CommunityError("Post not found", 404);
            }
        }

        return this.toDetailDto(post, viewer?.publicId ?? null);
    }

    async listMyPosts(
        viewerPublicId: string,
        input: { cursor?: string; limit: number }
    ): Promise<CommunityPostPageDto> {
        const userId = await this.requireUsableUser(viewerPublicId);
        let cursor: { publishedAt: Date; publicId: string } | undefined;
        if (input.cursor) {
            try {
                cursor = decodeCommunityCursor(input.cursor);
            } catch {
                throw new CommunityError("Invalid cursor", 400, "INVALID_CURSOR");
            }
        }

        const rows = await this.repo.listPosts({
            feed: "mine",
            authorId: userId,
            cursor,
            limit: input.limit,
            publicOnly: false,
        });
        return this.toPage(rows, input.limit);
    }

    async listAdminPosts(input: {
        cursor?: string;
        limit: number;
        publicationStatus?: CommunityPublicationStatus;
        verificationStatus?: CommunityVerificationStatus;
        trustedOnly?: boolean;
        closedOnly?: boolean;
        category?: string;
        search?: string;
        sort?: "published_at_desc" | "published_at_asc";
    }): Promise<CommunityPostPageDto> {
        let cursor: { publishedAt: Date; publicId: string } | undefined;
        if (input.cursor) {
            try {
                cursor = decodeCommunityCursor(input.cursor);
            } catch {
                throw new CommunityError("Invalid cursor", 400, "INVALID_CURSOR");
            }
        }

        const rows = await this.repo.listPosts({
            feed: "admin",
            cursor,
            limit: input.limit,
            publicationStatus: input.publicationStatus,
            verificationStatus: input.verificationStatus,
            trustedOnly: input.trustedOnly,
            closedOnly: input.closedOnly,
            category: input.category,
            search: input.search,
            sort: input.sort ?? "published_at_desc",
            publicOnly: false,
        });
        return this.toPage(rows, input.limit);
    }

    async getAdminCounts(): Promise<CommunityAdminCountsDto> {
        const counts = await this.repo.getAdminCounts();
        return {
            needs_review: counts.needsReview,
            live: counts.live,
            trusted: counts.trusted,
            closed: counts.closed,
        };
    }

    async getAdminPost(publicId: string): Promise<CommunityAdminPostDetailDto> {
        const post = await this.requirePost(publicId);
        const detail = await this.toDetailDto(post, null);
        const events = await this.repo.listModerationEvents(post.id);
        return {
            ...detail,
            created_at: post.createdAt.toISOString(),
            moderation_history: events.map((event) => ({
                public_id: event.publicId,
                action_code: event.actionCode,
                from_publication_status: event.fromPublicationStatus,
                to_publication_status: event.toPublicationStatus,
                from_verification_status: event.fromVerificationStatus,
                to_verification_status: event.toVerificationStatus,
                note: event.note,
                created_at: event.createdAt.toISOString(),
                actor:
                    event.actorPublicId && event.actorDisplayName
                        ? {
                              public_id: event.actorPublicId,
                              display_name: event.actorDisplayName,
                          }
                        : null,
            })),
        };
    }

    async createPost(
        viewerPublicId: string,
        body: CreateCommunityPostBody
    ): Promise<CommunityPostDetailDto> {
        const userId = await this.requireUsableUser(viewerPublicId);
        const post = await this.repo.createPost({
            authorId: userId,
            title: body.title,
            description: body.description,
            category: body.category,
            location: body.location
                ? {
                      lng: body.location.lng,
                      lat: body.location.lat,
                      label: body.location.label ?? null,
                  }
                : null,
        });
        return this.toDetailDto(post, viewerPublicId);
    }

    async patchPost(
        viewerPublicId: string,
        publicId: string,
        body: PatchCommunityPostBody
    ): Promise<CommunityPostDetailDto> {
        const userId = await this.requireUsableUser(viewerPublicId);
        const post = await this.requirePost(publicId);
        if (post.authorId !== userId) {
            throw new CommunityError("Forbidden", 403);
        }
        assertAuthorEditable(post);

        const clearLocation = body.location === null;
        const postUpdated = await this.repo.updatePost({
            postId: post.id,
            publicId: post.publicId,
            actorUserId: userId,
            title: body.title,
            description: body.description,
            category: body.category,
            location:
                body.location && body.location !== null
                    ? {
                          lng: body.location.lng,
                          lat: body.location.lat,
                          label: body.location.label ?? null,
                      }
                    : undefined,
            clearLocation,
        });
        return this.toDetailDto(postUpdated, viewerPublicId);
    }

    async deletePost(viewerPublicId: string, publicId: string): Promise<{ ok: true }> {
        const userId = await this.requireUsableUser(viewerPublicId);
        const post = await this.requirePost(publicId);
        if (post.authorId !== userId) {
            throw new CommunityError("Forbidden", 403);
        }
        if (post.deletedAt !== null || post.publicationStatus === "removed") {
            throw new CommunityError("Post already removed", 409, "INVALID_TRANSITION");
        }
        if (!["published", "rejected", "resolved", "expired"].includes(post.publicationStatus)) {
            throw new CommunityError("Post cannot be deleted", 409, "INVALID_TRANSITION");
        }

        await this.repo.softDeletePost({
            postId: post.id,
            publicId: post.publicId,
            actorUserId: userId,
            fromPublicationStatus: post.publicationStatus,
            fromVerificationStatus: post.verificationStatus,
        });
        return { ok: true };
    }

    async putReaction(
        viewerPublicId: string,
        publicId: string,
        reactionType: CommunityReactionType
    ): Promise<CommunityPostDetailDto> {
        const userId = await this.requireUsableUser(viewerPublicId);
        const post = await this.requirePost(publicId);
        assertReactable(post);

        try {
            const result = await this.repo.upsertReaction({
                postPublicId: publicId,
                userId,
                reactionType,
                applyVerification: (current, trustScore) =>
                    nextVerificationStatus({ current, trustScore }),
                scoreFor: scoreForReaction,
            });
            return this.toDetailDto(result.post, viewerPublicId);
        } catch (error) {
            this.rethrowRepoNotFound(error);
            throw error;
        }
    }

    async deleteReaction(
        viewerPublicId: string,
        publicId: string
    ): Promise<CommunityPostDetailDto> {
        const userId = await this.requireUsableUser(viewerPublicId);
        const post = await this.requirePost(publicId);
        assertReactable(post);

        try {
            const result = await this.repo.removeReaction({
                postPublicId: publicId,
                userId,
                applyVerification: (current, trustScore) =>
                    nextVerificationStatus({ current, trustScore }),
                scoreFor: scoreForReaction,
            });
            if (!result) {
                return this.toDetailDto(post, viewerPublicId);
            }
            return this.toDetailDto(result.post, viewerPublicId);
        } catch (error) {
            this.rethrowRepoNotFound(error);
            throw error;
        }
    }

    async moderate(
        adminPublicId: string,
        publicId: string,
        action: "verify" | "unverify" | "reject" | "resolve" | "expire" | "remove" | "reopen",
        note?: string
    ): Promise<CommunityPostDetailDto> {
        const adminId = await this.requireUsableUser(adminPublicId);
        const post = await this.requirePost(publicId);

        if (post.deletedAt !== null && action !== "remove" && action !== "reopen") {
            throw new CommunityError("Post is removed", 409, "INVALID_TRANSITION");
        }

        if (
            (action === "reject" || action === "remove" || action === "expire") &&
            (!note || note.trim() === "")
        ) {
            throw new CommunityError(
                "A reason is required for this moderation action",
                400,
                "NOTE_REQUIRED"
            );
        }

        const transition = resolveAdminTransition(post, action);
        const actionCode = action === "reopen" ? "restore" : action;
        const updated = await this.repo.applyAdminModeration({
            postPublicId: publicId,
            actorUserId: adminId,
            actionCode,
            toPublicationStatus: transition.publicationStatus,
            toVerificationStatus: transition.verificationStatus,
            note: note ?? null,
            softDelete: action === "remove",
        });
        return this.toDetailDto(updated, adminPublicId);
    }

    private async toPage(
        rows: CommunityPostRow[],
        limit: number
    ): Promise<CommunityPostPageDto> {
        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const items = await Promise.all(pageRows.map((row) => this.toListItemDto(row)));
        const last = pageRows[pageRows.length - 1];
        return {
            items,
            next_cursor: hasMore && last
                ? encodeCommunityCursor({
                      publishedAt: last.publishedAt,
                      publicId: last.publicId,
                  })
                : null,
        };
    }

    private async toListItemDto(post: CommunityPostRow): Promise<CommunityPostListItemDto> {
        const reaction_counts = await this.repo.getReactionCounts(post.id);
        const location = toLocationDto(post);
        return {
            public_id: post.publicId,
            title: post.title,
            description_preview: previewText(post.description, 160),
            category: post.topic,
            publication_status: post.publicationStatus,
            verification_status: post.verificationStatus,
            trust_score: post.trustScore,
            published_at: post.publishedAt.toISOString(),
            has_location: location !== null,
            location,
            author: toAuthorDto(post),
            reaction_counts,
        };
    }

    private async toDetailDto(
        post: CommunityPostRow,
        viewerPublicId: string | null
    ): Promise<CommunityPostDetailDto> {
        const [reaction_counts, viewerReaction] = await Promise.all([
            this.repo.getReactionCounts(post.id),
            viewerPublicId
                ? this.repo
                      .findUsableUserIdByPublicId(viewerPublicId)
                      .then(async (userId) =>
                          userId ? this.repo.getViewerReaction(post.id, userId) : null
                      )
                : Promise.resolve(null),
        ]);

        const location = toLocationDto(post);
        return {
            public_id: post.publicId,
            title: post.title,
            description_preview: previewText(post.description, 160),
            description: post.description,
            category: post.topic,
            publication_status: post.publicationStatus,
            verification_status: post.verificationStatus,
            trust_score: post.trustScore,
            published_at: post.publishedAt.toISOString(),
            updated_at: post.updatedAt.toISOString(),
            has_location: location !== null,
            location,
            author: toAuthorDto(post),
            reaction_counts,
            viewer_reaction: viewerReaction,
        };
    }

    private async requirePost(publicId: string): Promise<CommunityPostRow> {
        const post = await this.repo.findPostByPublicId(publicId);
        if (!post) {
            throw new CommunityError("Post not found", 404);
        }
        return post;
    }

    private async requireUsableUser(publicId: string): Promise<bigint> {
        const userId = await this.repo.findUsableUserIdByPublicId(publicId);
        if (userId === null) {
            throw new CommunityError("User account is inactive", 403, "INACTIVE_ACCOUNT");
        }
        return userId;
    }

    private rethrowRepoNotFound(error: unknown): void {
        if (error instanceof Error && error.message === "POST_NOT_FOUND") {
            throw new CommunityError("Post not found", 404);
        }
    }
}

export function resolveAdminTransition(
    post: CommunityPostRow,
    action: "verify" | "unverify" | "reject" | "resolve" | "expire" | "remove" | "reopen"
): {
    publicationStatus: CommunityPublicationStatus;
    verificationStatus: CommunityVerificationStatus;
} {
    if (action === "verify") {
        if (post.publicationStatus !== "published" || post.deletedAt !== null) {
            throw new CommunityError(
                "Only published posts can be CoreMap Verified",
                409,
                "INVALID_TRANSITION"
            );
        }
        return {
            publicationStatus: "published",
            verificationStatus: "admin_verified",
        };
    }

    if (action === "unverify") {
        if (post.verificationStatus !== "admin_verified" || post.publicationStatus !== "published") {
            throw new CommunityError(
                "Only CoreMap Verified published posts can be unverified",
                409,
                "INVALID_TRANSITION"
            );
        }
        return {
            publicationStatus: "published",
            verificationStatus: "community_confirmed",
        };
    }

    if (action === "remove") {
        if (post.deletedAt !== null || post.publicationStatus === "removed") {
            throw new CommunityError("Post already removed", 409, "INVALID_TRANSITION");
        }
        return {
            publicationStatus: "removed",
            verificationStatus: post.verificationStatus,
        };
    }

    if (action === "reopen") {
        const reopenable =
            post.publicationStatus === "resolved" ||
            post.publicationStatus === "expired" ||
            post.publicationStatus === "rejected";
        if (!reopenable || post.deletedAt !== null) {
            throw new CommunityError(
                "Only resolved, expired, or rejected posts can be reopened",
                409,
                "INVALID_TRANSITION"
            );
        }
        return {
            publicationStatus: "published",
            verificationStatus: post.verificationStatus,
        };
    }

    if (post.publicationStatus !== "published" || post.deletedAt !== null) {
        throw new CommunityError(
            `Cannot ${action} a post that is not published`,
            409,
            "INVALID_TRANSITION"
        );
    }

    if (action === "reject") {
        return { publicationStatus: "rejected", verificationStatus: post.verificationStatus };
    }
    if (action === "resolve") {
        return { publicationStatus: "resolved", verificationStatus: post.verificationStatus };
    }
    return { publicationStatus: "expired", verificationStatus: post.verificationStatus };
}
