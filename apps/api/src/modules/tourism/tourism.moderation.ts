import { TourismReviewsError } from "./tourism.errors.js";
import type { TourismReviewStatus } from "./tourism.types.js";

export const TOURISM_ADMIN_MODERATION_ACTIONS = [
    "publish",
    "reject",
    "hide",
    "restore",
] as const;

export type TourismAdminModerationAction = (typeof TOURISM_ADMIN_MODERATION_ACTIONS)[number];

export type TourismModerationTransition = {
    /** When true, caller should return the current review without writing events. */
    idempotent: boolean;
    toStatus: Exclude<TourismReviewStatus, "deleted">;
};

/**
 * Resolve the next status for an admin moderation action.
 *
 * Restore convention:
 * - Only `hidden` reviews can be restored.
 * - If the review was ever published (`published_at` set), restore → `published`.
 * - Otherwise restore → `pending` (never publicly live).
 * - Soft-deleted reviews cannot be restored.
 */
export function resolveTourismAdminTransition(
    action: TourismAdminModerationAction,
    review: { status: TourismReviewStatus; publishedAt: Date | null }
): TourismModerationTransition {
    if (review.status === "deleted") {
        throw new TourismReviewsError(
            "Deleted reviews cannot be moderated",
            409,
            "DELETED"
        );
    }

    if (action === "publish") {
        if (review.status === "published") {
            return { idempotent: true, toStatus: "published" };
        }
        if (
            review.status === "pending" ||
            review.status === "rejected" ||
            review.status === "hidden"
        ) {
            return { idempotent: false, toStatus: "published" };
        }
        throw new TourismReviewsError(
            "Review cannot be published from the current status",
            409,
            "INVALID_TRANSITION"
        );
    }

    if (action === "reject") {
        if (review.status === "rejected") {
            return { idempotent: true, toStatus: "rejected" };
        }
        if (
            review.status === "pending" ||
            review.status === "published" ||
            review.status === "hidden"
        ) {
            return { idempotent: false, toStatus: "rejected" };
        }
        throw new TourismReviewsError(
            "Review cannot be rejected from the current status",
            409,
            "INVALID_TRANSITION"
        );
    }

    if (action === "hide") {
        if (review.status === "hidden") {
            return { idempotent: true, toStatus: "hidden" };
        }
        if (
            review.status === "pending" ||
            review.status === "published" ||
            review.status === "rejected"
        ) {
            return { idempotent: false, toStatus: "hidden" };
        }
        throw new TourismReviewsError(
            "Review cannot be hidden from the current status",
            409,
            "INVALID_TRANSITION"
        );
    }

    // restore
    if (review.status !== "hidden") {
        throw new TourismReviewsError(
            "Only hidden reviews can be restored",
            409,
            "INVALID_TRANSITION"
        );
    }
    return {
        idempotent: false,
        toStatus: review.publishedAt ? "published" : "pending",
    };
}
