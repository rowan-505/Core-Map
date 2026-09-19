import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CommunityReactionType, CommunityVerificationStatus } from "@prisma/client";

import {
    AUTO_CONFIRM_THRESHOLD,
    calculateTrustScore,
    nextVerificationStatus,
    scoreForReaction,
} from "./community.trust.js";
import {
    decodeCommunityCursor,
    encodeCommunityCursor,
    InvalidCommunityCursorError,
} from "./community.schema.js";
import {
    CommunityError,
    CommunityService,
    resolveAdminTransition,
} from "./community.service.js";
import type {
    CommunityPostRow,
    CommunityRepository,
    ListPostsFilters,
    ReactionCountRow,
    RemoveReactionResult,
    UpsertReactionResult,
} from "./community.repo.js";

function postRow(overrides: Partial<CommunityPostRow> = {}): CommunityPostRow {
    return {
        id: 1n,
        publicId: "11111111-1111-4111-8111-111111111111",
        authorId: 10n,
        title: "Title",
        description: "Body",
        topic: "flood",
        publicationStatus: "published",
        verificationStatus: "unverified",
        trustScore: 0,
        locationLabel: null,
        lng: null,
        lat: null,
        publishedAt: new Date("2026-09-01T00:00:00.000Z"),
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        deletedAt: null,
        authorPublicId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        authorDisplayName: "Author",
        ...overrides,
    };
}

