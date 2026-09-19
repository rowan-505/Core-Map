/**
 * Query-time helpers for tourism.event_occurrences.
 * Derived state and duration are never persisted.
 *
 * Short and long events share the same occurrence row model:
 * starts_at / ends_at span any length (2 days, 2 months, cross-year).
 * Human operating patterns live in schedule_note (no RRULE parsing).
 * Annual festivals reuse one tourism.events row with many yearly occurrence rows.
 */

import type { TourismEventOccurrenceStatus } from "./tourism.types.js";

const MS_PER_SECOND = 1_000;
const MS_PER_DAY = 86_400_000;

/**
 * Derived lifecycle labels — computed only, not stored.
 * `scheduled` covers status=scheduled while the window is open
 * (not confirmed, so not happening_now).
 */
export const TOURISM_OCCURRENCE_DERIVED_STATES = [
    "cancelled",
    "upcoming",
    "happening_now",
    "finished",
    "scheduled",
] as const;

export type TourismOccurrenceDerivedState =
    (typeof TOURISM_OCCURRENCE_DERIVED_STATES)[number];

export type TourismEventOccurrenceInput = {
    id: bigint | string | number;
    publicId?: string;
    eventId: bigint | string | number;
    startsAt: Date | string;
    endsAt: Date | string;
    status: TourismEventOccurrenceStatus | string;
    scheduleNote?: string | null;
    sourceUrl?: string | null;
    verifiedAt?: Date | string | null;
};

export type TourismOccurrenceDuration = {
    durationSeconds: number;
    durationDays: number;
};

export type TourismOccurrenceDerived = TourismOccurrenceDuration & {
    derivedState: TourismOccurrenceDerivedState;
    startsAt: Date;
    endsAt: Date;
    status: string;
};

function toDate(value: Date | string): Date {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new TypeError(`Invalid occurrence timestamp: ${String(value)}`);
    }
    return date;
}

function sameId(a: bigint | string | number, b: bigint | string | number): boolean {
    return String(a) === String(b);
}

/** Duration from starts_at → ends_at. Never stored. */
export function deriveOccurrenceDuration(
    occurrence: Pick<TourismEventOccurrenceInput, "startsAt" | "endsAt">
): TourismOccurrenceDuration {
    const startsAt = toDate(occurrence.startsAt);
    const endsAt = toDate(occurrence.endsAt);
    const ms = endsAt.getTime() - startsAt.getTime();
    return {
        durationSeconds: ms / MS_PER_SECOND,
        durationDays: ms / MS_PER_DAY,
    };
}

/**
 * Derive a single lifecycle state for an occurrence at `now`.
 *
 * Matching rules (exclusive, in priority order):
 * - cancelled: status = cancelled
 * - finished: status = completed OR now > ends_at
 * - happening_now: starts_at <= now <= ends_at AND status = confirmed
 * - upcoming: now < starts_at AND status IN (scheduled, confirmed)
 * - scheduled: status = scheduled and the window is open (not yet confirmed)
 */
export function deriveOccurrenceState(
    occurrence: Pick<TourismEventOccurrenceInput, "startsAt" | "endsAt" | "status">,
    now: Date = new Date()
): TourismOccurrenceDerivedState {
    const startsAt = toDate(occurrence.startsAt);
    const endsAt = toDate(occurrence.endsAt);
    const status = occurrence.status;
    const t = now.getTime();

    if (status === "cancelled") {
        return "cancelled";
    }

    if (status === "completed" || t > endsAt.getTime()) {
        return "finished";
    }

    if (
        status === "confirmed" &&
        startsAt.getTime() <= t &&
        endsAt.getTime() >= t
    ) {
        return "happening_now";
    }

    if (
        (status === "scheduled" || status === "confirmed") &&
        t < startsAt.getTime()
    ) {
        return "upcoming";
    }

    return "scheduled";
}

export function enrichOccurrence(
    occurrence: TourismEventOccurrenceInput,
    now: Date = new Date()
): TourismEventOccurrenceInput & TourismOccurrenceDerived {
    const startsAt = toDate(occurrence.startsAt);
    const endsAt = toDate(occurrence.endsAt);
    const duration = deriveOccurrenceDuration({ startsAt, endsAt });
    return {
        ...occurrence,
        startsAt,
        endsAt,
        status: occurrence.status,
        derivedState: deriveOccurrenceState(occurrence, now),
        ...duration,
    };
}

function sortByStartsAtAsc(
    a: TourismEventOccurrenceInput,
    b: TourismEventOccurrenceInput
): number {
    return toDate(a.startsAt).getTime() - toDate(b.startsAt).getTime();
}

function sortByStartsAtDesc(
    a: TourismEventOccurrenceInput,
    b: TourismEventOccurrenceInput
): number {
    return toDate(b.startsAt).getTime() - toDate(a.startsAt).getTime();
}

/** Confirmed occurrences happening at `now`. */
export function getCurrentOccurrences(
    occurrences: readonly TourismEventOccurrenceInput[],
    now: Date = new Date()
): Array<TourismEventOccurrenceInput & TourismOccurrenceDerived> {
    return occurrences
        .filter((row) => deriveOccurrenceState(row, now) === "happening_now")
        .map((row) => enrichOccurrence(row, now))
        .sort(sortByStartsAtAsc);
}

/** Scheduled/confirmed occurrences that have not started yet. */
export function getUpcomingOccurrences(
    occurrences: readonly TourismEventOccurrenceInput[],
    now: Date = new Date()
): Array<TourismEventOccurrenceInput & TourismOccurrenceDerived> {
    return occurrences
        .filter((row) => deriveOccurrenceState(row, now) === "upcoming")
        .map((row) => enrichOccurrence(row, now))
        .sort(sortByStartsAtAsc);
}

/**
 * Most recent occurrence for an event by starts_at (including past years).
 * Cancelled rows are excluded so annual history stays usable.
 */
export function getLatestOccurrenceForEvent(
    occurrences: readonly TourismEventOccurrenceInput[],
    eventId: bigint | string | number,
    now: Date = new Date()
): (TourismEventOccurrenceInput & TourismOccurrenceDerived) | null {
    const rows = occurrences
        .filter((row) => sameId(row.eventId, eventId) && row.status !== "cancelled")
        .sort(sortByStartsAtDesc);

    const latest = rows[0];
    return latest ? enrichOccurrence(latest, now) : null;
}

/**
 * Next upcoming occurrence for an event (scheduled or confirmed, starts after now).
 */
export function getNextOccurrenceForEvent(
    occurrences: readonly TourismEventOccurrenceInput[],
    eventId: bigint | string | number,
    now: Date = new Date()
): (TourismEventOccurrenceInput & TourismOccurrenceDerived) | null {
    const upcoming = getUpcomingOccurrences(
        occurrences.filter((row) => sameId(row.eventId, eventId)),
        now
    );
    return upcoming[0] ?? null;
}
