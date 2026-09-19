import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    NotificationsService,
    toRelatedPostDto,
    type NotificationsError,
} from "./notifications.service.js";
import type {
    CreateNotificationInput,
    CreateNotificationResult,
    NotificationListRow,
    NotificationsRepository,
} from "./notifications.repo.js";
import { NotificationsWriter, mapCommunityStatusNotification } from "./notifications.writer.js";
import {
    decodeNotificationCursor,
    encodeNotificationCursor,
    InvalidNotificationCursorError,
} from "./notifications.schema.js";

class FakeNotificationsRepository implements Partial<NotificationsRepository> {
    users = new Map<string, { id: bigint; active: boolean }>([
        ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { id: 1n, active: true }],
        ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", { id: 2n, active: true }],
        ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", { id: 3n, active: false }],
    ]);
    rows: Array<
        NotificationListRow & {
            userId: bigint;
            eventKey: string;
            relatedPostId: bigint | null;
            deletedAt: Date | null;
        }
    > = [];

    async findUsableUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const user = this.users.get(publicId);
        if (!user?.active) return null;
        return user.id;
    }

    async countUnread(userId: bigint): Promise<number> {
        return this.rows.filter(
            (row) => row.userId === userId && !row.isRead && row.deletedAt === null
        ).length;
    }

    async listForUser(input: {
        userId: bigint;
        limit: number;
        unreadOnly?: boolean;
        cursor?: { createdAt: Date; publicId: string };
    }): Promise<NotificationListRow[]> {
        let rows = this.rows.filter(
            (row) => row.userId === input.userId && row.deletedAt === null
        );
        if (input.unreadOnly) {
            rows = rows.filter((row) => !row.isRead);
        }
        rows.sort((a, b) => {
            const byTime = b.createdAt.getTime() - a.createdAt.getTime();
            if (byTime !== 0) return byTime;
            return a.publicId < b.publicId ? 1 : -1;
        });
        if (input.cursor) {
            rows = rows.filter((row) => {
                if (row.createdAt.getTime() < input.cursor!.createdAt.getTime()) return true;
                if (row.createdAt.getTime() > input.cursor!.createdAt.getTime()) return false;
                return row.publicId < input.cursor!.publicId;
            });
        }
        return rows.slice(0, input.limit + 1);
    }

    async markOneRead(input: {
        userId: bigint;
        publicId: string;
    }): Promise<"updated" | "already_read" | "not_found"> {
        const row = this.rows.find(
            (item) =>
                item.publicId === input.publicId &&
                item.userId === input.userId &&
                item.deletedAt === null
        );
        if (!row) return "not_found";
        if (row.isRead) return "already_read";
        row.isRead = true;
        return "updated";
    }

    async markAllRead(userId: bigint): Promise<number> {
        let count = 0;
        for (const row of this.rows) {
            if (row.userId === userId && !row.isRead && row.deletedAt === null) {
                row.isRead = true;
                count += 1;
            }
        }
        return count;
    }

    async createIfAbsent(input: CreateNotificationInput): Promise<CreateNotificationResult> {
        if (input.actorUserId !== null && input.actorUserId === input.recipientUserId) {
            return "skipped_self";
        }
        if (this.rows.some((row) => row.userId === input.recipientUserId && row.eventKey === input.eventKey)) {
            return "skipped_duplicate";
        }
        this.rows.push({
            publicId: `nnnnnnnn-nnnn-4nnn-8nnn-${String(this.rows.length + 1).padStart(12, "0")}`,
            userId: input.recipientUserId,
            eventKey: input.eventKey,
            type: input.type,
            title: input.title,
            message: input.message,
            reactionType: input.reactionType ?? null,
            isRead: false,
            createdAt: new Date(`2026-09-01T00:00:${String(this.rows.length).padStart(2, "0")}.000Z`),
            actorPublicId: input.actorUserId === 2n ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : null,
            actorDisplayName: input.actorUserId === 2n ? "Reactor" : null,
            relatedPostId: input.relatedPostId,
            relatedPostPublicId: input.relatedPostId
                ? "11111111-1111-4111-8111-111111111111"
                : null,
            relatedPostTitle: "Flood near jetty",
            relatedPostPublicationStatus: "published",
            relatedPostDeletedAt: null,
            deletedAt: null,
        });
        return "created";
    }
}

