import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    defaultSearchIndexRepairTimingEstimates,
    estimateSearchIndexFamilyDurationMs,
    estimateSearchIndexQueueDurationMs,
    recordSearchIndexFamilyDuration,
} from "./searchIndexRepairTiming";

describe("search index repair timing", () => {
    it("uses measured defaults for the fixed heavy families", () => {
        const estimates = defaultSearchIndexRepairTimingEstimates();
        assert.equal(
            estimateSearchIndexFamilyDurationMs(
                { entity_family: "street_groups", expected_searchable_count: 15_314 },
                estimates,
            ),
            140_300,
        );
        assert.equal(
            estimateSearchIndexFamilyDurationMs(
                { entity_family: "settlements", expected_searchable_count: 55_864 },
                estimates,
            ),
            102_100,
        );
    });

    it("sums per-family estimates for the remaining queue", () => {
        const estimates = { places: 30_000, buildings: 45_000 };
        const total = estimateSearchIndexQueueDurationMs(
            [
                { entity_family: "places", expected_searchable_count: 64_000 },
                { entity_family: "buildings", expected_searchable_count: 10_000 },
            ],
            estimates,
        );
        assert.equal(total, 75_000);
    });

    it("learns mostly from the latest successful API duration", () => {
        const next = recordSearchIndexFamilyDuration({ places: 100_000 }, "places", 200_000);
        assert.equal(next.places, 165_000);
    });
});
