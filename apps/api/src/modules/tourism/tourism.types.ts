/**
 * Tourism DB vocabulary for API/repos.
 * Sources:
 *   20260917030000_tourism_reviews_ranking_foundation.sql
 *   20260917024448_tourism_taxonomy_and_ranking_inputs.sql
 */

/** Matches community.place_reviews.status / moderation from/to CHECK. */
export const TOURISM_REVIEW_STATUSES = [
    "pending",
    "published",
    "rejected",
    "hidden",
    "deleted",
] as const;

export type TourismReviewStatus = (typeof TOURISM_REVIEW_STATUSES)[number];

export const TOURISM_ACTIVE_REVIEW_STATUSES = [
    "pending",
    "published",
    "rejected",
    "hidden",
] as const;

export type TourismActiveReviewStatus = (typeof TOURISM_ACTIVE_REVIEW_STATUSES)[number];

export const TOURISM_PUBLIC_REVIEW_STATUS = "published" as const satisfies TourismReviewStatus;

export const TOURISM_REVIEW_RATING_MIN = 1;
export const TOURISM_REVIEW_RATING_MAX = 5;

export const TOURISM_PRICE_LEVEL_MIN = 0;
export const TOURISM_PRICE_LEVEL_MAX = 4;

/** V1 codes in ref.ref_tourism_types (API accepts these codes, not free text). */
export const TOURISM_TYPE_CODES = [
    "attraction",
    "religious",
    "historical",
    "cultural",
    "nature",
    "museum",
    "viewpoint",
    "beach",
    "waterfall",
    "park",
    "market",
    "recreation",
    "other",
] as const;

export type TourismTypeCode = (typeof TOURISM_TYPE_CODES)[number];

/** @deprecated length checks replaced by closed taxonomy codes. */
export const TOURISM_TYPE_MIN_LENGTH = 1;
export const TOURISM_TYPE_MAX_LENGTH = 64;

export type TourismType = TourismTypeCode;

export const TOURISM_SEASON_MODES = [
    "all_year",
    "best_months",
    "poor_months",
    "temporarily_closed",
] as const;

export type TourismSeasonMode = (typeof TOURISM_SEASON_MODES)[number];

/** Admin UI editorial levels → stored editorial_score (0–100). */
export const TOURISM_EDITORIAL_SCORE_LEVELS = [
    { id: "very_weak", label: "Very weak", score: 20 },
    { id: "minor", label: "Minor", score: 35 },
    { id: "normal", label: "Normal", score: 50 },
    { id: "good", label: "Good", score: 65 },
    { id: "major", label: "Major", score: 80 },
    { id: "must_see", label: "Must-see", score: 95 },
] as const;

export const TOURISM_EDITORIAL_SCORES = TOURISM_EDITORIAL_SCORE_LEVELS.map(
    (level) => level.score
) as unknown as readonly [number, ...number[]];

export const TOURISM_MANUAL_BOOST_MIN = -10;
export const TOURISM_MANUAL_BOOST_MAX = 10;

export const TOURISM_REVIEW_TITLE_MAX_LENGTH = 200;
export const TOURISM_REVIEW_BODY_MAX_LENGTH = 5000;
export const TOURISM_MODERATION_NOTE_MAX_LENGTH = 2000;
export const TOURISM_SHORT_DESCRIPTION_MAX_LENGTH = 1000;

export function isTourismReviewStatus(value: string): value is TourismReviewStatus {
    return (TOURISM_REVIEW_STATUSES as readonly string[]).includes(value);
}

export function isTourismActiveReviewStatus(value: string): value is TourismActiveReviewStatus {
    return (TOURISM_ACTIVE_REVIEW_STATUSES as readonly string[]).includes(value);
}

export function isTourismTypeCode(value: string): value is TourismTypeCode {
    return (TOURISM_TYPE_CODES as readonly string[]).includes(value);
}

export function isTourismSeasonMode(value: string): value is TourismSeasonMode {
    return (TOURISM_SEASON_MODES as readonly string[]).includes(value);
}

/** Matches tourism.event_occurrences.status CHECK. */
export const TOURISM_EVENT_OCCURRENCE_STATUSES = [
    "scheduled",
    "confirmed",
    "cancelled",
    "completed",
] as const;

export type TourismEventOccurrenceStatus =
    (typeof TOURISM_EVENT_OCCURRENCE_STATUSES)[number];

export function isTourismEventOccurrenceStatus(
    value: string
): value is TourismEventOccurrenceStatus {
    return (TOURISM_EVENT_OCCURRENCE_STATUSES as readonly string[]).includes(value);
}

/** tourism.activities.season_mode CHECK (distinct from place-profile seasons). */
export const TOURISM_ACTIVITY_SEASON_MODES = [
    "all_year",
    "best_months",
    "poor_months",
    "temporarily_unavailable",
] as const;

export type TourismActivitySeasonMode = (typeof TOURISM_ACTIVITY_SEASON_MODES)[number];

export function isTourismActivitySeasonMode(
    value: string
): value is TourismActivitySeasonMode {
    return (TOURISM_ACTIVITY_SEASON_MODES as readonly string[]).includes(value);
}

/** Seeded ref.ref_activity_types codes. */
export const TOURISM_ACTIVITY_TYPE_CODES = [
    "sightseeing",
    "hiking",
    "cycling",
    "boat_trip",
    "food_experience",
    "cultural_experience",
    "workshop",
    "nature_activity",
    "water_activity",
    "photography",
    "other",
] as const;

export type TourismActivityTypeCode = (typeof TOURISM_ACTIVITY_TYPE_CODES)[number];

/** Seeded ref.ref_event_types codes. */
export const TOURISM_EVENT_TYPE_CODES = [
    "festival",
    "religious_event",
    "cultural_event",
    "market_event",
    "concert",
    "sports_event",
    "seasonal_event",
    "public_celebration",
    "other",
] as const;

export type TourismEventTypeCode = (typeof TOURISM_EVENT_TYPE_CODES)[number];

export const TOURISM_ACTIVITY_NAME_MAX_LENGTH = 200;
export const TOURISM_SCHEDULE_REVIEW_NOTE_MAX_LENGTH = 1000;
export const TOURISM_OCCURRENCE_SCHEDULE_NOTE_MAX_LENGTH = 1000;
export const TOURISM_OCCURRENCE_SOURCE_URL_MAX_LENGTH = 2000;