function service(repo: FakeNotificationsRepository): NotificationsService {
    return new NotificationsService(repo as unknown as NotificationsRepository);
}

describe("notifications cursor", () => {
    it("round-trips opaque cursors", () => {
        const encoded = encodeNotificationCursor({
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
            publicId: "11111111-1111-4111-8111-111111111111",
        });
        const decoded = decodeNotificationCursor(encoded);
        assert.equal(decoded.publicId, "11111111-1111-4111-8111-111111111111");
        assert.throws(() => decodeNotificationCursor("bad"), InvalidNotificationCursorError);
    });
});

describe("notifications privacy helpers", () => {
    it("hides title for deleted or non-published related posts", () => {
        const available = toRelatedPostDto({
            publicId: "n1",
            type: "post_reaction",
            title: "t",
            message: "m",
            reactionType: "confirm",
            isRead: false,
            createdAt: new Date(),
            actorPublicId: null,
            actorDisplayName: null,
            relatedPostPublicId: "11111111-1111-4111-8111-111111111111",
            relatedPostTitle: "Secret",
            relatedPostPublicationStatus: "published",
            relatedPostDeletedAt: null,
        });
        assert.equal(available?.available, true);
        assert.equal(available?.title, "Secret");

        const hidden = toRelatedPostDto({
            publicId: "n1",
            type: "post_reaction",
            title: "t",
            message: "m",
            reactionType: null,
            isRead: false,
            createdAt: new Date(),
            actorPublicId: null,
            actorDisplayName: null,
            relatedPostPublicId: "11111111-1111-4111-8111-111111111111",
            relatedPostTitle: "Secret",
            relatedPostPublicationStatus: "removed",
            relatedPostDeletedAt: new Date(),
        });
        assert.equal(hidden?.available, false);
        assert.equal(hidden?.title, null);
        assert.equal(hidden?.public_id, "11111111-1111-4111-8111-111111111111");
    });
});

describe("notifications.writer", () => {
    it("maps first-release status transitions and skips unsupported ones", () => {
        assert.equal(mapCommunityStatusNotification("community_auto_confirm")?.type, "post_community_confirmed");
        assert.equal(mapCommunityStatusNotification("verify")?.type, "post_admin_verified");
        assert.equal(mapCommunityStatusNotification("resolve")?.type, "post_resolved");
        assert.equal(mapCommunityStatusNotification("restore")?.type, "post_reopened");
        assert.equal(mapCommunityStatusNotification("reject")?.type, "post_rejected");
        assert.equal(mapCommunityStatusNotification("expire")?.type, "post_expired");
        assert.equal(mapCommunityStatusNotification("unverify"), null);
        assert.equal(mapCommunityStatusNotification("community_auto_unconfirm"), null);
    });

    it("never notifies a user about their own action", async () => {
        const repo = new FakeNotificationsRepository();
        const writer = new NotificationsWriter(repo as unknown as NotificationsRepository);
        const result = await writer.notifyPostReaction(
            {
                recipientUserId: 1n,
                actorUserId: 1n,
                postId: 9n,
                reactionType: "confirm",
            },
            {} as never
        );
        assert.equal(result, "skipped_self");
        assert.equal(repo.rows.length, 0);
    });

    it("dedupes identical domain events on retry", async () => {
        const repo = new FakeNotificationsRepository();
        const writer = new NotificationsWriter(repo as unknown as NotificationsRepository);
        const input = {
            recipientUserId: 1n,
            actorUserId: 2n,
            postId: 9n,
            reactionType: "helpful" as const,
        };
        assert.equal(await writer.notifyPostReaction(input, {} as never), "created");
        assert.equal(await writer.notifyPostReaction(input, {} as never), "skipped_duplicate");
        assert.equal(repo.rows.length, 1);
    });

    it("creates status + moderation_message for noted admin actions", async () => {
        const repo = new FakeNotificationsRepository();
        const writer = new NotificationsWriter(repo as unknown as NotificationsRepository);
        const result = await writer.notifyCommunityStatusChange(
            {
                recipientUserId: 1n,
                actorUserId: 2n,
                postId: 9n,
                actionCode: "reject",
                moderationEventPublicId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                note: "Please provide a clearer landmark.",
            },
            {} as never
        );
        assert.equal(result.status, "created");
        assert.equal(result.moderationMessage, "created");
        assert.equal(repo.rows.length, 2);
        assert.deepEqual(
            repo.rows.map((row) => row.type).sort(),
            ["moderation_message", "post_rejected"]
        );
    });
});