class FakeCommunityRepository implements Partial<CommunityRepository> {
    users = new Map<string, { id: bigint; active: boolean }>([
        ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { id: 10n, active: true }],
        ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", { id: 20n, active: true }],
        ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", { id: 30n, active: false }],
        ["dddddddd-dddd-4ddd-8ddd-dddddddddddd", { id: 40n, active: true }],
    ]);
    posts = new Map<string, CommunityPostRow>();
    reactions = new Map<string, CommunityReactionType>();
    moderation: Array<{ actionCode: string; postId: bigint }> = [];

    constructor(seed: CommunityPostRow[] = []) {
        for (const row of seed) {
            this.posts.set(row.publicId, structuredClone(row));
        }
    }

    async findUsableUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const user = this.users.get(publicId);
        if (!user || !user.active) return null;
        return user.id;
    }

    async findUserIdByPublicId(publicId: string): Promise<bigint | null> {
        return this.users.get(publicId)?.id ?? null;
    }

    async findPostByPublicId(publicId: string): Promise<CommunityPostRow | null> {
        return this.posts.get(publicId) ?? null;
    }

    async listPosts(filters: ListPostsFilters): Promise<CommunityPostRow[]> {
        let rows = [...this.posts.values()];
        if (filters.publicOnly) {
            rows = rows.filter(
                (row) => row.deletedAt === null && row.publicationStatus === "published"
            );
        }
        if (filters.feed === "trusted") {
            rows = rows.filter((row) =>
                ["community_confirmed", "admin_verified"].includes(row.verificationStatus)
            );
        }
        if (filters.authorId !== undefined) {
            rows = rows.filter((row) => row.authorId === filters.authorId);
        }
        if (filters.category) {
            rows = rows.filter((row) => row.topic === filters.category);
        }
        rows.sort((a, b) => {
            const byTime = b.publishedAt.getTime() - a.publishedAt.getTime();
            if (byTime !== 0) return byTime;
            return a.publicId < b.publicId ? 1 : -1;
        });
        if (filters.cursor) {
            rows = rows.filter((row) => {
                if (row.publishedAt.getTime() < filters.cursor!.publishedAt.getTime()) return true;
                if (row.publishedAt.getTime() > filters.cursor!.publishedAt.getTime()) return false;
                return row.publicId < filters.cursor!.publicId;
            });
        }
        return rows.slice(0, filters.limit + 1);
    }

    async getReactionCounts(postId: bigint): Promise<ReactionCountRow> {
        const counts: ReactionCountRow = { confirm: 0, helpful: 0, incorrect: 0 };
        for (const [key, type] of this.reactions) {
            if (key.startsWith(`${postId}:`)) {
                counts[type] += 1;
            }
        }
        return counts;
    }

    async getViewerReaction(
        postId: bigint,
        userId: bigint
    ): Promise<CommunityReactionType | null> {
        return this.reactions.get(`${postId}:${userId}`) ?? null;
    }

    async createPost(input: {
        authorId: bigint;
        title: string;
        description: string;
        category: string;
        location: { lng: number; lat: number; label?: string | null } | null;
    }): Promise<CommunityPostRow> {
        const row = postRow({
            id: BigInt(this.posts.size + 1),
            publicId: `eeeeeeee-eeee-4eee-8eee-${String(this.posts.size + 1).padStart(12, "0")}`,
            authorId: input.authorId,
            title: input.title,
            description: input.description,
            topic: input.category,
            lng: input.location?.lng ?? null,
            lat: input.location?.lat ?? null,
            locationLabel: input.location?.label ?? null,
            authorPublicId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        });
        this.posts.set(row.publicId, row);
        this.moderation.push({ actionCode: "publish", postId: row.id });
        return row;
    }

    async updatePost(input: {
        postId: bigint;
        publicId: string;
        title?: string;
        description?: string;
        category?: string;
    }): Promise<CommunityPostRow> {
        const row = this.posts.get(input.publicId)!;
        if (input.title) row.title = input.title;
        if (input.description) row.description = input.description;
        if (input.category) row.topic = input.category;
        row.updatedAt = new Date();
        return row;
    }

    async softDeletePost(input: {
        publicId: string;
        fromPublicationStatus: CommunityPostRow["publicationStatus"];
        fromVerificationStatus: CommunityVerificationStatus;
    }): Promise<CommunityPostRow> {
        const row = this.posts.get(input.publicId)!;
        row.publicationStatus = "removed";
        row.deletedAt = new Date();
        this.moderation.push({ actionCode: "remove", postId: row.id });
        return row;
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
        const post = this.posts.get(input.postPublicId);
        if (!post) throw new Error("POST_NOT_FOUND");
        const key = `${post.id}:${input.userId}`;
        const previousReaction = this.reactions.get(key) ?? null;
        this.reactions.set(key, input.reactionType);

        const trust = [...this.reactions.entries()]
            .filter(([k]) => k.startsWith(`${post.id}:`))
            .reduce((sum, [, type]) => sum + input.scoreFor(type), 0);
        const verification = input.applyVerification(post.verificationStatus, trust);
        const canAuto = post.publicationStatus === "published" && post.deletedAt === null;
        post.trustScore = trust;
        if (canAuto) {
            if (verification.autoAction) {
                this.moderation.push({ actionCode: verification.autoAction, postId: post.id });
            }
            post.verificationStatus = verification.next;
        }
        return {
            post,
            previousReaction,
            nextReaction: input.reactionType,
            verificationChanged: canAuto && verification.next !== (previousReaction ? post.verificationStatus : post.verificationStatus),
            autoAction: canAuto ? verification.autoAction : null,
        };
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
        const post = this.posts.get(input.postPublicId);
        if (!post) throw new Error("POST_NOT_FOUND");
        const key = `${post.id}:${input.userId}`;
        const previous = this.reactions.get(key);
        if (!previous) return null;
        this.reactions.delete(key);
        const trust = [...this.reactions.entries()]
            .filter(([k]) => k.startsWith(`${post.id}:`))
            .reduce((sum, [, type]) => sum + input.scoreFor(type), 0);
        const before = post.verificationStatus;
        const verification = input.applyVerification(before, trust);
        post.trustScore = trust;
        if (post.publicationStatus === "published" && post.deletedAt === null) {
            post.verificationStatus = verification.next;
            if (verification.autoAction) {
                this.moderation.push({ actionCode: verification.autoAction, postId: post.id });
            }
        }
        return {
            post,
            previousReaction: previous,
            verificationChanged: post.verificationStatus !== before,
            autoAction: verification.autoAction,
        };
    }

    async applyAdminModeration(input: {
        postPublicId: string;
        actionCode: string;
        toPublicationStatus: CommunityPostRow["publicationStatus"];
        toVerificationStatus: CommunityVerificationStatus;
        softDelete?: boolean;
        note?: string | null;
    }): Promise<CommunityPostRow> {
        const post = this.posts.get(input.postPublicId)!;
        post.publicationStatus = input.toPublicationStatus;
        post.verificationStatus = input.toVerificationStatus;
        if (input.softDelete) post.deletedAt = new Date();
        this.moderation.push({ actionCode: input.actionCode, postId: post.id });
        return post;
    }

    async listModerationEvents(postId: bigint) {
        return this.moderation
            .filter((row) => row.postId === postId)
            .map((row, index) => ({
                publicId: `ffffffff-ffff-4fff-8fff-${String(index + 1).padStart(12, "0")}`,
                actionCode: row.actionCode,
                fromPublicationStatus: null,
                toPublicationStatus: null,
                fromVerificationStatus: null,
                toVerificationStatus: null,
                note: null,
                createdAt: new Date("2026-09-01T00:00:00.000Z"),
                actorPublicId: null,
                actorDisplayName: null,
            }));
    }
}

function service(repo: FakeCommunityRepository): CommunityService {
    return new CommunityService(repo as unknown as CommunityRepository);
}

