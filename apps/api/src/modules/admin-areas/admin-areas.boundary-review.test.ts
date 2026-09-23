import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    BOUNDARY_CONTEXT_BBOX_MARGIN_DEG,
    BOUNDARY_CONTEXT_NEIGHBOUR_LIMIT,
    buildBoundaryChecks,
    formatAdminAreaLabel,
    isGenericOrBlankAdminName,
    m2ToHectares,
    resolveAdminAreaLookup,
} from "./admin-areas.boundary-review.js";
import {
    adminAreaPublicIdParamsSchema,
    adminAreaValidateGeometryBodySchema,
} from "./admin-areas.geography.schema.js";
import { AdminAreaNotFoundError, AdminAreasGeographyService } from "./admin-areas.geography.service.js";

const validPolygon = {
    type: "Polygon" as const,
    coordinates: [
        [
            [96.1, 16.7],
            [96.2, 16.7],
            [96.2, 16.8],
            [96.1, 16.8],
            [96.1, 16.7],
        ],
    ],
};

describe("admin-areas boundary review helpers", () => {
    it("resolves numeric id and public_id", () => {
        assert.deepEqual(resolveAdminAreaLookup("6610"), { kind: "id", id: 6610n });
        assert.deepEqual(resolveAdminAreaLookup("11111111-1111-4111-8111-111111111111"), {
            kind: "public_id",
            publicId: "11111111-1111-4111-8111-111111111111",
        });
    });

    it("flags blank and generic names without renaming", () => {
        assert.equal(isGenericOrBlankAdminName(""), true);
        assert.equal(isGenericOrBlankAdminName("Ward"), true);
        assert.equal(isGenericOrBlankAdminName("Village Tract"), true);
        assert.equal(isGenericOrBlankAdminName("Unknown"), true);
        assert.equal(isGenericOrBlankAdminName("Unnamed"), true);
        assert.equal(isGenericOrBlankAdminName("Urban"), true);
        assert.equal(isGenericOrBlankAdminName("Rural"), true);
        assert.equal(isGenericOrBlankAdminName("Kyauktan"), false);
    });

    it("formats labels with type fallback", () => {
        assert.equal(
            formatAdminAreaLabel({
                displayName: "Kyauktan",
                type: "township",
                publicId: "abc",
            }),
            "Kyauktan · township"
        );
        assert.equal(
            formatAdminAreaLabel({
                displayName: "  ",
                type: "ward",
                publicId: "abc",
            }),
            "Unnamed · #abc"
        );
    });

    it("builds pass/warning/fail rows without treating gaps as fatal", () => {
        const checks = buildBoundaryChecks({
            isValid: true,
            invalidReason: null,
            outsideParentHa: 1.5,
            overlappingCount: 2,
            overlappingTotalHa: 0.4,
            touchingNeighbourCount: 3,
            hasParent: true,
        });
        assert.equal(checks.find((c) => c.id === "st_is_valid")?.severity, "pass");
        assert.equal(checks.find((c) => c.id === "outside_parent")?.severity, "warning");
        assert.equal(checks.find((c) => c.id === "overlaps")?.severity, "warning");
        assert.equal(checks.find((c) => c.id === "touching")?.severity, "pass");
        assert.match(checks.find((c) => c.id === "touching")?.message ?? "", /gaps/i);
    });

    it("converts m2 to hectares", () => {
        assert.equal(m2ToHectares(25_000), 2.5);
        assert.equal(m2ToHectares(null), 0);
    });

    it("keeps neighbour load bounded", () => {
        assert.ok(BOUNDARY_CONTEXT_NEIGHBOUR_LIMIT <= 50);
        assert.ok(BOUNDARY_CONTEXT_BBOX_MARGIN_DEG > 0);
        assert.ok(BOUNDARY_CONTEXT_BBOX_MARGIN_DEG < 0.5);
    });
});

describe("adminAreaPublicIdParamsSchema", () => {
    it("accepts UUID and numeric publicId", () => {
        assert.equal(
            adminAreaPublicIdParamsSchema.parse({
                publicId: "11111111-1111-4111-8111-111111111111",
            }).publicId,
            "11111111-1111-4111-8111-111111111111"
        );
        assert.equal(adminAreaPublicIdParamsSchema.parse({ publicId: "6610" }).publicId, "6610");
    });

    it("rejects nonsense ids", () => {
        assert.throws(() => adminAreaPublicIdParamsSchema.parse({ publicId: "not-an-id" }));
    });
});