describe("notifications.service", () => {
    it("enforces ownership: mark-read of another user returns not found", async () => {
        const repo = new FakeNotificationsRepository();
        repo.rows.push({
            publicId: "99999999-9999-4999-8999-999999999999",
            userId: 2n,
            eventKey: "x",
            type: "post_reaction",
            title: "t",
            message: "m",
            reactionType: "confirm",
            isRead: false,
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
            actorPublicId: null,
            actorDisplayName: null,
            relatedPostId: 1n,
            relatedPostPublicId: "11111111-1111-4111-8111-111111111111",
            relatedPostTitle: "Flood",
            relatedPostPublicationStatus: "published",
            relatedPostDeletedAt: null,
            deletedAt: null,
        });
        await assert.rejects(
            () =>
                service(repo).markRead(
                    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                    "99999999-9999-4999-8999-999999999999"
                ),
            (error: unknown) =>
                (error as NotificationsError).statusCode === 404
        );
    });

    it("returns unread count and mark-one / mark-all read", async () => {
        const repo = new FakeNotificationsRepository();
        const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        for (let i = 0; i < 3; i += 1) {
            repo.rows.push({
                publicId: `99999999-9999-4999-8999-${String(i).padStart(12, "0")}`,
                userId: 1n,
                eventKey: `e${i}`,
                type: "post_reaction",
                title: "t",
                message: "m",
                reactionType: "confirm",
                isRead: false,
                createdAt: new Date(`2026-09-01T00:0${i}:00.000Z`),
                actorPublicId: null,
                actorDisplayName: null,
                relatedPostId: 1n,
                relatedPostPublicId: "11111111-1111-4111-8111-111111111111",
                relatedPostTitle: "Flood",
                relatedPostPublicationStatus: "published",
                relatedPostDeletedAt: null,
                deletedAt: null,
            });
        }

        const svc = service(repo);
        assert.deepEqual(await svc.unreadCount(user), { unread_count: 3 });
        await svc.markRead(user, "99999999-9999-4999-8999-000000000000");
        assert.deepEqual(await svc.unreadCount(user), { unread_count: 2 });
        assert.deepEqual(await svc.markAllRead(user), { updated_count: 2 });
        assert.deepEqual(await svc.unreadCount(user), { unread_count: 0 });
    });

    it("rejects inactive accounts", async () => {
        await assert.rejects(
            () => service(new FakeNotificationsRepository()).unreadCount("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
            (error: unknown) =>
                (error as NotificationsError).statusCode === 403
        );
    });

    it("lists only the caller's notifications with public ids", async () => {
        const repo = new FakeNotificationsRepository();
        repo.rows.push({
            publicId: "99999999-9999-4999-8999-000000000001",
            userId: 1n,
            eventKey: "mine",
            type: "post_admin_verified",
            title: "Post CoreMap Verified",
            message: "verified",
            reactionType: null,
            isRead: false,
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
            actorPublicId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            actorDisplayName: "Admin",
            relatedPostId: 1n,
            relatedPostPublicId: "11111111-1111-4111-8111-111111111111",
            relatedPostTitle: "Flood",
            relatedPostPublicationStatus: "published",
            relatedPostDeletedAt: null,
            deletedAt: null,
        });
        repo.rows.push({
            publicId: "99999999-9999-4999-8999-000000000002",
            userId: 2n,
            eventKey: "other",
            type: "post_rejected",
            title: "hidden",
            message: "nope",
            reactionType: null,
            isRead: false,
            createdAt: new Date("2026-09-01T00:01:00.000Z"),
            actorPublicId: null,
            actorDisplayName: null,
            relatedPostId: null,
            relatedPostPublicId: null,
            relatedPostTitle: null,
            relatedPostPublicationStatus: null,
            relatedPostDeletedAt: null,
            deletedAt: null,
        });

        const page = await service(repo).list("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
            limit: 10,
        });
        assert.equal(page.items.length, 1);
        assert.equal(page.items[0]?.public_id, "99999999-9999-4999-8999-000000000001");
        assert.equal(page.items[0]?.actor?.public_id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        assert.equal(JSON.stringify(page).includes('"id":'), false);
        assert.equal(JSON.stringify(page).includes("email"), false);
    });
});
