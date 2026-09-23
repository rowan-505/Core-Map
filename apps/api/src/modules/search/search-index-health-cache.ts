import type { SearchIndexHealthReport } from "./search-index-health.js";

type CacheEntry = {
    value: SearchIndexHealthReport;
    /** Soft TTL: after this, serve stale and refresh in the background. */
    expiresAt: number;
    savedAt: number;
};

const CACHE_KEY = "search:index-health:report";
// Full reconciliation is expensive. Keep the soft TTL long enough that ordinary
// dashboard navigation never blocks on it.
const DEFAULT_TTL_MS = 5 * 60_000;
/** Production health reports always include every allowlisted family. */
const MIN_HEALTH_FAMILIES = 10;

const store = new Map<string, CacheEntry>();

let inflight: Promise<SearchIndexHealthReport> | null = null;
let backgroundRefresh: Promise<void> | null = null;
let cacheEpoch = 0;

export const SEARCH_INDEX_HEALTH_CACHE_TTL_MS = DEFAULT_TTL_MS;

function isTestProcess(): boolean {
    return process.env.NODE_TEST_CONTEXT != null || process.env.NODE_ENV === "test";
}

/**
 * Reject truncated / fixture reports so the dashboard never treats a 1-family
 * sample as the live production health state.
 */
export function isCompleteSearchIndexHealthReport(
    report: SearchIndexHealthReport | null | undefined,
): report is SearchIndexHealthReport {
    if (!report || !report.health_query_ok || !Array.isArray(report.families)) {
        return false;
    }
    if (isTestProcess()) {
        return true;
    }
    if (report.report_mode === "snapshot") {
        return false;
    }
    return report.families.length >= MIN_HEALTH_FAMILIES;
}

export function clearSearchIndexHealthCache(): void {
    cacheEpoch += 1;
    store.clear();
    inflight = null;
    backgroundRefresh = null;
}

export function seedSearchIndexHealthCache(
    report: SearchIndexHealthReport,
    options: { ttlMs?: number; now?: number } = {},
): void {
    if (!isCompleteSearchIndexHealthReport(report)) {
        return;
    }
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    store.set(CACHE_KEY, { value: report, expiresAt: now + ttlMs, savedAt: now });
}

export function peekSearchIndexHealthCache(
    now: number = Date.now(),
    options: { allowStale?: boolean } = {},
): SearchIndexHealthReport | null {
    const hit = store.get(CACHE_KEY);
    if (!hit) {
        return null;
    }
    if (!isCompleteSearchIndexHealthReport(hit.value)) {
        store.delete(CACHE_KEY);
        return null;
    }
    if (!options.allowStale && hit.expiresAt <= now) {
        return null;
    }
    return hit.value;
}

async function runLoader(
    loader: () => Promise<SearchIndexHealthReport>,
    options: { ttlMs?: number; now?: number },
    epoch: number,
): Promise<SearchIndexHealthReport> {
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const value = await loader();
    if (epoch !== cacheEpoch) {
        return value;
    }
    if (isCompleteSearchIndexHealthReport(value)) {
        store.set(CACHE_KEY, {
            value,
            expiresAt: now + ttlMs,
            savedAt: Date.now(),
        });
    }
    return value;
}

function scheduleBackgroundRefresh(
    loader: () => Promise<SearchIndexHealthReport>,
    options: { ttlMs?: number; now?: number },
): void {
    if (inflight || backgroundRefresh) {
        return;
    }
    const epoch = cacheEpoch;
    backgroundRefresh = runLoader(loader, options, epoch)
        .catch(() => {
            // Keep serving the previous successful report.
        })
        .then(() => {
            if (epoch === cacheEpoch) {
                backgroundRefresh = null;
            }
        });
}

/** Test helper: wait for any in-flight background refresh to finish. */
export async function waitForSearchIndexHealthBackgroundRefresh(): Promise<void> {
    if (backgroundRefresh) {
        await backgroundRefresh;
    }
    if (inflight) {
        await inflight;
    }
}

export async function getCachedSearchIndexHealthReport(
    loader: () => Promise<SearchIndexHealthReport>,
    options: {
        refresh?: boolean;
        ttlMs?: number;
        now?: number;
        /** When true, do not return soft-stale; wait for a fresh load. */
        requireFresh?: boolean;
    } = {},
): Promise<SearchIndexHealthReport> {
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

    if (!options.refresh) {
        const fresh = peekSearchIndexHealthCache(now);
        if (fresh) {
            return fresh;
        }

        const stale = peekSearchIndexHealthCache(now, { allowStale: true });
        if (stale && !options.requireFresh) {
            scheduleBackgroundRefresh(loader, { ttlMs, now });
            return stale;
        }
    }

    if (inflight) {
        return inflight;
    }

    const epoch = cacheEpoch;
    inflight = runLoader(loader, { ttlMs, now }, epoch).finally(() => {
        if (epoch === cacheEpoch) {
            inflight = null;
        }
    });
    return inflight;
}
