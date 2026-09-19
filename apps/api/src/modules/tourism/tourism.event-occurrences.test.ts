import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    deriveOccurrenceDuration,
    deriveOccurrenceState,
    enrichOccurrence,
    getCurrentOccurrences,
    getLatestOccurrenceForEvent,
    getNextOccurrenceForEvent,
    getUpcomingOccurrences,
    type TourismEventOccurrenceInput,
} from "./tourism.event-occurrences.js";

function occ(
    partial: Partial<TourismEventOccurrenceInput> &
        Pick<TourismEventOccurrenceInput, "id" | "eventId" | "startsAt" | "endsAt" | "status">
): TourismEventOccurrenceInput {
    return partial;
}

describe("deriveOccurrenceDuration", () => {
    it("derives a 2-day festival duration", () => {
        const duration = deriveOccurrenceDuration({
            startsAt: "2026-04-10T00:00:00.000Z",
            endsAt: "2026-04-12T00:00:00.000Z",
        });
        assert.equal(duration.durationSeconds, 2 * 24 * 60 * 60);
        assert.equal(duration.durationDays, 2);
    });

    it("derives a 2-month cultural event duration", () => {
        const duration = deriveOccurrenceDuration({
            startsAt: "2026-06-01T00:00:00.000Z",
            endsAt: "2026-08-01T00:00:00.000Z",
        });
        assert.equal(duration.durationDays, 61);
        assert.equal(duration.durationSeconds, 61 * 24 * 60 * 60);
    });

    it("supports cross-year Dec 28 2026 → Jan 5 2027", () => {
        const duration = deriveOccurrenceDuration({
            startsAt: "2026-12-28T00:00:00.000Z",
            endsAt: "2027-01-05T00:00:00.000Z",
        });
        assert.equal(duration.durationDays, 8);
        assert.equal(duration.durationSeconds, 8 * 24 * 60 * 60);
    });
});

describe("deriveOccurrenceState", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");

    it("marks cancelled when status is cancelled", () => {
        assert.equal(
            deriveOccurrenceState(
                occ({
                    id: 1,
                    eventId: 10,
                    startsAt: "2026-07-20T00:00:00.000Z",
                    endsAt: "2026-07-22T00:00:00.000Z",
                    status: "cancelled",
                }),
                now
            ),
            "cancelled"
        );
    });

    it("marks upcoming for scheduled before start", () => {
        assert.equal(
            deriveOccurrenceState(
                occ({
                    id: 1,
                    eventId: 10,
                    startsAt: "2026-07-20T00:00:00.000Z",
                    endsAt: "2026-07-22T00:00:00.000Z",
                    status: "scheduled",
                }),
                now
            ),
            "upcoming"
        );
    });

    it("marks upcoming for confirmed before start", () => {
        assert.equal(
            deriveOccurrenceState(
                occ({
                    id: 1,
                    eventId: 10,
                    startsAt: "2026-08-01T00:00:00.000Z",
                    endsAt: "2026-08-03T00:00:00.000Z",
                    status: "confirmed",
                }),
                now
            ),
            "upcoming"
        );
    });

    it("marks happening_now for confirmed inside the window", () => {
        assert.equal(
            deriveOccurrenceState(
                occ({
                    id: 1,
                    eventId: 10,
                    startsAt: "2026-07-01T00:00:00.000Z",
                    endsAt: "2026-07-31T23:59:59.000Z",
                    status: "confirmed",
                }),
                now
            ),
            "happening_now"
        );
    });

    it("does not mark happening_now for scheduled inside the window", () => {
        assert.equal(
            deriveOccurrenceState(
                occ({
                    id: 1,
                    eventId: 10,
                    startsAt: "2026-07-01T00:00:00.000Z",
                    endsAt: "2026-07-31T23:59:59.000Z",
                    status: "scheduled",
                }),
                now
            ),
            "scheduled"
        );
    });

    it("marks finished when status is completed", () => {
        assert.equal(
            deriveOccurrenceState(
                occ({
                    id: 1,
                    eventId: 10,
                    startsAt: "2026-07-10T00:00:00.000Z",
                    endsAt: "2026-07-20T00:00:00.000Z",
                    status: "completed",
                }),
                now
            ),
            "finished"
        );
    });

    it("marks finished when now is after ends_at", () => {
        assert.equal(
            deriveOccurrenceState(
                occ({
                    id: 1,
                    eventId: 10,
                    startsAt: "2026-06-01T00:00:00.000Z",
                    endsAt: "2026-07-01T00:00:00.000Z",
                    status: "confirmed",
                }),
                now
            ),
            "finished"
        );
    });

    it("keeps a long 2-month confirmed event as happening_now mid-span", () => {
        assert.equal(
            deriveOccurrenceState(
                occ({
                    id: 1,
                    eventId: 10,
                    startsAt: "2026-06-01T00:00:00.000Z",
                    endsAt: "2026-08-01T00:00:00.000Z",
                    status: "confirmed",
                    scheduleNote: "Open daily 10:00–18:00",
                }),
                now
            ),
            "happening_now"
        );
    });

    it("keeps a cross-year confirmed event as happening_now across New Year", () => {
        const newYear = new Date("2027-01-02T12:00:00.000Z");
        assert.equal(
            deriveOccurrenceState(
                occ({
                    id: 1,
                    eventId: 10,
                    startsAt: "2026-12-28T00:00:00.000Z",
                    endsAt: "2027-01-05T00:00:00.000Z",
                    status: "confirmed",
                }),
                newYear
            ),
            "happening_now"
        );
    });
});