describe("adminAreaValidateGeometryBodySchema", () => {
    it("accepts Polygon draft", () => {
        const parsed = adminAreaValidateGeometryBodySchema.parse({ geometry: validPolygon });
        assert.equal(parsed.geometry.type, "Polygon");
    });

    it("rejects LineString", () => {
        assert.throws(() =>
            adminAreaValidateGeometryBodySchema.parse({
                geometry: { type: "LineString", coordinates: [[96, 16], [96.1, 16.1]] },
            })
        );
    });
});

describe("AdminAreasGeographyService boundary context + validate", () => {
    it("maps context with simplified neighbours and full selected", async () => {
        const geographyRepo = {
            async resolveAdminAreaId() {
                return 6610n;
            },
            async getBoundaryContext() {
                return {
                    selected: {
                        id: 6610n,
                        public_id: "11111111-1111-4111-8111-111111111111",
                        parent_id: 100n,
                        display_name: "Ward",
                        type_code: "ward",
                        admin_level_code: "ward",
                        admin_level_id: 5n,
                        geometry_source: "coremap_manual",
                        verification_status: "needs_fix",
                        geometry: validPolygon,
                        bbox: [96.1, 16.7, 96.2, 16.8],
                    },
                    parent: {
                        id: 100n,
                        public_id: "22222222-2222-4222-8222-222222222222",
                        parent_id: null,
                        display_name: "Township A",
                        type_code: "township",
                        admin_level_code: "township",
                        admin_level_id: 4n,
                        geometry_source: "government",
                        verification_status: "verified",
                        geometry: validPolygon,
                        bbox: [96.0, 16.6, 96.3, 16.9],
                    },
                    neighbours: [
                        {
                            id: 6611n,
                            public_id: "33333333-3333-4333-8333-333333333333",
                            parent_id: 100n,
                            display_name: "Neighbour",
                            type_code: "ward",
                            admin_level_code: "ward",
                            admin_level_id: 5n,
                            geometry_source: "osm",
                            verification_status: "unverified",
                            geometry: validPolygon,
                            bbox: [96.15, 16.7, 96.25, 16.8],
                        },
                    ],
                    neighbour_truncated: false,
                    bbox_margin_deg: BOUNDARY_CONTEXT_BBOX_MARGIN_DEG,
                    neighbour_limit: BOUNDARY_CONTEXT_NEIGHBOUR_LIMIT,
                };
            },
        };

        const service = new AdminAreasGeographyService(geographyRepo as never, {} as never);
        const result = await service.getBoundaryContext("11111111-1111-4111-8111-111111111111");
        assert.equal(result.selected.name_warning, true);
        assert.equal(result.parent?.display_name, "Township A");
        assert.equal(result.neighbours.length, 1);
        assert.equal(result.meta.neighbour_truncated, false);
        assert.ok(!("nationwide" in result));
    });

    it("validateDraftGeometry returns checks and never fatals ordinary gaps", async () => {
        const geographyRepo = {
            async resolveAdminAreaId() {
                return 6610n;
            },
            async validateDraftGeometry() {
                return {
                    allowed_type: true,
                    is_valid: true,
                    invalid_reason: null,
                    is_empty: false,
                    has_parent: true,
                    outside_parent_m2: 20_000,
                    outside_parent_geojson: validPolygon,
                    overlaps_json: [
                        {
                            public_id: "33333333-3333-4333-8333-333333333333",
                            display_name: "Neighbour",
                            overlap_m2: 5_000,
                            overlap_geojson: validPolygon,
                        },
                    ],
                    touching_neighbour_count: 2,
                };
            },
        };

        const service = new AdminAreasGeographyService(geographyRepo as never, {} as never);
        const result = await service.validateDraftGeometry("6610", { geometry: validPolygon });
        assert.equal(result.is_valid, true);
        assert.equal(result.outside_parent_ha, 2);
        assert.equal(result.overlapping_neighbours.length, 1);
        assert.equal(result.overlapping_neighbours[0]?.overlap_ha, 0.5);
        assert.equal(result.touching_neighbour_count, 2);
        assert.equal(result.checks.find((c) => c.id === "touching")?.severity, "pass");
        assert.equal(result.issues_geojson.features.length, 2);
    });

    it("throws not found when resolve fails", async () => {
        const geographyRepo = {
            async resolveAdminAreaId() {
                return null;
            },
        };
        const service = new AdminAreasGeographyService(geographyRepo as never, {} as never);
        await assert.rejects(
            () => service.getBoundaryContext("99999999-9999-4999-8999-999999999999"),
            (err: unknown) => err instanceof AdminAreaNotFoundError
        );
    });
});
