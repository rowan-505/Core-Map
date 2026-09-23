import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    adminAreaGeometryPatchBodySchema,
    licenseStatusForGeometrySource,
} from "./admin-areas.geography.schema.js";
import {
    AdminAreaGeometryConflictError,
    AdminAreaGeometryValidationError,
    AdminAreaNotFoundError,
    AdminAreasGeographyService,
} from "./admin-areas.geography.service.js";

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

const selfIntersectingPolygon = {
    type: "Polygon" as const,
    coordinates: [
        [
            [96.0, 16.0],
            [96.2, 16.2],
            [96.0, 16.2],
            [96.2, 16.0],
            [96.0, 16.0],
        ],
    ],
};

function baseExisting(overrides: Record<string, unknown> = {}) {
    return {
        id: 6610n,
        public_id: "11111111-1111-4111-8111-111111111111",
        canonical_name: "Taunggyi",
        updated_at: new Date("2026-09-21T00:00:00.000Z"),
        geometry_source: null as string | null,
        source_license_status: "coremap_internal" as string | null,
        verification_status: "verified",
        geom_geojson: validPolygon,
        ...overrides,
    };
}

describe("adminAreaGeometryPatchBodySchema", () => {
    it("accepts Polygon with expected_updated_at", () => {
        const parsed = adminAreaGeometryPatchBodySchema.parse({
            geometry: validPolygon,
            expected_updated_at: "2026-09-21T00:00:00.000Z",
            geometry_source: "coremap_manual",
        });
        assert.equal(parsed.geometry.type, "Polygon");
    });

    it("rejects LineString geometry type", () => {
        assert.throws(() =>
            adminAreaGeometryPatchBodySchema.parse({
                geometry: { type: "LineString", coordinates: [[96, 16], [96.1, 16.1]] },
                expected_updated_at: "2026-09-21T00:00:00.000Z",
            })
        );
    });
});

describe("licenseStatusForGeometrySource", () => {
    it("maps sources to truthful license statuses", () => {
        assert.equal(licenseStatusForGeometrySource("osm"), "odbl-1.0");
        assert.equal(licenseStatusForGeometrySource("government"), "government_source");
        assert.equal(licenseStatusForGeometrySource("coremap_manual"), "coremap_internal");
    });
});

