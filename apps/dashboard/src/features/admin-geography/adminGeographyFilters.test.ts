import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildAdminGeographyListQuery,
    buildAdminGeographyTileUrlTemplate,
    isAdminGeographyTileUrl,
    wouldFetchNationwideGeoJson,
} from "./api";
import {
    defaultFiltersForMode,
    filtersToListParams,
    filtersToTileFilters,
    toggleFilterChip,
} from "./filters";
import type { AdminGeographyFilterKey } from "./types";

describe("admin geography filter → API params", () => {
    it("maps township + official chips without GeoJSON flags", () => {
        const active = new Set<AdminGeographyFilterKey>(["township", "official_only"]);
        const list = filtersToListParams(active, { q: "Yangon", limit: 40, offset: 0 });
        assert.ok(!("kind" in list));
        if ("kind" in list) return;
        assert.equal(list.level, "township");
        assert.equal(list.official, true);
        assert.equal(list.geometrySource, undefined);

        const qs = buildAdminGeographyListQuery(list);
        assert.match(qs, /level=township/);
        assert.match(qs, /official=true/);
        assert.doesNotMatch(qs, /include_geometry/);
        assert.doesNotMatch(qs, /geojson/i);
        assert.equal(wouldFetchNationwideGeoJson(`/admin-areas?${qs}`), false);
    });

    it("maps MIMU placeholder and needs_fix filters", () => {
        const active = new Set<AdminGeographyFilterKey>(["mimu_placeholder", "needs_fix"]);
        const list = filtersToListParams(active, {});
        assert.ok(!("kind" in list));
        if ("kind" in list) return;
        assert.equal(list.geometrySource, "mimu_placeholder");
        assert.equal(list.status, "needs_fix");
    });

    it("defaults remediation mode filters to mimu placeholders", () => {
        const active = defaultFiltersForMode("mimu-remediation");
        assert.equal(active.has("mimu_placeholder"), true);
        assert.equal(active.has("non_public"), true);
        const list = filtersToListParams(active, {});
        assert.ok(!("kind" in list));
        if ("kind" in list) return;
        assert.equal(list.geometrySource, "mimu_placeholder");
        assert.equal(list.public, false);
        const qs = buildAdminGeographyListQuery(list);
        assert.match(qs, /geometrySource=mimu_placeholder/);
        assert.match(qs, /public=false/);
    });

    it("maps remediation reject and evidence status chips", () => {
        const active = new Set<AdminGeographyFilterKey>([
            "mimu_placeholder",
            "decision_reject",
            "evidence_has",
        ]);
        const list = filtersToListParams(active, {});
        assert.ok(!("kind" in list));
        if ("kind" in list) return;
        assert.equal(list.remediationDecision, "reject");
        assert.equal(list.evidenceStatus, "has_evidence");
        const qs = buildAdminGeographyListQuery(list);
        assert.match(qs, /remediation_decision=reject/);
        assert.match(qs, /evidence_status=has_evidence/);
    });

    it("treats settlement filter as unsupported for admin-area GeoJSON", () => {
        const active = new Set<AdminGeographyFilterKey>(["settlement"]);
        const list = filtersToListParams(active, {});
        assert.deepEqual(list, { kind: "settlements_unsupported" });
        assert.equal(filtersToTileFilters(active), null);
    });

    it("mutually excludes official vs reference chips", () => {
        let active = new Set<AdminGeographyFilterKey>();
        active = toggleFilterChip(active, "official_only");
        active = toggleFilterChip(active, "reference_only");
        assert.equal(active.has("official_only"), false);
        assert.equal(active.has("reference_only"), true);
    });
});

describe("admin geography tiles never use nationwide GeoJSON", () => {
    it("builds MVT tile templates with filter query only", () => {
        process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:3001";
        const url = buildAdminGeographyTileUrlTemplate({
            level: "township",
            official: true,
            geometry_source: "mimu_placeholder",
        });
        assert.match(url, /\/admin-areas\/tiles\/\{z\}\/\{x\}\/\{y\}\?/);
        assert.match(url, /level=township/);
        assert.match(url, /official=true/);
        assert.match(url, /geometry_source=mimu_placeholder/);
        assert.doesNotMatch(url, /geojson/i);
        assert.doesNotMatch(url, /include_geometry/);
        assert.equal(isAdminGeographyTileUrl(url.replace("{z}", "8").replace("{x}", "1").replace("{y}", "1")), true);
        assert.equal(wouldFetchNationwideGeoJson(url), false);
    });

    it("flags bulk GeoJSON patterns as unsafe", () => {
        assert.equal(wouldFetchNationwideGeoJson("/admin-areas?format=geojson"), true);
        assert.equal(wouldFetchNationwideGeoJson("/admin-areas?geometry=full"), true);
        assert.equal(
            wouldFetchNationwideGeoJson("/admin-areas/6610?include_geometry=true"),
            false,
        );
        assert.equal(wouldFetchNationwideGeoJson("/admin-areas/tiles/8/1/1?level=township"), false);
    });
});