describe("community.trust", () => {
    it("scores confirm/helpful/incorrect and ignores unknown weights", () => {
        assert.equal(scoreForReaction("confirm"), 2);
        assert.equal(scoreForReaction("helpful"), 1);
        assert.equal(scoreForReaction("incorrect"), -3);
        assert.equal(
            calculateTrustScore([
                { reactionType: "confirm" },
                { reactionType: "confirm" },
                { reactionType: "confirm" },
                { reactionType: "confirm" },
            ]),
            AUTO_CONFIRM_THRESHOLD
        );
    });

    it("crosses community_confirmed threshold both directions", () => {
        assert.deepEqual(
            nextVerificationStatus({ current: "unverified", trustScore: 8 }),
            { next: "community_confirmed", autoAction: "community_auto_confirm" }
        );
        assert.deepEqual(
            nextVerificationStatus({ current: "community_confirmed", trustScore: 7 }),
            { next: "unverified", autoAction: "community_auto_unconfirm" }
        );
    });

    it("keeps admin_verified immune from score changes", () => {
        assert.deepEqual(
            nextVerificationStatus({ current: "admin_verified", trustScore: 0 }),
            { next: "admin_verified", autoAction: null }
        );
        assert.deepEqual(
            nextVerificationStatus({ current: "admin_verified", trustScore: 100 }),
            { next: "admin_verified", autoAction: null }
        );
    });
});

describe("community cursor", () => {
    it("round-trips opaque cursor payloads", () => {
        const encoded = encodeCommunityCursor({
            publishedAt: new Date("2026-09-01T12:00:00.000Z"),
            publicId: "11111111-1111-4111-8111-111111111111",
        });
        const decoded = decodeCommunityCursor(encoded);
        assert.equal(decoded.publicId, "11111111-1111-4111-8111-111111111111");
        assert.equal(decoded.publishedAt.toISOString(), "2026-09-01T12:00:00.000Z");
    });

    it("rejects invalid cursors", () => {
        assert.throws(() => decodeCommunityCursor("not-a-cursor"), InvalidCommunityCursorError);
    });
});