describe("occurrence query helpers", () => {
    const eventId = 42n;
    const now = new Date("2026-07-15T12:00:00.000Z");

    const rows: TourismEventOccurrenceInput[] = [
        occ({
            id: 1,
            eventId,
            startsAt: "2024-04-10T00:00:00.000Z",
            endsAt: "2024-04-12T00:00:00.000Z",
            status: "completed",
            scheduleNote: "Weekends only during the festival period",
        }),
        occ({
            id: 2,
            eventId,
            startsAt: "2025-04-10T00:00:00.000Z",
            endsAt: "2025-04-12T00:00:00.000Z",
            status: "completed",
        }),
        occ({
            id: 3,
            eventId,
            startsAt: "2026-04-10T00:00:00.000Z",
            endsAt: "2026-04-12T00:00:00.000Z",
            status: "completed",
        }),
        occ({
            id: 4,
            eventId,
            startsAt: "2026-07-01T00:00:00.000Z",
            endsAt: "2026-07-31T00:00:00.000Z",
            status: "confirmed",
            scheduleNote: "Closed Mondays",
        }),
        occ({
            id: 5,
            eventId,
            startsAt: "2027-04-10T00:00:00.000Z",
            endsAt: "2027-04-12T00:00:00.000Z",
            status: "scheduled",
        }),
        occ({
            id: 6,
            eventId,
            startsAt: "2028-04-10T00:00:00.000Z",
            endsAt: "2028-04-12T00:00:00.000Z",
            status: "confirmed",
        }),
        occ({
            id: 7,
            eventId,
            startsAt: "2026-08-01T00:00:00.000Z",
            endsAt: "2026-08-03T00:00:00.000Z",
            status: "cancelled",
        }),
        occ({
            id: 8,
            eventId: 99n,
            startsAt: "2026-07-10T00:00:00.000Z",
            endsAt: "2026-07-20T00:00:00.000Z",
            status: "confirmed",
        }),
    ];

    it("returns current (happening_now) occurrences only", () => {
        const current = getCurrentOccurrences(rows, now);
        assert.equal(current.length, 2);
        assert.deepEqual(
            current.map((row) => String(row.id)).sort(),
            ["4", "8"]
        );
        assert.ok(current.every((row) => row.derivedState === "happening_now"));
    });

    it("returns upcoming occurrences sorted by starts_at", () => {
        const upcoming = getUpcomingOccurrences(rows, now);
        assert.deepEqual(
            upcoming.map((row) => String(row.id)),
            ["5", "6"]
        );
        assert.ok(upcoming.every((row) => row.derivedState === "upcoming"));
        assert.equal(upcoming[0]?.status, "scheduled");
        assert.equal(upcoming[1]?.status, "confirmed");
    });

    it("getLatestOccurrenceForEvent keeps yearly history and skips cancelled", () => {
        const latest = getLatestOccurrenceForEvent(rows, eventId, now);
        assert.ok(latest);
        assert.equal(String(latest.id), "6");
        assert.equal(latest.derivedState, "upcoming");
    });

    it("getNextOccurrenceForEvent returns the soonest future year", () => {
        const next = getNextOccurrenceForEvent(rows, eventId, now);
        assert.ok(next);
        assert.equal(String(next.id), "5");
        assert.equal(next.derivedState, "upcoming");
    });

    it("supports multiple yearly occurrences for the same event without overwrite", () => {
        const yearly = rows.filter(
            (row) =>
                String(row.eventId) === String(eventId) &&
                ["1", "2", "3", "5", "6"].includes(String(row.id))
        );
        assert.equal(yearly.length, 5);
        const years = yearly.map((row) => new Date(row.startsAt).getUTCFullYear()).sort();
        assert.deepEqual(years, [2024, 2025, 2026, 2027, 2028]);
    });

    it("enrichOccurrence attaches duration and derived state", () => {
        const enriched = enrichOccurrence(
            occ({
                id: 4,
                eventId,
                startsAt: "2026-07-01T00:00:00.000Z",
                endsAt: "2026-07-31T00:00:00.000Z",
                status: "confirmed",
                scheduleNote: "Open daily 10:00–18:00",
            }),
            now
        );
        assert.equal(enriched.derivedState, "happening_now");
        assert.equal(enriched.durationDays, 30);
        assert.equal(enriched.scheduleNote, "Open daily 10:00–18:00");
    });

    it("preserves schedule_note for long-running operating patterns", () => {
        const long = enrichOccurrence(
            occ({
                id: 9,
                eventId,
                startsAt: "2026-06-01T00:00:00.000Z",
                endsAt: "2026-08-01T00:00:00.000Z",
                status: "confirmed",
                scheduleNote: "Weekends only during the festival period",
            }),
            now
        );
        assert.equal(long.durationDays, 61);
        assert.equal(long.derivedState, "happening_now");
        assert.equal(long.scheduleNote, "Weekends only during the festival period");
    });
});
