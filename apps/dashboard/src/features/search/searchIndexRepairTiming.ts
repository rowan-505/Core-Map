import type { SearchIndexHealthFamily } from "./types";

const STORAGE_KEY = "coremap.searchIndexRepairTiming.v1";
const MIN_ESTIMATE_MS = 5_000;
const MAX_ESTIMATE_MS = 30 * 60_000;

export const SEARCH_INDEX_HEALTH_CHECK_ESTIMATE_MS = 2 * 60_000;

export type SearchIndexRepairTimingEstimates = Record<string, number>;

const DEFAULT_ESTIMATES_MS: SearchIndexRepairTimingEstimates = {
    // Measured after the set-based alias-folding fix on 2026-09-23.
    street_groups: 140_300,
    settlements: 102_100,
};

function clampEstimate(value: number): number {
    return Math.min(MAX_ESTIMATE_MS, Math.max(MIN_ESTIMATE_MS, Math.round(value)));
}

export function defaultSearchIndexRepairTimingEstimates(): SearchIndexRepairTimingEstimates {
    return { ...DEFAULT_ESTIMATES_MS };
}

export function readSearchIndexRepairTimingEstimates(): SearchIndexRepairTimingEstimates {
    const defaults = defaultSearchIndexRepairTimingEstimates();
    if (typeof window === "undefined") return defaults;
    try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<
            string,
            unknown
        >;
        for (const [family, value] of Object.entries(parsed)) {
            if (typeof value === "number" && Number.isFinite(value) && value > 0) {
                defaults[family] = clampEstimate(value);
            }
        }
    } catch {
        // Invalid/private storage: measured defaults are still usable.
    }
    return defaults;
}

export function estimateSearchIndexFamilyDurationMs(
    family: Pick<SearchIndexHealthFamily, "entity_family" | "expected_searchable_count">,
    estimates: SearchIndexRepairTimingEstimates,
): number {
    const measured = estimates[family.entity_family];
    if (typeof measured === "number" && Number.isFinite(measured) && measured > 0) {
        return clampEstimate(measured);
    }

    // Conservative first-run fallback. Later successful runs replace this with
    // a moving average measured by the API.
    return clampEstimate(Math.max(30_000, family.expected_searchable_count * 3));
}

export function estimateSearchIndexQueueDurationMs(
    families: readonly Pick<
        SearchIndexHealthFamily,
        "entity_family" | "expected_searchable_count"
    >[],
    estimates: SearchIndexRepairTimingEstimates,
): number {
    return families.reduce(
        (total, family) => total + estimateSearchIndexFamilyDurationMs(family, estimates),
        0,
    );
}

export function recordSearchIndexFamilyDuration(
    estimates: SearchIndexRepairTimingEstimates,
    family: string,
    durationMs: number,
): SearchIndexRepairTimingEstimates {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return estimates;

    const previous = estimates[family];
    const nextValue =
        typeof previous === "number" && Number.isFinite(previous)
            ? previous * 0.35 + durationMs * 0.65
            : durationMs;
    const next = { ...estimates, [family]: clampEstimate(nextValue) };

    if (typeof window !== "undefined") {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
            // Quota/private mode: keep the in-memory estimate.
        }
    }
    return next;
}
