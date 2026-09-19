import type { CommunityReactionType, Prisma } from "@prisma/client";

import {
    NotificationsRepository,
    type CreateNotificationResult,
} from "./notifications.repo.js";
import type { NotificationType } from "./notifications.schema.js";

type TxClient = Prisma.TransactionClient;

export type CommunityStatusNotifyAction =
    | "community_auto_confirm"
    | "verify"
    | "resolve"
    | "reject"
    | "expire"
    | "restore"
    | "unverify"
    | "community_auto_unconfirm"
    | "remove"
    | "publish"
    | "other"
    | "author_update"
    | "author_delete";

/**
 * Community-facing notification writer.
 * Encodes first-release types, self-skip, and event_key dedupe only.
 * Does not decide community trust/moderation rules.
 */
export class NotificationsWriter {
    constructor(private readonly repo: NotificationsRepository) {}

    async notifyPostReaction(
        input: {
            recipientUserId: bigint;
            actorUserId: bigint;
            postId: bigint;
            reactionType: CommunityReactionType;
        },
        tx: TxClient
    ): Promise<CreateNotificationResult> {
        return this.repo.createIfAbsent(
            {
                recipientUserId: input.recipientUserId,
                actorUserId: input.actorUserId,
                type: "post_reaction",
                eventKey: `post_reaction:${input.postId}:${input.actorUserId}:${input.reactionType}`,
                reactionType: input.reactionType,
                relatedPostId: input.postId,
                title: "New reaction on your post",
                message: `Someone marked your post as ${input.reactionType}.`,
            },
            tx
        );
    }

    async notifyCommunityStatusChange(
        input: {
            recipientUserId: bigint;
            actorUserId: bigint | null;
            postId: bigint;
            actionCode: CommunityStatusNotifyAction;
            moderationEventPublicId: string;
            note?: string | null;
        },
        tx: TxClient
    ): Promise<{
        status: CreateNotificationResult | "skipped_unsupported";
        moderationMessage: CreateNotificationResult | "skipped_unsupported" | null;
    }> {
        const mapped = mapCommunityStatusNotification(input.actionCode);
        let status: CreateNotificationResult | "skipped_unsupported" = "skipped_unsupported";

        if (mapped) {
            status = await this.repo.createIfAbsent(
                {
                    recipientUserId: input.recipientUserId,
                    actorUserId: input.actorUserId,
                    type: mapped.type,
                    eventKey: `${mapped.type}:${input.moderationEventPublicId}`,
                    relatedPostId: input.postId,
                    title: mapped.title,
                    message: mapped.message,
                },
                tx
            );
        }

        let moderationMessage: CreateNotificationResult | "skipped_unsupported" | null = null;
        const note = input.note?.trim();
        if (note) {
            moderationMessage = await this.repo.createIfAbsent(
                {
                    recipientUserId: input.recipientUserId,
                    actorUserId: input.actorUserId,
                    type: "moderation_message",
                    eventKey: `moderation_message:${input.moderationEventPublicId}`,
                    relatedPostId: input.postId,
                    title: "Moderation message",
                    message: note,
                },
                tx
            );
        }

        return { status, moderationMessage };
    }
}

export function mapCommunityStatusNotification(
    actionCode: CommunityStatusNotifyAction
): { type: NotificationType; title: string; message: string } | null {
    switch (actionCode) {
        case "community_auto_confirm":
            return {
                type: "post_community_confirmed",
                title: "Post community confirmed",
                message: "Your post reached Community Confirmed from neighbor reactions.",
            };
        case "verify":
            return {
                type: "post_admin_verified",
                title: "Post CoreMap Verified",
                message: "An admin marked your post as CoreMap Verified.",
            };
        case "resolve":
            return {
                type: "post_resolved",
                title: "Post resolved",
                message: "An admin marked your post as resolved.",
            };
        case "restore":
            return {
                type: "post_reopened",
                title: "Post reopened",
                message: "An admin reopened your post.",
            };
        case "reject":
            return {
                type: "post_rejected",
                title: "Post rejected",
                message: "An admin rejected your post.",
            };
        case "expire":
            return {
                type: "post_expired",
                title: "Post expired",
                message: "An admin marked your post as expired.",
            };
        // First-release list intentionally omits unverify / auto-unconfirm.
        default:
            return null;
    }
}
