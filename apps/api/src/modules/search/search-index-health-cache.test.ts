import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSearchIndexHealthReport, normalizeSearchIndexHealthRow } from "./search-index-health.js";
import {
    clearSearchIndexHealthCache,
    getCachedSearchIndexHealthReport,
    peekSearchIndexHealthCache,
    SEARCH_INDEX_HEALTH_CACHE_TTL_MS,
    waitForSearchIndexHealthBackgroundRefresh,
} from "./search-index-health-cache.js";

function sampleReport() {
    const finishedAt = new Date("2026-07-10T00:00:00.000Z");
    return buildSearchIndexHealthReport(
        [
            normalizeSearchIndexHealthRow({
                entity_family: "places",
                search_entity_type: "place",
                canonical_count: 1n,
                indexed_count: 1n,
                missing_count: 0n,
                ghost_count: 0n,
                stale_count: 0n,
                latest_indexed_at: finishedAt,
                latest_source_updated_at: finishedAt,
            }),
        ],
        {
            latest: {
                id: 1n,
                status: "completed",
                started_at: finishedAt,
                finished_at: finishedAt,
                entity_counts: { place: 1 },
            },
            lastSuccessful: {
                id: 1n,
                status: "completed",
                started_at: finishedAt,
                finished_at: finishedAt,
                entity_counts: { place: 1 },
            },
        },
        { now: new Date("2026-07-10T12:00:00.000Z") },
    );
}

describe("search index health cache", () => {
    it("returns cached report within TTL without re-running loader", async () => {
        clearSearchIndexHealthCache();
        let loads = 0;
        const loader = async () => {
            loads += 1;
            return sampleReport();
        };

        const first = await getCachedSearchIndexHealthReport(loader, { now: 1_000 });
        const second = await getCachedSearchIndexHealthReport(loader, {
            now: 1_000 + SEARCH_INDEX_HEALTH_CACHE_TTL_MS - 1,
        });

        assert.equal(loads, 1);
        assert.equal(first.overall_severity, second.overall_severity);
        assert.ok(peekSearchIndexHealthCache(1_000 + 1_000));
    });

    it("serves stale report after TTL and refreshes in the background", async () => {
        clearSearchIndexHealthCache();
        let loads = 0;
        const loader = async () => {
            loads += 1;
            return sampleReport();
        };

        await getCachedSearchIndexHealthReport(loader, { now: 5_000 });
        const stale = await getCachedSearchIndexHealthReport(loader, {
            now: 5_000 + SEARCH_INDEX_HEALTH_CACHE_TTL_MS + 1,
        });

        assert.equal(stale.overall_severity, "healthy");
        await waitForSearchIndexHealthBackgroundRefresh();
        assert.equal(loads, 2);
        assert.ok(
            peekSearchIndexHealthCache(5_000 + SEARCH_INDEX_HEALTH_CACHE_TTL_MS + 1, {
                allowStale: true,
            }),
        );
    });

    it("refresh bypasses cached value", async () => {
        clearSearchIndexHealthCache();
        let loads = 0;
        const loader = async () => {
            loads += 1;
            return sampleReport();
        };

        await getCachedSearchIndexHealthReport(loader, { now: 9_000 });
        await getCachedSearchIndexHealthReport(loader, { now: 9_500, refresh: true });

        assert.equal(loads, 2);
    });

    it("does not cache loader failures", async () => {
        clearSearchIndexHealthCache();
        let loads = 0;
        const loader = async () => {
            loads += 1;
            if (loads === 1) {
                throw new Error("db timeout");
            }
            return sampleReport();
        };

        await assert.rejects(() => getCachedSearchIndexHealthReport(loader));
        const recovered = await getCachedSearchIndexHealthReport(loader);
        assert.equal(loads, 2);
        assert.equal(recovered.overall_severity, "healthy");
    });

    it("coalesces concurrent cold loads into one loader call", async () => {
        clearSearchIndexHealthCache();
        await waitForSearchIndexHealthBackgroundRefresh();
        let loads = 0;
        let release!: (value: ReturnType<typeof sampleReport>) => void;
        const loader = () =>
            new Promise<ReturnType<typeof sampleReport>>((resolve) => {
                loads += 1;
                release = resolve;
            });

        const first = getCachedSearchIndexHealthReport(loader, { now: 20_000 });
        const second = getCachedSearchIndexHealthReport(loader, { now: 20_000 });
        assert.equal(loads, 1);
        release(sampleReport());
        const [a, b] = await Promise.all([first, second]);
        assert.equal(a.overall_severity, b.overall_severity);
        assert.equal(loads, 1);
    });
});
