import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    adminAreaDetailQuerySchema,
    adminAreaIdParamsSchema,
    adminAreasListQuerySchema,
    adminAreasTileParamsSchema,
    postalCodesSearchQuerySchema,
    resolveGeometrySource,
} from "./admin-areas.geography.schema.js";
import {
    isValidAdminAreaTileCoord,
    shouldServeAdminAreaTile,
    simplifyToleranceDegrees,
} from "./admin-areas.mvt.js";
import {
    AdminAreaNotFoundError,
    AdminAreasGeographyService,
} from "./admin-areas.geography.service.js";

describe("admin-areas geography schema", () => {
    it("parses list filters and aliases", () => {
        const parsed = adminAreasListQuerySchema.parse({
            limit: "25",
            offset: "10",
            level: "township",
            type: "township",
            parent: "6329",
            status: "needs_fix",
            geometrySource: "mimu_placeholder",
            official: "true",
            public: "0",
            q: "Yangon",
        });
        assert.equal(parsed.limit, 25);
        assert.equal(parsed.offset, 10);
        assert.equal(parsed.level, "township");
        assert.equal(parsed.official, true);
        assert.equal(parsed.public, false);
        assert.equal(resolveGeometrySource(parsed), "mimu_placeholder");
    });

    it("rejects non-numeric parent", () => {
        assert.throws(() => adminAreasListQuerySchema.parse({ parent: "abc" }));
    });

    it("requires numeric id params", () => {
        assert.equal(adminAreaIdParamsSchema.parse({ id: "6610" }).id, "6610");
        assert.throws(() => adminAreaIdParamsSchema.parse({ id: "uuid-here" }));
    });

    it("defaults include_geometry to undefined/falsey", () => {
        const parsed = adminAreaDetailQuerySchema.parse({});
        assert.equal(parsed.include_geometry, undefined);
        assert.equal(adminAreaDetailQuerySchema.parse({ include_geometry: "true" }).include_geometry, true);
    });

    it("parses postal search query", () => {
        const parsed = postalCodesSearchQuerySchema.parse({
            q: "0101",
            match_status: "linked_local_area",
        });
        assert.equal(parsed.q, "0101");
        assert.equal(parsed.match_status, "linked_local_area");
    });

    it("parses tile params", () => {
        const parsed = adminAreasTileParamsSchema.parse({ z: "10", x: "800", y: "500" });
        assert.deepEqual(parsed, { z: 10, x: 800, y: 500 });
    });
});

describe("admin-areas mvt helpers", () => {
    it("validates tile coordinates", () => {
        assert.equal(isValidAdminAreaTileCoord(0, 0, 0), true);
        assert.equal(isValidAdminAreaTileCoord(1, 2, 0), false);
        assert.equal(isValidAdminAreaTileCoord(5, 0, 0), true);
    });

    it("gates low zooms", () => {
        assert.equal(shouldServeAdminAreaTile(4), false);
        assert.equal(shouldServeAdminAreaTile(5), true);
    });

    it("uses coarser simplify at low zoom", () => {
        assert.ok(simplifyToleranceDegrees(6) > simplifyToleranceDegrees(12));
        assert.equal(simplifyToleranceDegrees(16), 0);
    });
});

