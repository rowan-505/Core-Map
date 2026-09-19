import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    deriveScheduleReviewState,
    hasMissingNextOccurrence,
    isScheduleNeedsReview,
    matchesScheduleReviewFilter,
} from "./tourism.schedule-review.js";

const NOW = new Date("2026-07-15T12:00:00.000Z");

describe("deriveScheduleReviewState", () => {
    it("returns none when review is not required", () => {
        assert.equal(
            deriveScheduleReviewState(
                {
                    requiresScheduleReview: false,
                    nextReviewDueAt: "2026-01-01T00:00:00.000Z",
                },
                NOW
            ),
            "none"
        );
    });

    it("returns current when due more than 30 days out", () => {
        assert.equal(
            deriveScheduleReviewState(
                {
                    requiresScheduleReview: true,
                    nextReviewDueAt: "2026-09-01T00:00:00.000Z",
                },
                NOW
            ),
            "current"
        );
    });

    it("returns due_soon within the next 30 days", () => {
        assert.equal(
            deriveScheduleReviewState(
                {
                    requiresScheduleReview: true,
                    nextReviewDueAt: "2026-08-01T00:00:00.000Z",
                },
                NOW
            ),
            "due_soon"
        );
    });

    it("returns overdue when due date has passed", () => {
        assert.equal(
            deriveScheduleReviewState(
                {
                    requiresScheduleReview: true,
                    nextReviewDueAt: "2026-07-01T00:00:00.000Z",
                },
                NOW
            ),
            "overdue"
        );
    });

    it("returns overdue when next_review_due_at is null", () => {
        assert.equal(
            deriveScheduleReviewState(
                { requiresScheduleReview: true, nextReviewDueAt: null },
                NOW
            ),
            "overdue"
        );
    });
});

describe("hasMissingNextOccurrence", () => {
    it("is true when latest occurrence ended and no future scheduled/confirmed exists", () => {
        assert.equal(
            hasMissingNextOccurrence(
                [
                    {
                        startsAt: "2025-04-10T00:00:00.000Z",
                        endsAt: "2025-04-12T00:00:00.000Z",
                        status: "completed",
                    },
                    {
                        startsAt: "2026-04-10T00:00:00.000Z",
                        endsAt: "2026-04-12T00:00:00.000Z",
                        status: "confirmed",
                    },
                ],
                NOW
            ),
            true
        );
    });

    it("is false when a future occurrence exists", () => {
        assert.equal(
            hasMissingNextOccurrence(
                [
                    {
                        startsAt: "2026-04-10T00:00:00.000Z",
                        endsAt: "2026-04-12T00:00:00.000Z",
                        status: "completed",
                    },
                    {
                        startsAt: "2027-04-10T00:00:00.000Z",
                        endsAt: "2027-04-12T00:00:00.000Z",
                        status: "scheduled",
                    },
                ],
                NOW
            ),
            false
        );
    });

    it("ignores cancelled future rows", () => {
        assert.equal(
            hasMissingNextOccurrence(
                [
                    {
                        startsAt: "2026-04-10T00:00:00.000Z",
                        endsAt: "2026-04-12T00:00:00.000Z",
                        status: "confirmed",
                    },
                    {
                        startsAt: "2027-04-10T00:00:00.000Z",
                        endsAt: "2027-04-12T00:00:00.000Z",
                        status: "cancelled",
                    },
                ],
                NOW
            ),
            true
        );
    });

    it("is false when schedule review is not required", () => {
        assert.equal(
            hasMissingNextOccurrence([], NOW, false),
            false
        );
    });

    it("does not invent or copy dates — empty usable list is missing", () => {
        assert.equal(hasMissingNextOccurrence([], NOW, true), true);
    });
});

describe("needs_review filter helpers", () => {
    it("includes due_soon, overdue, and missing next occurrence", () => {
        assert.equal(
            isScheduleNeedsReview({ reviewState: "due_soon" }),
            true
        );
        assert.equal(
            isScheduleNeedsReview({ reviewState: "overdue" }),
            true
        );
        assert.equal(
            isScheduleNeedsReview({
                reviewState: "current",
                missingNextOccurrence: true,
            }),
            true
        );
        assert.equal(
            isScheduleNeedsReview({ reviewState: "current" }),
            false
        );
        assert.equal(
            isScheduleNeedsReview({ reviewState: "none" }),
            false
        );
    });

    it("matches filter values", () => {
        assert.equal(
            matchesScheduleReviewFilter("needs_review", {
                reviewState: "overdue",
            }),
            true
        );
        assert.equal(
            matchesScheduleReviewFilter("current", {
                reviewState: "current",
            }),
            true
        );
        assert.equal(
            matchesScheduleReviewFilter("due_soon", {
                reviewState: "overdue",
            }),
            false
        );
    });
});
