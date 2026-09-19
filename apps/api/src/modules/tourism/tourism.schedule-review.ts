/**
 * Query-time schedule review states for tourism activities / events.
 * Derived only — never persisted.
 */

export const TOURISM_SCHEDULE_REVIEW_STATES = [
    "none",
    "current",
    "due_soon",
    "overdue",
] as const;

export type TourismScheduleReviewState =
    (typeof TOURISM_SCHEDULE_REVIEW_STATES)[number];

/** Admin list filter values. */
export const TOURISM_SCHEDULE_REVIEW_FILTERS = [
    "current",
    "due_soon",
    "overdue",
    "needs_review",
] as const;

export type TourismScheduleReviewFilter =
    (typeof TOURISM_SCHEDULE_REVIEW_FILTERS)[number];

/** Days before due date that count as "due soon". */
export const TOURISM_SCHEDULE_REVIEW_DUE_SOON_DAYS = 30;

const MS_PER_DAY = 86_400_000;

export type ScheduleReviewInput = {
    requiresScheduleReview: boolean;
    nextReviewDueAt: Date | string | null | undefined;
};

export type EventOccurrenceForReview = {
    startsAt: Date | string;
    endsAt: Date | string;
    status: string;
};

function toDate(value: Date | string): Date {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new TypeError(`Invalid schedule review timestamp: ${String(value)}`);
    }
    return date;
}

/**
 * Derive schedule review lifecycle from stored flags/dates.
 *
 * - none: requires_schedule_review = false
 * - current: due more than 30 days out
 * - due_soon: due within the next 30 days (still in the future)
 * - overdue: due date passed, or review required with no next_review_due_at
 */
export function deriveScheduleReviewState(
    input: ScheduleReviewInput,
    now: Date = new Date()
): TourismScheduleReviewState {
    if (!input.requiresScheduleReview) {
        return "none";
    }

    if (input.nextReviewDueAt == null || input.nextReviewDueAt === "") {
        return "overdue";
    }

    const dueAt = toDate(input.nextReviewDueAt);
    const dueMs = dueAt.getTime();
    const nowMs = now.getTime();
    const soonMs = nowMs + TOURISM_SCHEDULE_REVIEW_DUE_SOON_DAYS * MS_PER_DAY;

    if (dueMs <= nowMs) {
        return "overdue";
    }
    if (dueMs <= soonMs) {
        return "due_soon";
    }
    return "current";
}

/**
 * Events only: latest occurrence has ended and no future scheduled/confirmed row exists.
 * Puts the event into Need Review even when next_review_due_at is null or wrong.
 */
export function hasMissingNextOccurrence(
    occurrences: readonly EventOccurrenceForReview[],
    now: Date = new Date(),
    requiresScheduleReview = true
): boolean {
    if (!requiresScheduleReview) {
        return false;
    }

    const nowMs = now.getTime();
    const usable = occurrences.filter(
        (row) => row.status === "scheduled" || row.status === "confirmed"
    );

    const hasFuture = usable.some((row) => toDate(row.startsAt).getTime() > nowMs);
    if (hasFuture) {
        return false;
    }

    // Need at least one ended occurrence (latest has ended / no future left).
    // If there are zero usable occurrences at all, also treat as missing next.
    if (usable.length === 0) {
        return true;
    }

    const latestEnded = usable.every((row) => toDate(row.endsAt).getTime() < nowMs);
    return latestEnded;
}

/** Need Review queue membership. */
export function isScheduleNeedsReview(input: {
    reviewState: TourismScheduleReviewState;
    missingNextOccurrence?: boolean;
}): boolean {
    if (input.missingNextOccurrence) {
        return true;
    }
    return input.reviewState === "due_soon" || input.reviewState === "overdue";
}

export function matchesScheduleReviewFilter(
    filter: TourismScheduleReviewFilter,
    input: {
        reviewState: TourismScheduleReviewState;
        missingNextOccurrence?: boolean;
    }
): boolean {
    if (filter === "needs_review") {
        return isScheduleNeedsReview(input);
    }
    if (filter === "due_soon" || filter === "overdue" || filter === "current") {
        return input.reviewState === filter;
    }
    return false;
}
