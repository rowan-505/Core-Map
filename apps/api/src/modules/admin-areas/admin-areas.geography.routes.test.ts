import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import Fastify from "fastify";

import adminAreasRoutes from "./admin-areas.routes.js";
import { AdminAreasGeographyRepository } from "./admin-areas.geography.repo.js";

function sqlText(query: unknown): string {
    if (typeof query === "string") {
        return query;
    }
    // Prisma $queryRaw tagged templates pass TemplateStringsArray (array-like).
    if (query && typeof query === "object" && typeof (query as { length?: unknown }).length === "number") {
        return Array.from(query as ArrayLike<string>).join("?");
    }
    if (query && typeof query === "object" && "strings" in query) {
        const strings = (query as { strings: readonly string[] }).strings;
        return Array.isArray(strings) ? strings.join("?") : String(query);
    }
    return String(query);
}

const sampleListRow = {
    id: 6610n,
    public_id: "11111111-1111-4111-8111-111111111111",
    parent_id: 6329n,
    canonical_name: "Taunggyi",
    slug: "taunggyi",
    admin_level_id: 4n,
    admin_level_code: "township",
    admin_area_type_id: 4n,
    admin_area_type_code: "township",
    is_active: true,
    verification_status: "verified",
    address_usage: "official",
    boundary_status: "official",
    is_official_boundary: true,
    is_public_usable: true,
    geometry_source: null,
    updated_at: new Date("2026-09-21T00:00:00.000Z"),
    bbox: [96.9, 20.6, 97.2, 21.0],
    centroid: { type: "Point" as const, coordinates: [97.0, 20.8] as [number, number] },
};

describe("AdminAreasGeographyRepository", () => {
    it("returns empty MVT without querying below min zoom", async () => {
        let calls = 0;
        const prisma = {
            $queryRaw: async () => {
                calls += 1;
                return [];
            },
        } as unknown as PrismaClient;

        const repo = new AdminAreasGeographyRepository(prisma);
        const tile = await repo.queryAdminAreasMvt({ z: 3, x: 0, y: 0 });
        assert.equal(tile.length, 0);
        assert.equal(calls, 0);
    });

    it("list query selects bbox/centroid and never ST_AsGeoJSON(geom) for list", async () => {
        const queries: string[] = [];
        const prisma = {
            $queryRaw: async (query: unknown) => {
                const text = sqlText(query);
                queries.push(text);
                if (/count\(\*\)/i.test(text)) {
                    return [{ count: 1n }];
                }
                return [sampleListRow];
            },
        } as unknown as PrismaClient;

        const repo = new AdminAreasGeographyRepository(prisma);
        const result = await repo.listAdminAreas({ limit: 10, offset: 0, level: "township" });
        assert.equal(result.total, 1);
        assert.equal(result.rows[0]?.canonical_name, "Taunggyi");

        const listSql = queries.find((q) => /ST_XMin/i.test(q)) ?? "";
        assert.match(listSql, /ST_XMin/i);
        assert.match(listSql, /ST_AsGeoJSON\(a\.centroid\)/i);
        assert.doesNotMatch(listSql, /ST_AsGeoJSON\(a\.geom\)/i);
    });

    it("detail includes geometry only when requested", async () => {
        const prisma = {
            $queryRaw: async () => [
                {
                    ...sampleListRow,
                    geom_geojson: { type: "Polygon", coordinates: [] },
                    child_count: 0n,
                    postal_count: 0n,
                    verification_note: null,
                },
            ],
        } as unknown as PrismaClient;

        const repo = new AdminAreasGeographyRepository(prisma);
        const withGeom = await repo.getAdminAreaDetail({ id: 6610n, includeGeometry: true });
        assert.ok(withGeom?.geom_geojson);
        assert.equal(withGeom?.verification_note, null);
    });

    it("boundary context neighbour SQL uses bbox margin, simplify, and hard limit", async () => {
        const queries: string[] = [];
        const prisma = {
            $queryRaw: async (query: unknown) => {
                const text = sqlText(query);
                queries.push(text);
                if (/ST_Expand/i.test(text) && /search_box/i.test(text)) {
                    return [];
                }
                if (/display_name/i.test(text) && /parent_id/i.test(text)) {
                    return [
                        {
                            id: 6610n,
                            public_id: sampleListRow.public_id,
                            parent_id: 100n,
                            display_name: "Taunggyi",
                            type_code: "township",
                            admin_level_code: "township",
                            admin_level_id: 4n,
                            geometry_source: null,
                            verification_status: "verified",
                            geometry: { type: "Polygon", coordinates: [] },
                            bbox: [96.9, 20.6, 97.2, 21.0],
                        },
                    ];
                }
                return [];
            },
        } as unknown as PrismaClient;

        const repo = new AdminAreasGeographyRepository(prisma);
        const context = await repo.getBoundaryContext(6610n);
        assert.ok(context?.selected);
        const neighbourSql = queries.find((q) => /ST_Expand/i.test(q) && /search_box/i.test(q)) ?? "";
        assert.match(neighbourSql, /ST_Expand/i);
        assert.match(neighbourSql, /ST_SimplifyPreserveTopology/i);
        assert.match(neighbourSql, /LIMIT/i);
        assert.doesNotMatch(neighbourSql, /WHERE a\.deleted_at IS NULL\s*$/i);
    });
});

