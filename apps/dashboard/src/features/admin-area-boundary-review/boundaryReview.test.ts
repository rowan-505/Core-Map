import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAdminAreaBoundaryContextPath } from "./api.js";
import {
    adminAreaNameWarningMessage,
    formatAdminAreaBoundaryLabel,
    isGenericOrBlankAdminName,
} from "./types.js";
import { wouldFetchNationwideGeoJson } from "../admin-geography/api.js";

describe("admin-area boundary review UI helpers", () => {
    it("warns on blank and generic names without renaming", () => {
        assert.ok(adminAreaNameWarningMessage(""));
        assert.ok(adminAreaNameWarningMessage("Ward"));
        assert.ok(adminAreaNameWarningMessage("Village Tract"));
        assert.equal(adminAreaNameWarningMessage("Kyauktan"), null);
        assert.equal(isGenericOrBlankAdminName("Urban"), true);
        assert.equal(isGenericOrBlankAdminName("Rural"), true);
        assert.equal(isGenericOrBlankAdminName("Unknown"), true);
        assert.equal(isGenericOrBlankAdminName("Unnamed"), true);
    });

    it("formats labels with Unnamed fallback", () => {
        assert.equal(
            formatAdminAreaBoundaryLabel({
                displayName: "Ahlone",
                type: "township",
                publicId: "abc",
            }),
            "Ahlone · township",
        );
        assert.equal(
            formatAdminAreaBoundaryLabel({
                displayName: "",
                type: "ward",
                publicId: "abc",
            }),
            "Unnamed · #abc",
        );
    });

    it("recognizes context path and rejects nationwide GeoJSON patterns", () => {
        assert.equal(
            isAdminAreaBoundaryContextPath("/admin-areas/11111111-1111-4111-8111-111111111111/context"),
            true,
        );
        assert.equal(isAdminAreaBoundaryContextPath("/admin-areas?format=geojson"), false);
        assert.equal(wouldFetchNationwideGeoJson("/admin-areas?format=geojson"), true);
        assert.equal(
            wouldFetchNationwideGeoJson("/admin-areas/11111111-1111-4111-8111-111111111111/context"),
            false,
        );
    });
});