describe("AdminAreasGeographyService.updateGeometry", () => {
    it("saves a valid polygon", async () => {
        const existing = baseExisting();
        let updateCalled = false;
        const geographyRepo = {
            async getAdminAreaForGeometryEdit() {
                return existing;
            },
            async analyzeAdminAreaGeometry() {
                return {
                    allowed_type: true,
                    is_valid: true,
                    invalid_reason: null,
                    is_empty: false,
                    srid: 4326,
                    within_myanmar: true,
                    area_m2: 12_000,
                };
            },
            async updateAdminAreaGeometry(args: { geometrySource: string }) {
                updateCalled = true;
                assert.equal(args.geometrySource, "coremap_manual");
                return {
                    updated: {
                        ...existing,
                        geometry_source: "coremap_manual",
                        updated_at: new Date("2026-09-21T01:00:00.000Z"),
                        geom_geojson: validPolygon,
                        bbox: [96.1, 16.7, 96.2, 16.8],
                        centroid: { type: "Point", coordinates: [96.15, 16.75] },
                    },
                };
            },
        };
        const service = new AdminAreasGeographyService(geographyRepo as never, {} as never);
        const result = await service.updateGeometry(
            "6610",
            {
                geometry: validPolygon,
                expected_updated_at: existing.updated_at.toISOString(),
                geometry_source: "coremap_manual",
            },
            { sub: "42", email: "a@b.c", roles: ["admin"], id: "42" }
        );
        assert.equal(updateCalled, true);
        assert.equal(result.geometry_source, "coremap_manual");
        assert.equal(result.replaced_mimu_placeholder, false);
    });

    it("rejects self-intersecting polygons without calling update", async () => {
        let updateCalled = false;
        const geographyRepo = {
            async getAdminAreaForGeometryEdit() {
                return baseExisting();
            },
            async analyzeAdminAreaGeometry() {
                return {
                    allowed_type: true,
                    is_valid: false,
                    invalid_reason: "Self-intersection[96 16]",
                    is_empty: false,
                    srid: 4326,
                    within_myanmar: true,
                    area_m2: null,
                };
            },
            async updateAdminAreaGeometry() {
                updateCalled = true;
                return null;
            },
        };
        const service = new AdminAreasGeographyService(geographyRepo as never, {} as never);
        await assert.rejects(
            () =>
                service.updateGeometry(
                    "6610",
                    {
                        geometry: selfIntersectingPolygon,
                        expected_updated_at: "2026-09-21T00:00:00.000Z",
                    },
                    { sub: "42", email: "a@b.c", roles: ["admin"] }
                ),
            (err: unknown) =>
                err instanceof AdminAreaGeometryValidationError &&
                err.issues.some((i) => /Self-intersection|ST_IsValid/i.test(i.message))
        );
        assert.equal(updateCalled, false);
    });

    it("rejects wrong geometry type from PostGIS analysis", async () => {
        let updateCalled = false;
        const geographyRepo = {
            async getAdminAreaForGeometryEdit() {
                return baseExisting();
            },
            async analyzeAdminAreaGeometry() {
                return {
                    allowed_type: false,
                    is_valid: false,
                    invalid_reason: null,
                    is_empty: true,
                    srid: 4326,
                    within_myanmar: false,
                    area_m2: null,
                };
            },
            async updateAdminAreaGeometry() {
                updateCalled = true;
                return null;
            },
        };
        const service = new AdminAreasGeographyService(geographyRepo as never, {} as never);
        await assert.rejects(
            () =>
                service.updateGeometry(
                    "6610",
                    {
                        geometry: validPolygon,
                        expected_updated_at: "2026-09-21T00:00:00.000Z",
                    },
                    { sub: "42", email: "a@b.c", roles: ["admin"] }
                ),
            (err: unknown) =>
                err instanceof AdminAreaGeometryValidationError &&
                err.issues.some((i) => /Polygon or MultiPolygon/i.test(i.message))
        );
        assert.equal(updateCalled, false);
    });

    it("returns 409 conflict on stale updated_at", async () => {
        const geographyRepo = {
            async getAdminAreaForGeometryEdit() {
                return baseExisting();
            },
            async analyzeAdminAreaGeometry() {
                return {
                    allowed_type: true,
                    is_valid: true,
                    invalid_reason: null,
                    is_empty: false,
                    srid: 4326,
                    within_myanmar: true,
                    area_m2: 5000,
                };
            },
            async updateAdminAreaGeometry() {
                return null;
            },
        };
        const service = new AdminAreasGeographyService(geographyRepo as never, {} as never);
        await assert.rejects(
            () =>
                service.updateGeometry(
                    "6610",
                    {
                        geometry: validPolygon,
                        expected_updated_at: "2020-01-01T00:00:00.000Z",
                    },
                    { sub: "42", email: "a@b.c", roles: ["admin"] }
                ),
            AdminAreaGeometryConflictError
        );
    });

    it("replaces mimu_placeholder with coremap_manual and needs_fix", async () => {
        const existing = baseExisting({
            geometry_source: "mimu_placeholder",
            source_license_status: "permission_pending",
            verification_status: "unverified",
        });
        const geographyRepo = {
            async getAdminAreaForGeometryEdit() {
                return existing;
            },
            async analyzeAdminAreaGeometry() {
                return {
                    allowed_type: true,
                    is_valid: true,
                    invalid_reason: null,
                    is_empty: false,
                    srid: 4326,
                    within_myanmar: true,
                    area_m2: 8000,
                };
            },
            async updateAdminAreaGeometry(args: {
                geometrySource: string;
                sourceLicenseStatus: string;
                verificationStatus: string;
                markUnverified: boolean;
            }) {
                assert.equal(args.geometrySource, "coremap_manual");
                assert.equal(args.sourceLicenseStatus, "coremap_internal");
                assert.equal(args.verificationStatus, "needs_fix");
                assert.equal(args.markUnverified, true);
                return {
                    updated: {
                        ...existing,
                        geometry_source: "coremap_manual",
                        source_license_status: "coremap_internal",
                        verification_status: "needs_fix",
                        updated_at: new Date("2026-09-21T02:00:00.000Z"),
                        geom_geojson: validPolygon,
                        bbox: [96.1, 16.7, 96.2, 16.8],
                        centroid: { type: "Point", coordinates: [96.15, 16.75] },
                    },
                };
            },
        };
        const service = new AdminAreasGeographyService(geographyRepo as never, {} as never);
        const result = await service.updateGeometry(
            "6610",
            {
                geometry: validPolygon,
                expected_updated_at: existing.updated_at.toISOString(),
                geometry_source: "coremap_manual",
            },
            { sub: "7", email: "a@b.c", roles: ["admin"], id: "7" }
        );
        assert.equal(result.replaced_mimu_placeholder, true);
        assert.equal(result.geometry_source, "coremap_manual");
        assert.equal(result.verification_status, "needs_fix");
        // No longer mimu_placeholder → drops out of “MIMU placeholders only” filter.
        assert.notEqual(result.geometry_source, "mimu_placeholder");
    });

    it("rolls back when transaction analysis fails after outer validation", async () => {
        const geographyRepo = {
            async getAdminAreaForGeometryEdit() {
                return baseExisting();
            },
            async analyzeAdminAreaGeometry() {
                return {
                    allowed_type: true,
                    is_valid: true,
                    invalid_reason: null,
                    is_empty: false,
                    srid: 4326,
                    within_myanmar: true,
                    area_m2: 5000,
                };
            },
            async updateAdminAreaGeometry() {
                throw new Error("ADMIN_AREA_GEOMETRY_ANALYSIS_FAILED");
            },
        };
        const service = new AdminAreasGeographyService(geographyRepo as never, {} as never);
        await assert.rejects(
            () =>
                service.updateGeometry(
                    "6610",
                    {
                        geometry: validPolygon,
                        expected_updated_at: "2026-09-21T00:00:00.000Z",
                    },
                    { sub: "42", email: "a@b.c", roles: ["admin"] }
                ),
            (err: unknown) =>
                err instanceof AdminAreaGeometryValidationError &&
                /no changes were saved/i.test(err.issues[0]?.message ?? "")
        );
    });

    it("throws not found for missing area", async () => {
        const geographyRepo = {
            async getAdminAreaForGeometryEdit() {
                return null;
            },
        };
        const service = new AdminAreasGeographyService(geographyRepo as never, {} as never);
        await assert.rejects(
            () =>
                service.updateGeometry(
                    "999",
                    {
                        geometry: validPolygon,
                        expected_updated_at: "2026-09-21T00:00:00.000Z",
                    },
                    { sub: "42", email: "a@b.c", roles: ["admin"] }
                ),
            AdminAreaNotFoundError
        );
    });
});