describe("admin-areas geography routes", () => {
    async function buildApp(handlers: {
        listRows?: typeof sampleListRow[];
        detail?: Record<string, unknown> | null;
        denyDashboard?: boolean;
        viewerOnly?: boolean;
        tile?: Buffer;
    }) {
        const listRows = handlers.listRows ?? [sampleListRow];
        const app = Fastify({ logger: false });

        app.decorate(
            "prisma",
            {
                $queryRaw: async (query: unknown) => {
                    const text = sqlText(query);
                    if (/to_regclass\('ref\.ref_postal_codes'\)/i.test(text) || /to_regclass\(\$1\)/i.test(text) && /ref_postal/i.test(text)) {
                        return [{ ok: true }];
                    }
                    if (/to_regclass/i.test(text)) {
                        return [{ ok: true }];
                    }
                    if (/ST_AsMVT/i.test(text)) {
                        return [{ tile: handlers.tile ?? Buffer.from([0x1a, 0x00]) }];
                    }
                    // Detail SELECT embeds child_count / postal_count (and may mention ref_postal_codes).
                    if (/AS child_count/i.test(text) && /AS postal_count/i.test(text)) {
                        if (handlers.detail === null) {
                            return [];
                        }
                        if (handlers.detail) {
                            return [handlers.detail];
                        }
                        return [
                            {
                                ...sampleListRow,
                                geom_geojson: null,
                                child_count: 2n,
                                postal_count: 3n,
                                verification_note: null,
                            },
                        ];
                    }
                    if (/ref\.ref_postal_codes/i.test(text) && /count\(\*\)/i.test(text)) {
                        return [{ count: 1n }];
                    }
                    if (/ref\.ref_postal_codes/i.test(text)) {
                        return [
                            {
                                postal_code: "0101001",
                                region_name_en: "Kachin",
                                region_name_my: null,
                                township_name_en: "Myitkyina",
                                township_name_my: null,
                                locality_name_en: null,
                                locality_name_my: null,
                                locality_type: null,
                                township_admin_area_id: 6610n,
                                local_admin_area_id: null,
                                match_status: "linked_township_only",
                                match_method: "exact",
                                source_name: "Myanmar Post",
                                source_version: "V1.0",
                            },
                        ];
                    }
                    if (/core_admin_area_names/i.test(text)) {
                        return [
                            {
                                id: 1n,
                                language_code: "en",
                                name: "Taunggyi",
                                name_type: "official",
                                is_primary: true,
                            },
                        ];
                    }
                    if (/WITH RECURSIVE chain/i.test(text)) {
                        return [];
                    }
                    // Boundary context / validate-geometry resolve by id or public_id (short lookup only).
                    if (
                        /FROM core\.core_admin_areas AS a/i.test(text) &&
                        /LIMIT 1/i.test(text) &&
                        (/a\.public_id\s*=/i.test(text) || /WHERE a\.id =/i.test(text)) &&
                        !/canonical_name/i.test(text) &&
                        !/display_name/i.test(text) &&
                        !/ST_/i.test(text) &&
                        !/count\(/i.test(text) &&
                        !/AS child_count/i.test(text)
                    ) {
                        return [{ id: 6610n }];
                    }
                    if (/outside_parent_m2/i.test(text) || /overlaps_json/i.test(text)) {
                        return [
                            {
                                allowed_type: true,
                                is_valid: true,
                                invalid_reason: null,
                                is_empty: false,
                                has_parent: false,
                                outside_parent_m2: null,
                                outside_parent_geojson: null,
                                overlaps_json: [],
                                touching_neighbour_count: 0,
                            },
                        ];
                    }
                    if (/display_name/i.test(text) && /admin_level_id/i.test(text) && /ST_AsGeoJSON/i.test(text)) {
                        if (/ST_Expand/i.test(text) || /search_box/i.test(text)) {
                            return [];
                        }
                        return [
                            {
                                id: 6610n,
                                public_id: sampleListRow.public_id,
                                parent_id: null,
                                display_name: "Taunggyi",
                                type_code: "township",
                                admin_level_code: "township",
                                admin_level_id: 4n,
                                geometry_source: null,
                                verification_status: "verified",
                                geometry: {
                                    type: "Polygon",
                                    coordinates: [
                                        [
                                            [96.1, 16.7],
                                            [96.2, 16.7],
                                            [96.2, 16.8],
                                            [96.1, 16.8],
                                            [96.1, 16.7],
                                        ],
                                    ],
                                },
                                bbox: [96.1, 16.7, 96.2, 16.8],
                            },
                        ];
                    }
                    if (/ST_XMin/i.test(text) && /FROM core\.core_admin_areas/i.test(text)) {
                        return listRows;
                    }
                    if (
                        /a\.parent_id =/i.test(text) &&
                        /count\(\*\)/i.test(text) &&
                        !/AS child_count/i.test(text)
                    ) {
                        return [{ count: 0n }];
                    }
                    if (/a\.parent_id =/i.test(text) && /ORDER BY a\.canonical_name/i.test(text)) {
                        return [];
                    }
                    if (/count\(\*\)/i.test(text) && !/AS child_count/i.test(text)) {
                        return [{ count: BigInt(listRows.length) }];
                    }
                    return listRows;
                },
            } as unknown as PrismaClient
        );

        app.decorate("authenticate", async (request) => {
            if (handlers.denyDashboard) {
                request.user = { roles: ["user"] } as never;
                return;
            }
            if (handlers.viewerOnly) {
                request.user = { roles: ["viewer"], id: "9", sub: "9", email: "v@x.com" } as never;
                return;
            }
            request.user = { roles: ["admin"], id: "1", sub: "1", email: "a@x.com" } as never;
        });

        app.decorate("requireDashboardAccess", async (request, reply) => {
            const roles = request.user?.roles ?? [];
            if (!roles.some((r) => ["viewer", "admin", "super_admin"].includes(r))) {
                return reply.code(403).send({
                    code: "FORBIDDEN",
                    message: "Dashboard access requires a dashboard role.",
                });
            }
        });

        app.decorate("requireDashboardWrite", async (request, reply) => {
            const roles = request.user?.roles ?? [];
            if (!roles.some((r) => ["admin", "super_admin"].includes(r))) {
                return reply.code(403).send({
                    code: "READ_ONLY",
                    message: "Read-only dashboard access cannot modify data.",
                });
            }
        });

        await app.register(adminAreasRoutes);
        await app.ready();
        return app;
    }

    it("lists admin areas as a paginated envelope", async () => {
        const app = await buildApp({});
        const res = await app.inject({ method: "GET", url: "/admin-areas?limit=10&level=township" });
        assert.equal(res.statusCode, 200);
        const body = res.json();
        assert.equal(body.total, 1);
        assert.equal(body.items[0].canonical_name, "Taunggyi");
        assert.ok(Array.isArray(body.items[0].bbox));
        assert.equal(body.items[0].geometry, undefined);
        await app.close();
    });

    it("returns detail without geometry by default", async () => {
        const app = await buildApp({});
        const res = await app.inject({ method: "GET", url: "/admin-areas/6610" });
        assert.equal(res.statusCode, 200);
        const body = res.json();
        assert.equal(body.id, "6610");
        assert.equal(body.geometry, null);
        assert.equal(body.child_count, 2);
        assert.equal(body.postal_count, 3);
        assert.ok(Array.isArray(body.names));
        await app.close();
    });

    it("rejects non-dashboard roles", async () => {
        const app = await buildApp({ denyDashboard: true });
        const res = await app.inject({ method: "GET", url: "/admin-areas" });
        assert.equal(res.statusCode, 403);
        await app.close();
    });

    it("serves MVT content-type for tiles", async () => {
        const app = await buildApp({ tile: Buffer.from([0x1a, 0x02, 0x08]) });
        const res = await app.inject({
            method: "GET",
            url: "/admin-areas/tiles/8/200/120?level=township",
        });
        assert.equal(res.statusCode, 200);
        assert.match(res.headers["content-type"] ?? "", /application\/vnd\.mapbox-vector-tile/);
        assert.ok(res.body.length > 0);
        await app.close();
    });

    it("searches postal codes behind dashboard auth", async () => {
        const app = await buildApp({});
        const res = await app.inject({ method: "GET", url: "/postal-codes?q=0101" });
        assert.equal(res.statusCode, 200);
        const body = res.json();
        assert.equal(body.items[0].postal_code, "0101001");
        await app.close();
    });

    it("rejects geometry mutation for viewer (read-only) roles", async () => {
        const app = await buildApp({ viewerOnly: true });
        const res = await app.inject({
            method: "PATCH",
            url: "/admin-areas/6610/geometry",
            payload: {
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [96.1, 16.7],
                            [96.2, 16.7],
                            [96.2, 16.8],
                            [96.1, 16.8],
                            [96.1, 16.7],
                        ],
                    ],
                },
                expected_updated_at: "2026-09-21T00:00:00.000Z",
            },
        });
        assert.equal(res.statusCode, 403);
        await app.close();
    });

    it("serves boundary context for publicId without nationwide geometry", async () => {
        const app = await buildApp({});
        const res = await app.inject({
            method: "GET",
            url: "/admin-areas/11111111-1111-4111-8111-111111111111/context",
        });
        assert.equal(res.statusCode, 200);
        const body = res.json();
        assert.equal(body.selected.public_id, sampleListRow.public_id);
        assert.ok(body.selected.geometry);
        assert.ok(Array.isArray(body.neighbours));
        assert.ok(body.meta.neighbour_limit <= 50);
        assert.equal(body.meta.neighbour_truncated, false);
        await app.close();
    });

    it("accepts validate-geometry body shape under dashboard auth", async () => {
        const app = await buildApp({});
        const res = await app.inject({
            method: "POST",
            url: "/admin-areas/6610/validate-geometry",
            payload: {
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [96.1, 16.7],
                            [96.2, 16.7],
                            [96.2, 16.8],
                            [96.1, 16.8],
                            [96.1, 16.7],
                        ],
                    ],
                },
            },
        });
        assert.equal(res.statusCode, 200);
        const body = res.json();
        assert.equal(body.is_valid, true);
        assert.ok(Array.isArray(body.checks));
        assert.equal(body.checks.find((c: { id: string }) => c.id === "touching")?.severity, "pass");
        await app.close();
    });
});
