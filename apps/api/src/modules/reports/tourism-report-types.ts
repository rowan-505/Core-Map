/**
 * Tourism-facing report type helpers for the existing feedback.user_reports flow.
 * These codes do not auto-apply to tourism ratings/rankings.
 */

export const TOURISM_REPORT_TYPE_CODES = [
    "tourism_incorrect_type",
    "tourism_incorrect_description",
    "tourism_incorrect_price",
    "closed_or_removed",
    "duplicate_item",
    "tourism_incorrect_review",
    "tourism_other",
] as const;

export type TourismReportTypeCode = (typeof TOURISM_REPORT_TYPE_CODES)[number];

export const TOURISM_ONLY_REPORT_TYPE_CODES = [
    "tourism_incorrect_type",
    "tourism_incorrect_description",
    "tourism_incorrect_price",
    "tourism_incorrect_review",
    "tourism_other",
] as const;

export function isTourismReportTypeCode(value: string): boolean {
    return (TOURISM_REPORT_TYPE_CODES as readonly string[]).includes(value);
}

export function isTourismOnlyReportTypeCode(value: string): boolean {
    return (TOURISM_ONLY_REPORT_TYPE_CODES as readonly string[]).includes(value);
}

/**
 * Tourism reports must not auto-apply transport/place mutations and must never
 * refresh community.place_rating_summaries. Keep reviewKind null for tourism-only codes.
 */
export function tourismReportAffectsRatingsOrRankings(): false {
    return false;
}