describe("community.service", () => {
    it("rejects inactive accounts on write", async () => {
        const svc = service(new FakeCommunityRepository([postRow()]));
        await assert.rejects(
            () =>
                svc.createPost("cccccccc-cccc-4ccc-8ccc-cccccccccccc", {
                    title: "t",
                    description: "d",
                    category: "flood",
                }),
            (error: unknown) =>
                error instanceof CommunityError &&
                error.statusCode === 403 &&
                error.code === "INACTIVE_ACCOUNT"
        );
    });

    it("enforces ownership on patch/delete", async () => {
        const repo = new FakeCommunityRepository([postRow()]);
        const svc = service(repo);
        await assert.rejects(
            () =>
                svc.patchPost("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", postRow().publicId, {
                    title: "hijack",
                }),
            (error: unknown) => error instanceof CommunityError && error.statusCode === 403
        );
        await assert.rejects(
            () => svc.deletePost("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", postRow().publicId),
            (error: unknown) => error instanceof CommunityError && error.statusCode === 403
        );
    });

    it("paginates Latest with next_cursor", async () => {
        const repo = new FakeCommunityRepository([
            postRow({
                publicId: "11111111-1111-4111-8111-111111111111",
                publishedAt: new Date("2026-09-03T00:00:00.000Z"),
            }),
            postRow({
                id: 2n,
                publicId: "22222222-2222-4222-8222-222222222222",
                publishedAt: new Date("2026-09-02T00:00:00.000Z"),
            }),
            postRow({
                id: 3n,
                publicId: "33333333-3333-4333-8333-333333333333",
                publishedAt: new Date("2026-09-01T00:00:00.000Z"),
            }),
        ]);
        const svc = service(repo);
        const page1 = await svc.listPublicFeed({ feed: "latest", limit: 2 });
        assert.equal(page1.items.length, 2);
        assert.ok(page1.next_cursor);
        const page2 = await svc.listPublicFeed({
            feed: "latest",
            limit: 2,
            cursor: page1.next_cursor!,
        });
        assert.equal(page2.items.length, 1);
        assert.equal(page2.next_cursor, null);
        assert.equal(page2.items[0]?.public_id, "33333333-3333-4333-8333-333333333333");
    });

    it("Trusted feed only includes confirmed/verified published posts", async () => {
        const repo = new FakeCommunityRepository([
            postRow({ verificationStatus: "unverified" }),
            postRow({
                id: 2n,
                publicId: "22222222-2222-4222-8222-222222222222",
                verificationStatus: "community_confirmed",
            }),
            postRow({
                id: 3n,
                publicId: "33333333-3333-4333-8333-333333333333",
                verificationStatus: "admin_verified",
            }),
        ]);
        const page = await service(repo).listPublicFeed({ feed: "trusted", limit: 10 });
        assert.deepEqual(
            page.items.map((item) => item.public_id).sort(),
            [
                "22222222-2222-4222-8222-222222222222",
                "33333333-3333-4333-8333-333333333333",
            ].sort()
        );
    });

    it("replaces reaction weight and can auto-confirm then unconfirm", async () => {
        const row = postRow();
        const repo = new FakeCommunityRepository([row]);
        const svc = service(repo);
        const reactor = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        await svc.putReaction(reactor, row.publicId, "confirm");

        const u2 = "21212121-2121-4121-8121-212121212121";
        const u3 = "31313131-3131-4131-8131-313131313131";
        const u4 = "41414141-4141-4141-8141-414141414141";
        repo.users.set(u2, { id: 21n, active: true });
        repo.users.set(u3, { id: 22n, active: true });
        repo.users.set(u4, { id: 23n, active: true });

        await svc.putReaction(u2, row.publicId, "confirm");
        await svc.putReaction(u3, row.publicId, "confirm");
        const confirmed = await svc.putReaction(u4, row.publicId, "confirm");
        assert.equal(confirmed.verification_status, "community_confirmed");
        assert.equal(confirmed.trust_score, 8);

        // Replace one confirm with incorrect (-3 instead of +2) => score 8-2-3=3
        const lowered = await svc.putReaction(u4, row.publicId, "incorrect");
        assert.equal(lowered.trust_score, 3);
        assert.equal(lowered.verification_status, "unverified");
        assert.ok(repo.moderation.some((m) => m.actionCode === "community_auto_confirm"));
        assert.ok(repo.moderation.some((m) => m.actionCode === "community_auto_unconfirm"));
    });

    it("does not remove admin_verified when score drops", async () => {
        const row = postRow({ verificationStatus: "admin_verified", trustScore: 8 });
        const repo = new FakeCommunityRepository([row]);
        repo.reactions.set(`${row.id}:21`, "confirm");
        repo.reactions.set(`${row.id}:22`, "confirm");
        repo.reactions.set(`${row.id}:23`, "confirm");
        repo.reactions.set(`${row.id}:20`, "confirm");
        const u = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        const detail = await service(repo).putReaction(u, row.publicId, "incorrect");
        assert.equal(detail.verification_status, "admin_verified");
    });

    it("rejects illegal admin transitions", () => {
        assert.throws(
            () => resolveAdminTransition(postRow({ verificationStatus: "unverified" }), "unverify"),
            (error: unknown) =>
                error instanceof CommunityError && error.code === "INVALID_TRANSITION"
        );
        assert.throws(
            () =>
                resolveAdminTransition(
                    postRow({ publicationStatus: "resolved" }),
                    "verify"
                ),
            (error: unknown) =>
                error instanceof CommunityError && error.code === "INVALID_TRANSITION"
        );
    });

    it("records moderation history for admin verify", async () => {
        const row = postRow();
        const repo = new FakeCommunityRepository([row]);
        const admin = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
        const detail = await service(repo).moderate(admin, row.publicId, "verify");
        assert.equal(detail.verification_status, "admin_verified");
        assert.ok(repo.moderation.some((m) => m.actionCode === "verify"));
    });

    it("reopens resolved posts and stores restore action code", async () => {
        const row = postRow({ publicationStatus: "resolved" });
        const repo = new FakeCommunityRepository([row]);
        const detail = await service(repo).moderate(
            "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            row.publicId,
            "reopen"
        );
        assert.equal(detail.publication_status, "published");
        assert.ok(repo.moderation.some((m) => m.actionCode === "restore"));
    });

    it("requires a reason for reject", async () => {
        const row = postRow();
        await assert.rejects(
            () =>
                service(new FakeCommunityRepository([row])).moderate(
                    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                    row.publicId,
                    "reject"
                ),
            (error: unknown) =>
                error instanceof CommunityError && error.code === "NOTE_REQUIRED"
        );
    });

    it("hides non-published posts from public detail", async () => {
        const row = postRow({ publicationStatus: "rejected" });
        const repo = new FakeCommunityRepository([row]);
        await assert.rejects(
            () => service(repo).getPublicPost(row.publicId, null),
            (error: unknown) => error instanceof CommunityError && error.statusCode === 404
        );
    });

    it("public DTO never exposes internal ids or email", async () => {
        const row = postRow({ lng: 96.1, lat: 16.8, locationLabel: "Near jetty" });
        const detail = await service(new FakeCommunityRepository([row])).getPublicPost(
            row.publicId,
            null
        );
        const json = JSON.stringify(detail);
        assert.equal(detail.public_id, row.publicId);
        assert.equal(detail.author.public_id, row.authorPublicId);
        assert.equal(detail.author.display_name, "Author");
        assert.equal(json.includes('"id":'), false);
        assert.equal(json.includes("email"), false);
        assert.equal(json.includes("authorId"), false);
    });
});
