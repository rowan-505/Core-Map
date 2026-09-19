import type { CommunityReactionType, CommunityVerificationStatus } from "@prisma/client";

export const REACTION_SCORES: Record<CommunityReactionType, number> = {
    confirm: 2,
    helpful: 1,
    incorrect: -3,
};

/** Auto community_confirmed when trust reaches this value (and back below it). */
export const AUTO_CONFIRM_THRESHOLD = 8;

export function scoreForReaction(reactionType: CommunityReactionType): number {
    return REACTION_SCORES[reactionType];
}

export function calculateTrustScore(
    reactions: ReadonlyArray<{ reactionType: CommunityReactionType }>
): number {
    return reactions.reduce((sum, reaction) => sum + scoreForReaction(reaction.reactionType), 0);
}

/**
 * Applies trust-driven verification changes.
 * - Never changes `admin_verified` (admin-only).
 * - Only meaningful while the post remains published (caller must gate).
 */
export function nextVerificationStatus(input: {
    current: CommunityVerificationStatus;
    trustScore: number;
}): {
    next: CommunityVerificationStatus;
    autoAction: "community_auto_confirm" | "community_auto_unconfirm" | null;
} {
    if (input.current === "admin_verified") {
        return { next: "admin_verified", autoAction: null };
    }

    if (input.trustScore >= AUTO_CONFIRM_THRESHOLD) {
        if (input.current === "community_confirmed") {
            return { next: "community_confirmed", autoAction: null };
        }
        return { next: "community_confirmed", autoAction: "community_auto_confirm" };
    }

    if (input.current === "community_confirmed") {
        return { next: "unverified", autoAction: "community_auto_unconfirm" };
    }

    return { next: "unverified", autoAction: null };
}
