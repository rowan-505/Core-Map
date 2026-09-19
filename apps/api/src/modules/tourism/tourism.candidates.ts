/**
 * Tourism candidate selection helpers (Phase 6).
 * Query-time eligibility from core places + category/source metadata.
 * No AI selection.
 */

import type { TourismTypeCode } from "./tourism.types.js";

/** POI category codes that are likely tourism-relevant in current CoreMap data. */
export const TOURISM_CANDIDATE_POI_CATEGORY_CODES = [
    "pagoda",
    "monastery",
    "religion",
    "entertainment",
    "retreat",
    "market",
    "cemetery",
] as const;

export type TourismCandidatePoiCategoryCode =
    (typeof TOURISM_CANDIDATE_POI_CATEGORY_CODES)[number];

/** OSM tourism=* values that suggest a visit-worthy place (not lodging). */
export const TOURISM_CANDIDATE_OSM_TOURISM_TAGS = [
    "attraction",
    "viewpoint",
    "museum",
    "gallery",
    "artwork",
    "zoo",
    "theme_park",
    "yes",
] as const;

export const TOURISM_CANDIDATE_OSM_LEISURE_TAGS = [
    "park",
    "garden",
    "nature_reserve",
    "beach_resort",
] as const;

export const TOURISM_CANDIDATE_OSM_NATURAL_TAGS = [
    "beach",
    "waterfall",
    "peak",
    "cliff",
] as const;

const CATEGORY_TO_SUGGESTED_TYPE: Record<string, TourismTypeCode> = {
    pagoda: "religious",
    monastery: "religious",
    religion: "religious",
    entertainment: "recreation",
    retreat: "cultural",
    market: "market",
    cemetery: "historical",
};

const OSM_TOURISM_TO_SUGGESTED_TYPE: Record<string, TourismTypeCode> = {
    attraction: "attraction",
    viewpoint: "viewpoint",
    museum: "museum",
    gallery: "museum",
    artwork: "cultural",
    zoo: "attraction",
    theme_park: "recreation",
    yes: "attraction",
};

const OSM_LEISURE_TO_SUGGESTED_TYPE: Record<string, TourismTypeCode> = {
    park: "park",
    garden: "park",
    nature_reserve: "nature",
    beach_resort: "beach",
};

const OSM_NATURAL_TO_SUGGESTED_TYPE: Record<string, TourismTypeCode> = {
    beach: "beach",
    waterfall: "waterfall",
    peak: "viewpoint",
    cliff: "viewpoint",
};

export type TourismCandidateSignals = {
    readonly categoryCode: string | null | undefined;
    readonly osmTourism: string | null | undefined;
    readonly osmHistoric: string | null | undefined;
    readonly osmLeisure: string | null | undefined;
    readonly osmNatural: string | null | undefined;
};

/**
 * Suggest a tourism type from category / OSM metadata.
 * Curator can override on approve.
 */
export function suggestTourismTypeForCandidate(
    signals: TourismCandidateSignals
): TourismTypeCode {
    const osmTourism = normalizeTag(signals.osmTourism);
    if (osmTourism && OSM_TOURISM_TO_SUGGESTED_TYPE[osmTourism]) {
        return OSM_TOURISM_TO_SUGGESTED_TYPE[osmTourism]!;
    }

    const osmNatural = normalizeTag(signals.osmNatural);
    if (osmNatural && OSM_NATURAL_TO_SUGGESTED_TYPE[osmNatural]) {
        return OSM_NATURAL_TO_SUGGESTED_TYPE[osmNatural]!;
    }

    const osmLeisure = normalizeTag(signals.osmLeisure);
    if (osmLeisure && OSM_LEISURE_TO_SUGGESTED_TYPE[osmLeisure]) {
        return OSM_LEISURE_TO_SUGGESTED_TYPE[osmLeisure]!;
    }

    if (normalizeTag(signals.osmHistoric)) {
        return "historical";
    }

    const category = normalizeTag(signals.categoryCode);
    if (category && CATEGORY_TO_SUGGESTED_TYPE[category]) {
        return CATEGORY_TO_SUGGESTED_TYPE[category]!;
    }

    return "attraction";
}

export type TourismCoverageStatus = "none" | "open" | "strong" | "covered";

/**
 * Simple coverage label for a township row.
 * approved = tourism profiles; candidates = still-open curation pool.
 */
export function resolveTourismCoverageStatus(input: {
    candidateCount: number;
    approvedProfileCount: number;
}): TourismCoverageStatus {
    const approved = Math.max(0, input.approvedProfileCount);
    const candidates = Math.max(0, input.candidateCount);
    if (approved === 0) return "none";
    if (candidates === 0) return "covered";
    if (approved >= candidates) return "strong";
    return "open";
}

function normalizeTag(value: string | null | undefined): string | null {
    if (value == null) return null;
    const trimmed = value.trim().toLowerCase();
    return trimmed === "" ? null : trimmed;
}