describe("AdminAreasGeographyService", () => {
    it("maps list page and detail geometry gate", async () => {
        const geographyRepo = {
            async listAdminAreas() {
                return {
                    total: 1,
                    rows: [
                        {
                            id: 1n,
                            public_id: "11111111-1111-4111-8111-111111111111",
                            parent_id: null,
                            canonical_name: "Test",
                            slug: "test",
                            admin_level_id: 2n,
                            admin_level_code: "state_region",
                            admin_area_type_id: 2n,
                            admin_area_type_code: "state",
                            is_active: true,
                            verification_status: "verified",
                            address_usage: "official",
                            boundary_status: "official",
                            is_official_boundary: true,
                            is_public_usable: true,
                            geometry_source: null,
                            updated_at: new Date("2026-09-21T00:00:00.000Z"),
                            bbox: [95, 16, 96, 17],
                            centroid: { type: "Point" as const, coordinates: [95.5, 16.5] as [number, number] },
                        },
                    ],
                };
            },
            async getAdminAreaDetail(args: { includeGeometry: boolean }) {
                return {
                    id: 1n,
                    public_id: "11111111-1111-4111-8111-111111111111",
                    parent_id: null,
                    canonical_name: "Test",
                    slug: "test",
                    admin_level_id: 2n,
                    admin_level_code: "state_region",
                    admin_area_type_id: 2n,
                    admin_area_type_code: "state",
                    is_active: true,
                    verification_status: "verified",
                    address_usage: "official",
                    boundary_status: "official",
                    is_official_boundary: true,
                    is_public_usable: true,
                    geometry_source: null,
                    updated_at: new Date("2026-09-21T00:00:00.000Z"),
                    bbox: [95, 16, 96, 17],
                    centroid: { type: "Point" as const, coordinates: [95.5, 16.5] as [number, number] },
                    geom_geojson: args.includeGeometry ? { type: "Polygon", coordinates: [] } : null,
                    child_count: 2n,
                    postal_count: 3n,
                    verification_note: "Manual gap correction pending review",
                };
            },
            async listNames() {
                return [
                    {
                        id: 10n,
                        language_code: "en",
                        name: "Test",
                        name_type: "official",
                        is_primary: true,
                    },
                ];
            },
            async listAncestors() {
                return [];
            },
            async listChildren() {
                return { total: 0, rows: [] };
            },
            async queryAdminAreasMvt() {
                return Buffer.from([0x1a]);
            },
        };

        const postalRepo = {
            async search() {
                return {
                    total: 1,
                    rows: [
                        {
                            postal_code: "0101001",
                            region_name_en: "Kachin",
                            region_name_my: null,
                            township_name_en: "Myitkyina",
                            township_name_my: null,
                            locality_name_en: "Ward",
                            locality_name_my: null,
                            locality_type: "ward",
                            township_admin_area_id: 1n,
                            local_admin_area_id: null,
                            match_status: "linked_township_only",
                            match_method: "exact_township_name",
                            source_name: "Myanmar Post",
                            source_version: "V1.0",
                        },
                    ],
                };
            },
            async findByPostalCode() {
                return null;
            },
        };

        const service = new AdminAreasGeographyService(geographyRepo as never, postalRepo as never);

        const list = await service.list({
            limit: 50,
            offset: 0,
        });
        assert.equal(list.total, 1);
        assert.equal(list.items[0]?.canonical_name, "Test");
        assert.equal(list.items[0]?.bbox?.length, 4);

        const withoutGeom = await service.getById("1", false);
        assert.equal(withoutGeom.geometry, null);
        assert.equal(withoutGeom.child_count, 2);
        assert.equal(withoutGeom.postal_count, 3);
        assert.equal(withoutGeom.verification_note, "Manual gap correction pending review");

        const withGeom = await service.getById("1", true);
        assert.ok(withGeom.geometry);

        const postal = await service.searchPostalCodes({ limit: 10, offset: 0, q: "0101" });
        assert.equal(postal.items[0]?.postal_code, "0101001");

        await assert.rejects(() => {
            const missingRepo = {
                ...geographyRepo,
                async getAdminAreaDetail() {
                    return null;
                },
            };
            const missingService = new AdminAreasGeographyService(missingRepo as never, postalRepo as never);
            return missingService.getById("999", false);
        }, AdminAreaNotFoundError);
    });

    it("returns summary counters with targets", async () => {
        const geographyRepo = {
            async getGeographySummary() {
                return {
                    official_first_level: 15,
                    official_township: 330,
                    ward_count: 1956,
                    village_tract_count: 2,
                    settlement_count: 57590,
                    placeholder_count: 0,
                    postal_linked_local: 1638,
                    postal_linked_township_only: 12298,
                    postal_unmatched_review: 3361,
                    targets: { official_first_level: 15, official_township: 330 },
                };
            },
        };
        const service = new AdminAreasGeographyService(geographyRepo as never, {} as never);
        const summary = await service.getSummary();
        assert.equal(summary.targets.official_first_level, 15);
        assert.equal(summary.official_township, 330);
    });
});
