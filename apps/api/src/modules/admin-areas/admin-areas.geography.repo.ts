import { Prisma, type PrismaClient } from "@prisma/client";

import {
    BOUNDARY_AREA_EPSILON_HA,
    BOUNDARY_CONTEXT_BBOX_MARGIN_DEG,
    BOUNDARY_CONTEXT_NEIGHBOUR_LIMIT,
    BOUNDARY_CONTEXT_NEIGHBOUR_SIMPLIFY_DEG,
    resolveAdminAreaLookup,
} from "./admin-areas.boundary-review.js";
import {
    ADMIN_AREAS_MVT_FEATURE_LIMIT,
    ADMIN_AREAS_MVT_LAYER,
    ADMIN_AREAS_MVT_STATEMENT_TIMEOUT_MS,
    isValidAdminAreaTileCoord,
    shouldServeAdminAreaTile,
    simplifyToleranceDegrees,
} from "./admin-areas.mvt.js";

export type AdminAreaListRow = {
    id: bigint;
    public_id: string;
    parent_id: bigint | null;
    canonical_name: string;
    slug: string;
    admin_level_id: bigint;
    admin_level_code: string;
    admin_area_type_id: bigint | null;
    admin_area_type_code: string | null;
    is_active: boolean;
    verification_status: string;
    address_usage: string;
    boundary_status: string;
    is_official_boundary: boolean;
    is_public_usable: boolean | null;
    geometry_source: string | null;
    source_license_status: string | null;
    remediation_decision: string | null;
    evidence: unknown | null;
    updated_at: Date;
    bbox: number[] | null;
    centroid: { type: "Point"; coordinates: [number, number] } | null;
};

export type AdminAreaNameRow = {
    id: bigint;
    language_code: string | null;
    name: string;
    name_type: string;
    is_primary: boolean;
};

export type AdminAreaAncestorRow = {
    id: bigint;
    canonical_name: string;
    admin_level_code: string;
    depth: number;
};

export type AdminAreaChildSummary = {
    id: bigint;
    canonical_name: string;
    admin_level_code: string;
    is_active: boolean;
};

export type AdminAreaDetailRow = AdminAreaListRow & {
    geom_geojson: unknown | null;
    child_count: bigint;
    postal_count: bigint;
    verification_note: string | null;
    source_refs: unknown | null;
    updated_at: Date;
};

export type AdminAreaGeometryAnalysisRow = {
    allowed_type: boolean;
    is_valid: boolean;
    invalid_reason: string | null;
    is_empty: boolean;
    srid: number | null;
    within_myanmar: boolean;
    area_m2: number | null;
};

export type AdminAreaGeometryEditRow = {
    id: bigint;
    public_id: string;
    canonical_name: string;
    updated_at: Date;
    geometry_source: string | null;
    source_license_status: string | null;
    verification_status: string;
    verification_note: string | null;
    boundary_status: string | null;
    is_active: boolean;
    is_public_usable: boolean | null;
    remediation_decision: string | null;
    evidence: unknown | null;
    geom_geojson: unknown | null;
};

export type AdminAreaBoundaryContextMemberRow = {
    id: bigint;
    public_id: string;
    parent_id: bigint | null;
    display_name: string;
    type_code: string | null;
    admin_level_code: string;
    admin_level_id: bigint;
    geometry_source: string | null;
    verification_status: string;
    geometry: unknown | null;
    bbox: number[] | null;
};

export type AdminAreaDraftGeometryValidationRow = {
    allowed_type: boolean;
    is_valid: boolean;
    invalid_reason: string | null;
    is_empty: boolean;
    has_parent: boolean;
    outside_parent_m2: number | null;
    outside_parent_geojson: unknown | null;
    overlaps_json: unknown;
    touching_neighbour_count: number;
};

async function postalCodesTableExists(prisma: PrismaClient): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT to_regclass('ref.ref_postal_codes') IS NOT NULL AS ok
    `;
    return rows[0]?.ok === true;
}

function buildFilterClauses(args: {
    level?: string;
    type?: string;
    parentId?: bigint;
    status?: string;
    geometrySource?: string;
    official?: boolean;
    isPublic?: boolean;
    remediationDecision?: string;
    evidenceStatus?: string;
}): Prisma.Sql {
    const parts: Prisma.Sql[] = [
        Prisma.sql`a.deleted_at IS NULL`,
    ];

    if (args.level) {
        parts.push(Prisma.sql`lower(btrim(al.code)) = lower(btrim(${args.level}))`);
    }
    if (args.type) {
        parts.push(Prisma.sql`lower(btrim(t.code)) = lower(btrim(${args.type}))`);
    }
    if (args.parentId !== undefined) {
        parts.push(Prisma.sql`a.parent_id = ${args.parentId}`);
    }
    if (args.status) {
        parts.push(Prisma.sql`lower(btrim(a.verification_status)) = lower(btrim(${args.status}))`);
    }
    if (args.geometrySource) {
        parts.push(Prisma.sql`lower(btrim(coalesce(a.geometry_source, ''))) = lower(btrim(${args.geometrySource}))`);
    }
    if (args.official !== undefined) {
        parts.push(Prisma.sql`a.is_official_boundary = ${args.official}`);
    }
    if (args.isPublic !== undefined) {
        parts.push(Prisma.sql`coalesce(a.is_public_usable, false) = ${args.isPublic}`);
    }
    if (args.remediationDecision) {
        parts.push(
            Prisma.sql`lower(btrim(coalesce(a.remediation_decision, ''))) = lower(btrim(${args.remediationDecision}))`
        );
    }
    if (args.evidenceStatus === "none") {
        parts.push(
            Prisma.sql`(a.evidence IS NULL OR jsonb_typeof(a.evidence->'items') <> 'array' OR jsonb_array_length(a.evidence->'items') = 0)`
        );
        parts.push(
            Prisma.sql`lower(btrim(coalesce(a.remediation_decision, ''))) IS DISTINCT FROM 'needs_evidence'`
        );
    } else if (args.evidenceStatus === "has_evidence") {
        parts.push(
            Prisma.sql`(a.evidence IS NOT NULL AND jsonb_typeof(a.evidence->'items') = 'array' AND jsonb_array_length(a.evidence->'items') > 0)`
        );
    } else if (args.evidenceStatus === "needs_evidence") {
        parts.push(Prisma.sql`lower(btrim(coalesce(a.remediation_decision, ''))) = 'needs_evidence'`);
    }

    return Prisma.join(parts, " AND ");
}

function buildSearchClause(q: string | undefined): Prisma.Sql {
    if (!q) {
        return Prisma.sql`TRUE`;
    }
    const trimmed = q.trim();
    if (/^\d+$/.test(trimmed)) {
        const id = BigInt(trimmed);
        return Prisma.sql`(a.id = ${id} OR a.slug ILIKE ${`%${trimmed}%`})`;
    }
    const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
    if (isUuid) {
        return Prisma.sql`a.public_id = ${trimmed}::uuid`;
    }
    const pattern = `%${trimmed}%`;
    return Prisma.sql`(
        a.canonical_name ILIKE ${pattern}
        OR a.slug ILIKE ${pattern}
        OR EXISTS (
            SELECT 1
            FROM core.core_admin_area_names AS n
            WHERE n.admin_area_id = a.id
              AND n.name ILIKE ${pattern}
        )
    )`;
}

export class AdminAreasGeographyRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listAdminAreas(args: {
        limit: number;
        offset: number;
        q?: string;
        level?: string;
        type?: string;
        parentId?: bigint;
        status?: string;
        geometrySource?: string;
        official?: boolean;
        isPublic?: boolean;
        remediationDecision?: string;
        evidenceStatus?: string;
    }): Promise<{ rows: AdminAreaListRow[]; total: number }> {
        const whereSql = Prisma.sql`
            ${buildFilterClauses(args)}
            AND ${buildSearchClause(args.q)}
        `;

        const totalRows = await this.prisma.$queryRaw<[{ count: bigint }]>`
            SELECT count(*)::bigint AS count
            FROM core.core_admin_areas AS a
            JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
            LEFT JOIN ref.ref_admin_area_types AS t ON t.id = a.admin_area_type_id
            WHERE ${whereSql}
        `;

        const rows = await this.prisma.$queryRaw<AdminAreaListRow[]>`
            SELECT
                a.id,
                a.public_id::text AS public_id,
                a.parent_id,
                a.canonical_name,
                a.slug,
                a.admin_level_id,
                al.code AS admin_level_code,
                a.admin_area_type_id,
                t.code AS admin_area_type_code,
                a.is_active,
                a.verification_status,
                a.address_usage,
                a.boundary_status,
                a.is_official_boundary,
                a.is_public_usable,
                a.geometry_source,
                a.source_license_status,
                a.remediation_decision,
                a.evidence,
                a.updated_at,
                CASE
                    WHEN a.geom IS NULL OR ST_IsEmpty(a.geom) THEN NULL
                    ELSE ARRAY[
                        ST_XMin(a.geom::box2d)::float8,
                        ST_YMin(a.geom::box2d)::float8,
                        ST_XMax(a.geom::box2d)::float8,
                        ST_YMax(a.geom::box2d)::float8
                    ]
                END AS bbox,
                CASE
                    WHEN a.centroid IS NULL THEN NULL
                    ELSE ST_AsGeoJSON(a.centroid)::json
                END AS centroid
            FROM core.core_admin_areas AS a
            JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
            LEFT JOIN ref.ref_admin_area_types AS t ON t.id = a.admin_area_type_id
            WHERE ${whereSql}
            ORDER BY a.canonical_name ASC, a.id ASC
            LIMIT ${args.limit}
            OFFSET ${args.offset}
        `;

        return { rows, total: Number(totalRows[0]?.count ?? 0n) };
    }

    async getAdminAreaDetail(args: {
        id: bigint;
        includeGeometry: boolean;
    }): Promise<AdminAreaDetailRow | null> {
        const hasPostalCodes = await postalCodesTableExists(this.prisma);
        const postalCountSql = hasPostalCodes
            ? Prisma.sql`(
                    SELECT count(*)::bigint
                    FROM ref.ref_postal_codes AS p
                    WHERE p.township_admin_area_id = a.id
                       OR p.local_admin_area_id = a.id
                )`
            : Prisma.sql`0::bigint`;

        const rows = await this.prisma.$queryRaw<AdminAreaDetailRow[]>`
            SELECT
                a.id,
                a.public_id::text AS public_id,
                a.parent_id,
                a.canonical_name,
                a.slug,
                a.admin_level_id,
                al.code AS admin_level_code,
                a.admin_area_type_id,
                t.code AS admin_area_type_code,
                a.is_active,
                a.verification_status,
                a.verification_note,
                a.address_usage,
                a.boundary_status,
                a.is_official_boundary,
                a.is_public_usable,
                a.geometry_source,
                a.source_license_status,
                a.remediation_decision,
                a.evidence,
                a.source_refs,
                a.updated_at,
                CASE
                    WHEN a.geom IS NULL OR ST_IsEmpty(a.geom) THEN NULL
                    ELSE ARRAY[
                        ST_XMin(a.geom::box2d)::float8,
                        ST_YMin(a.geom::box2d)::float8,
                        ST_XMax(a.geom::box2d)::float8,
                        ST_YMax(a.geom::box2d)::float8
                    ]
                END AS bbox,
                CASE
                    WHEN a.centroid IS NULL THEN NULL
                    ELSE ST_AsGeoJSON(a.centroid)::json
                END AS centroid,
                CASE
                    WHEN ${args.includeGeometry} THEN ST_AsGeoJSON(a.geom)::json
                    ELSE NULL
                END AS geom_geojson,
                (
                    SELECT count(*)::bigint
                    FROM core.core_admin_areas AS c
                    WHERE c.parent_id = a.id AND c.deleted_at IS NULL
                ) AS child_count,
                ${postalCountSql} AS postal_count
            FROM core.core_admin_areas AS a
            JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
            LEFT JOIN ref.ref_admin_area_types AS t ON t.id = a.admin_area_type_id
            WHERE a.id = ${args.id}
              AND a.deleted_at IS NULL
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async listNames(adminAreaId: bigint): Promise<AdminAreaNameRow[]> {
        return this.prisma.$queryRaw<AdminAreaNameRow[]>`
            SELECT id, language_code, name, name_type, is_primary
            FROM core.core_admin_area_names
            WHERE admin_area_id = ${adminAreaId}
            ORDER BY
                CASE WHEN is_primary THEN 0 ELSE 1 END,
                language_code NULLS LAST,
                id
        `;
    }

    async listAncestors(adminAreaId: bigint): Promise<AdminAreaAncestorRow[]> {
        return this.prisma.$queryRaw<AdminAreaAncestorRow[]>`
            WITH RECURSIVE chain AS (
                SELECT a.id, a.parent_id, a.canonical_name, al.code AS admin_level_code, 0 AS depth
                FROM core.core_admin_areas AS a
                JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
                WHERE a.id = ${adminAreaId}
                UNION ALL
                SELECT p.id, p.parent_id, p.canonical_name, al.code, c.depth + 1
                FROM core.core_admin_areas AS p
                JOIN ref.ref_admin_levels AS al ON al.id = p.admin_level_id
                JOIN chain AS c ON p.id = c.parent_id
                WHERE c.depth < 20
            )
            SELECT id, canonical_name, admin_level_code, depth
            FROM chain
            WHERE id <> ${adminAreaId}
            ORDER BY depth DESC
        `;
    }

    async listChildren(args: {
        parentId: bigint;
        limit: number;
        offset: number;
        level?: string;
    }): Promise<{ rows: AdminAreaChildSummary[]; total: number }> {
        const levelClause = args.level
            ? Prisma.sql`AND lower(btrim(al.code)) = lower(btrim(${args.level}))`
            : Prisma.empty;

        const totalRows = await this.prisma.$queryRaw<[{ count: bigint }]>`
            SELECT count(*)::bigint AS count
            FROM core.core_admin_areas AS a
            JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
            WHERE a.parent_id = ${args.parentId}
              AND a.deleted_at IS NULL
              ${levelClause}
        `;

        const rows = await this.prisma.$queryRaw<AdminAreaChildSummary[]>`
            SELECT
                a.id,
                a.canonical_name,
                al.code AS admin_level_code,
                a.is_active
            FROM core.core_admin_areas AS a
            JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
            WHERE a.parent_id = ${args.parentId}
              AND a.deleted_at IS NULL
              ${levelClause}
            ORDER BY a.canonical_name ASC, a.id ASC
            LIMIT ${args.limit}
            OFFSET ${args.offset}
        `;

        return { rows, total: Number(totalRows[0]?.count ?? 0n) };
    }

    async queryAdminAreasMvt(args: {
        z: number;
        x: number;
        y: number;
        level?: string;
        type?: string;
        status?: string;
        geometrySource?: string;
        official?: boolean;
        isPublic?: boolean;
    }): Promise<Buffer> {
        if (!isValidAdminAreaTileCoord(args.z, args.x, args.y) || !shouldServeAdminAreaTile(args.z)) {
            return Buffer.alloc(0);
        }

        const tolerance = simplifyToleranceDegrees(args.z);
        const filterSql = buildFilterClauses({
            level: args.level,
            type: args.type,
            status: args.status,
            geometrySource: args.geometrySource,
            official: args.official,
            isPublic: args.isPublic,
        });

        const simplifySql =
            tolerance > 0
                ? Prisma.sql`ST_SimplifyPreserveTopology(a.geom, ${tolerance})`
                : Prisma.sql`a.geom`;

        const rows = await this.prisma.$queryRaw<[{ tile: Buffer | null }]>`
            WITH
            bounds_merc AS (
                SELECT ST_TileEnvelope(${args.z}::int, ${args.x}::int, ${args.y}::int) AS tile_geom
            ),
            bounds_4326 AS (
                SELECT ST_Transform((SELECT tile_geom FROM bounds_merc), 4326) AS geom
            ),
            src AS (
                SELECT
                    a.id::text AS id,
                    a.public_id::text AS public_id,
                    a.canonical_name AS name,
                    al.code AS level_code,
                    t.code AS type_code,
                    a.verification_status AS status,
                    a.geometry_source,
                    a.is_official_boundary,
                    coalesce(a.is_public_usable, false) AS is_public_usable,
                    ST_Transform(${simplifySql}, 3857) AS geom_merc
                FROM core.core_admin_areas AS a
                JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
                LEFT JOIN ref.ref_admin_area_types AS t ON t.id = a.admin_area_type_id
                WHERE ${filterSql}
                  AND a.geom && (SELECT geom FROM bounds_4326)
                  AND ST_Intersects(a.geom, (SELECT geom FROM bounds_4326))
                LIMIT ${ADMIN_AREAS_MVT_FEATURE_LIMIT}
            ),
            mvtgeom AS (
                SELECT
                    id,
                    public_id,
                    name,
                    level_code,
                    type_code,
                    status,
                    geometry_source,
                    is_official_boundary,
                    is_public_usable,
                    ST_AsMVTGeom(
                        geom_merc,
                        (SELECT tile_geom FROM bounds_merc),
                        4096,
                        64,
                        true
                    ) AS geom
                FROM src
                WHERE geom_merc IS NOT NULL AND NOT ST_IsEmpty(geom_merc)
            )
            SELECT ST_AsMVT(mvtgeom.*, ${ADMIN_AREAS_MVT_LAYER}::text, 4096, 'geom') AS tile
            FROM mvtgeom
            WHERE geom IS NOT NULL
        `;

        const tile = rows[0]?.tile;
        return tile && Buffer.isBuffer(tile) ? tile : Buffer.from(tile ?? []);
    }

    async getGeographySummary(): Promise<{
        official_first_level: number;
        official_township: number;
        ward_count: number;
        village_tract_count: number;
        settlement_count: number;
        placeholder_count: number;
        postal_linked_local: number;
        postal_linked_township_only: number;
        postal_unmatched_review: number;
        targets: {
            official_first_level: number;
            official_township: number;
        };
    }> {
        const hasPostalCodes = await postalCodesTableExists(this.prisma);

        const [adminRows, settlementRows, postalRows] = await Promise.all([
            this.prisma.$queryRaw<
                [
                    {
                        official_first_level: bigint;
                        official_township: bigint;
                        ward_count: bigint;
                        village_tract_count: bigint;
                        placeholder_count: bigint;
                    },
                ]
            >`
                SELECT
                    count(*) FILTER (
                        WHERE al.code = 'state_region'
                          AND a.is_official_boundary IS TRUE
                          AND coalesce(a.is_public_usable, false) IS TRUE
                    )::bigint AS official_first_level,
                    count(*) FILTER (
                        WHERE al.code = 'township'
                          AND a.is_official_boundary IS TRUE
                    )::bigint AS official_township,
                    count(*) FILTER (
                        WHERE t.code = 'ward'
                    )::bigint AS ward_count,
                    count(*) FILTER (
                        WHERE t.code = 'village_tract'
                    )::bigint AS village_tract_count,
                    count(*) FILTER (
                        WHERE lower(btrim(coalesce(a.geometry_source, ''))) = 'mimu_placeholder'
                    )::bigint AS placeholder_count
                FROM core.core_admin_areas AS a
                JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
                LEFT JOIN ref.ref_admin_area_types AS t ON t.id = a.admin_area_type_id
                WHERE a.deleted_at IS NULL
                  AND a.is_active IS TRUE
            `,
            this.prisma.$queryRaw<[{ settlement_count: bigint }]>`
                SELECT count(*)::bigint AS settlement_count
                FROM core.core_settlements AS s
                WHERE s.deleted_at IS NULL
            `,
            hasPostalCodes
                ? this.prisma.$queryRaw<
                      [
                          {
                              postal_linked_local: bigint;
                              postal_linked_township_only: bigint;
                              postal_unmatched_review: bigint;
                          },
                      ]
                  >`
                SELECT
                    count(*) FILTER (
                        WHERE match_status IN (
                            'linked_exact_local_area',
                            'linked_after_review',
                            'linked_local_area'
                        )
                    )::bigint AS postal_linked_local,
                    count(*) FILTER (
                        WHERE match_status = 'linked_township_only'
                    )::bigint AS postal_linked_township_only,
                    count(*) FILTER (
                        WHERE match_status IN (
                            'unmatched',
                            'ambiguous',
                            'ambiguous_local_area',
                            'missing_local_area'
                        )
                    )::bigint AS postal_unmatched_review
                FROM ref.ref_postal_codes
            `
                : Promise.resolve([
                      {
                          postal_linked_local: 0n,
                          postal_linked_township_only: 0n,
                          postal_unmatched_review: 0n,
                      },
                  ]),
        ]);

        const admin = adminRows[0];
        const settlement = settlementRows[0];
        const postal = postalRows[0];

        return {
            official_first_level: Number(admin?.official_first_level ?? 0n),
            official_township: Number(admin?.official_township ?? 0n),
            ward_count: Number(admin?.ward_count ?? 0n),
            village_tract_count: Number(admin?.village_tract_count ?? 0n),
            settlement_count: Number(settlement?.settlement_count ?? 0n),
            placeholder_count: Number(admin?.placeholder_count ?? 0n),
            postal_linked_local: Number(postal?.postal_linked_local ?? 0n),
            postal_linked_township_only: Number(postal?.postal_linked_township_only ?? 0n),
            postal_unmatched_review: Number(postal?.postal_unmatched_review ?? 0n),
            targets: {
                official_first_level: 15,
                official_township: 330,
            },
        };
    }

    async getAdminAreaForGeometryEdit(id: bigint): Promise<AdminAreaGeometryEditRow | null> {
        const rows = await this.prisma.$queryRaw<AdminAreaGeometryEditRow[]>`
            SELECT
                a.id,
                a.public_id::text AS public_id,
                a.canonical_name,
                a.updated_at,
                a.geometry_source,
                a.source_license_status,
                a.verification_status,
                a.verification_note,
                a.boundary_status,
                a.is_active,
                a.is_public_usable,
                a.remediation_decision,
                a.evidence,
                CASE
                    WHEN a.geom IS NULL OR ST_IsEmpty(a.geom) THEN NULL
                    ELSE ST_AsGeoJSON(a.geom)::json
                END AS geom_geojson
            FROM core.core_admin_areas AS a
            WHERE a.id = ${id}
              AND a.deleted_at IS NULL
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    /**
     * Validate GeoJSON for admin-area save. Never applies ST_MakeValid.
     * Myanmar containment uses PointOnSurface inside the country polygon when present.
     */
    async analyzeAdminAreaGeometry(
        geojsonText: string,
        db: PrismaClient = this.prisma
    ): Promise<AdminAreaGeometryAnalysisRow | null> {
        const rows = await db.$queryRaw<AdminAreaGeometryAnalysisRow[]>`
            WITH inp AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojsonText})::geometry, 4326) AS g_raw
            ),
            prep AS (
                SELECT
                    CASE
                        WHEN ST_GeometryType(g_raw) IN ('ST_Polygon', 'ST_MultiPolygon')
                            THEN g_raw
                        ELSE NULL
                    END AS geom,
                    ST_SRID(g_raw) AS srid
                FROM inp
            ),
            country AS (
                SELECT a.geom
                FROM core.core_admin_areas AS a
                JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
                WHERE al.code = 'country'
                  AND a.deleted_at IS NULL
                  AND a.geom IS NOT NULL
                ORDER BY a.id
                LIMIT 1
            )
            SELECT
                geom IS NOT NULL AS allowed_type,
                CASE WHEN geom IS NOT NULL THEN ST_IsValid(geom) ELSE FALSE END AS is_valid,
                CASE
                    WHEN geom IS NOT NULL AND NOT ST_IsValid(geom)
                        THEN ST_IsValidReason(geom)
                    ELSE NULL
                END AS invalid_reason,
                CASE
                    WHEN geom IS NULL THEN TRUE
                    ELSE ST_IsEmpty(geom)
                END AS is_empty,
                srid,
                CASE
                    WHEN geom IS NULL OR NOT ST_IsValid(geom) OR ST_IsEmpty(geom) THEN FALSE
                    WHEN (SELECT geom FROM country) IS NULL THEN
                        ST_XMin(geom) BETWEEN 92.0 AND 101.5
                        AND ST_XMax(geom) BETWEEN 92.0 AND 101.5
                        AND ST_YMin(geom) BETWEEN 9.0 AND 29.0
                        AND ST_YMax(geom) BETWEEN 9.0 AND 29.0
                    ELSE ST_Within(
                        ST_PointOnSurface(geom),
                        (SELECT geom FROM country)
                    )
                END AS within_myanmar,
                CASE
                    WHEN geom IS NOT NULL AND ST_IsValid(geom) AND NOT ST_IsEmpty(geom)
                        THEN ST_Area(geom::geography)::double precision
                    ELSE NULL
                END AS area_m2
            FROM prep
        `;
        return rows[0] ?? null;
    }

    async updateAdminAreaGeometry(args: {
        id: bigint;
        geojsonText: string;
        expectedUpdatedAt: Date;
        geometrySource: string;
        sourceLicenseStatus: string;
        verificationStatus: string;
        markUnverified: boolean;
        actorUserId: bigint | null;
        beforeSnapshot: Record<string, unknown>;
    }): Promise<{
        updated: AdminAreaGeometryEditRow & {
            bbox: number[] | null;
            centroid: unknown | null;
        };
    } | null> {
        return this.prisma.$transaction(async (tx) => {
            const analysis = await this.analyzeAdminAreaGeometry(args.geojsonText, tx as PrismaClient);
            if (
                !analysis?.allowed_type ||
                !analysis.is_valid ||
                analysis.is_empty ||
                !analysis.within_myanmar ||
                analysis.area_m2 === null ||
                !(analysis.area_m2 > 0)
            ) {
                // Safety net: never persist invalid geometry. Service validates first.
                throw new Error("ADMIN_AREA_GEOMETRY_ANALYSIS_FAILED");
            }

            const updated = await tx.$queryRaw<
                Array<
                    AdminAreaGeometryEditRow & {
                        bbox: number[] | null;
                        centroid: unknown | null;
                    }
                >
            >`
                WITH prepared AS (
                    SELECT ST_SetSRID(ST_GeomFromGeoJSON(${args.geojsonText})::geometry, 4326) AS geom
                )
                UPDATE core.core_admin_areas AS a
                SET
                    geom = prepared.geom,
                    centroid = ST_PointOnSurface(prepared.geom),
                    geometry_source = ${args.geometrySource},
                    source_license_status = ${args.sourceLicenseStatus},
                    verification_status = ${args.verificationStatus},
                    is_verified = CASE WHEN ${args.markUnverified} THEN FALSE ELSE a.is_verified END,
                    updated_at = now()
                FROM prepared
                WHERE a.id = ${args.id}
                  AND a.deleted_at IS NULL
                  AND a.updated_at = ${args.expectedUpdatedAt}
                RETURNING
                    a.id,
                    a.public_id::text AS public_id,
                    a.canonical_name,
                    a.updated_at,
                    a.geometry_source,
                    a.source_license_status,
                    a.verification_status,
                    ST_AsGeoJSON(a.geom)::json AS geom_geojson,
                    CASE
                        WHEN a.geom IS NULL OR ST_IsEmpty(a.geom) THEN NULL
                        ELSE ARRAY[
                            ST_XMin(a.geom::box2d)::float8,
                            ST_YMin(a.geom::box2d)::float8,
                            ST_XMax(a.geom::box2d)::float8,
                            ST_YMax(a.geom::box2d)::float8
                        ]
                    END AS bbox,
                    ST_AsGeoJSON(a.centroid)::json AS centroid
            `;

            const row = updated[0];
            if (!row) {
                return null;
            }

            const afterSnapshot = {
                id: row.id.toString(),
                public_id: row.public_id,
                canonical_name: row.canonical_name,
                geometry_source: row.geometry_source,
                source_license_status: row.source_license_status,
                verification_status: row.verification_status,
                updated_at: row.updated_at.toISOString(),
                bbox: row.bbox,
            };

            await tx.$executeRaw`
                INSERT INTO system.audit_logs (
                    actor_user_id,
                    action_type,
                    entity_type,
                    entity_id,
                    before_snapshot,
                    after_snapshot
                )
                VALUES (
                    ${args.actorUserId},
                    'admin_area_geometry_update',
                    'core_admin_areas',
                    ${args.id},
                    ${JSON.stringify(args.beforeSnapshot)}::jsonb,
                    ${JSON.stringify(afterSnapshot)}::jsonb
                )
            `;

            return { updated: row };
        });
    }

    async updateAdminAreaRemediation(args: {
        id: bigint;
        expectedUpdatedAt: Date;
        remediationDecision: string;
        geometrySource: string | null;
        sourceLicenseStatus: string | null;
        verificationStatus: string;
        verificationNote: string | null;
        boundaryStatus: string | null;
        isActive: boolean;
        isPublicUsable: boolean;
        /** When set (including JSON null literal), replaces evidence. When undefined, leave unchanged. */
        evidenceJson?: string | null;
        geojsonText: string | null;
        markUnverified: boolean;
        actorUserId: bigint | null;
        beforeSnapshot: Record<string, unknown>;
    }): Promise<{
        updated: AdminAreaGeometryEditRow & {
            bbox: number[] | null;
            centroid: unknown | null;
        };
    } | null> {
        return this.prisma.$transaction(async (tx) => {
            if (args.geojsonText) {
                const analysis = await this.analyzeAdminAreaGeometry(args.geojsonText, tx as PrismaClient);
                if (
                    !analysis?.allowed_type ||
                    !analysis.is_valid ||
                    analysis.is_empty ||
                    !analysis.within_myanmar ||
                    analysis.area_m2 === null ||
                    !(analysis.area_m2 > 0)
                ) {
                    throw new Error("ADMIN_AREA_GEOMETRY_ANALYSIS_FAILED");
                }
            }

            const geomSql = args.geojsonText
                ? Prisma.sql`
                    geom = ST_SetSRID(ST_GeomFromGeoJSON(${args.geojsonText})::geometry, 4326),
                    centroid = ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON(${args.geojsonText})::geometry, 4326)),
                `
                : Prisma.sql``;

            const evidenceSql =
                args.evidenceJson === undefined
                    ? Prisma.sql``
                    : args.evidenceJson === null
                      ? Prisma.sql`evidence = NULL,`
                      : Prisma.sql`evidence = ${args.evidenceJson}::jsonb,`;

            const updated = await tx.$queryRaw<
                Array<
                    AdminAreaGeometryEditRow & {
                        bbox: number[] | null;
                        centroid: unknown | null;
                    }
                >
            >`
                UPDATE core.core_admin_areas AS a
                SET
                    ${geomSql}
                    ${evidenceSql}
                    geometry_source = ${args.geometrySource},
                    source_license_status = ${args.sourceLicenseStatus},
                    verification_status = ${args.verificationStatus},
                    verification_note = ${args.verificationNote},
                    boundary_status = COALESCE(${args.boundaryStatus}, a.boundary_status),
                    is_active = ${args.isActive},
                    is_public_usable = ${args.isPublicUsable},
                    remediation_decision = ${args.remediationDecision},
                    is_verified = CASE WHEN ${args.markUnverified} THEN FALSE ELSE a.is_verified END,
                    updated_at = now()
                WHERE a.id = ${args.id}
                  AND a.deleted_at IS NULL
                  AND a.updated_at = ${args.expectedUpdatedAt}
                RETURNING
                    a.id,
                    a.public_id::text AS public_id,
                    a.canonical_name,
                    a.updated_at,
                    a.geometry_source,
                    a.source_license_status,
                    a.verification_status,
                    a.verification_note,
                    a.boundary_status,
                    a.is_active,
                    a.is_public_usable,
                    a.remediation_decision,
                    a.evidence,
                    ST_AsGeoJSON(a.geom)::json AS geom_geojson,
                    CASE
                        WHEN a.geom IS NULL OR ST_IsEmpty(a.geom) THEN NULL
                        ELSE ARRAY[
                            ST_XMin(a.geom::box2d)::float8,
                            ST_YMin(a.geom::box2d)::float8,
                            ST_XMax(a.geom::box2d)::float8,
                            ST_YMax(a.geom::box2d)::float8
                        ]
                    END AS bbox,
                    ST_AsGeoJSON(a.centroid)::json AS centroid
            `;

            const row = updated[0];
            if (!row) {
                return null;
            }

            const afterSnapshot = {
                id: row.id.toString(),
                public_id: row.public_id,
                canonical_name: row.canonical_name,
                geometry_source: row.geometry_source,
                source_license_status: row.source_license_status,
                verification_status: row.verification_status,
                remediation_decision: row.remediation_decision,
                is_public_usable: row.is_public_usable,
                updated_at: row.updated_at.toISOString(),
            };

            await tx.$executeRaw`
                INSERT INTO system.audit_logs (
                    actor_user_id,
                    action_type,
                    entity_type,
                    entity_id,
                    before_snapshot,
                    after_snapshot
                )
                VALUES (
                    ${args.actorUserId},
                    'admin_area_remediation_update',
                    'core_admin_areas',
                    ${args.id},
                    ${JSON.stringify(args.beforeSnapshot)}::jsonb,
                    ${JSON.stringify(afterSnapshot)}::jsonb
                )
            `;

            return { updated: row };
        });
    }

    /**
     * Resolve numeric id or public_id UUID for boundary-review routes.
     */
    async resolveAdminAreaId(publicIdOrId: string): Promise<bigint | null> {
        const lookup = resolveAdminAreaLookup(publicIdOrId);
        if (lookup.kind === "id" && lookup.id != null) {
            const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
                SELECT a.id
                FROM core.core_admin_areas AS a
                WHERE a.id = ${lookup.id}
                  AND a.deleted_at IS NULL
                LIMIT 1
            `;
            return rows[0]?.id ?? null;
        }
        const publicId = lookup.publicId!;
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT a.id
            FROM core.core_admin_areas AS a
            WHERE a.public_id = ${publicId}::uuid
              AND a.deleted_at IS NULL
            LIMIT 1
        `;
        return rows[0]?.id ?? null;
    }

    /**
     * Selected (full geom) + parent + same-level neighbours in selected bbox + margin.
     * Neighbours are simplified and capped — never nationwide GeoJSON.
     */
    async getBoundaryContext(adminAreaId: bigint): Promise<{
        selected: AdminAreaBoundaryContextMemberRow | null;
        parent: AdminAreaBoundaryContextMemberRow | null;
        neighbours: AdminAreaBoundaryContextMemberRow[];
        neighbour_truncated: boolean;
        bbox_margin_deg: number;
        neighbour_limit: number;
    } | null> {
        const selectedRows = await this.prisma.$queryRaw<AdminAreaBoundaryContextMemberRow[]>`
            SELECT
                a.id,
                a.public_id::text AS public_id,
                a.parent_id,
                a.canonical_name AS display_name,
                coalesce(t.code, al.code) AS type_code,
                al.code AS admin_level_code,
                a.admin_level_id,
                a.geometry_source,
                a.verification_status,
                CASE
                    WHEN a.geom IS NULL OR ST_IsEmpty(a.geom) THEN NULL
                    ELSE ST_AsGeoJSON(a.geom)::json
                END AS geometry,
                CASE
                    WHEN a.geom IS NULL OR ST_IsEmpty(a.geom) THEN NULL
                    ELSE ARRAY[
                        ST_XMin(a.geom::box2d)::float8,
                        ST_YMin(a.geom::box2d)::float8,
                        ST_XMax(a.geom::box2d)::float8,
                        ST_YMax(a.geom::box2d)::float8
                    ]
                END AS bbox
            FROM core.core_admin_areas AS a
            JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
            LEFT JOIN ref.ref_admin_area_types AS t ON t.id = a.admin_area_type_id
            WHERE a.id = ${adminAreaId}
              AND a.deleted_at IS NULL
            LIMIT 1
        `;
        const selected = selectedRows[0] ?? null;
        if (!selected) {
            return null;
        }

        let parent: AdminAreaBoundaryContextMemberRow | null = null;
        if (selected.parent_id != null) {
            const parentRows = await this.prisma.$queryRaw<AdminAreaBoundaryContextMemberRow[]>`
                SELECT
                    a.id,
                    a.public_id::text AS public_id,
                    a.parent_id,
                    a.canonical_name AS display_name,
                    coalesce(t.code, al.code) AS type_code,
                    al.code AS admin_level_code,
                    a.admin_level_id,
                    a.geometry_source,
                    a.verification_status,
                    CASE
                        WHEN a.geom IS NULL OR ST_IsEmpty(a.geom) THEN NULL
                        ELSE ST_AsGeoJSON(
                            ST_SimplifyPreserveTopology(a.geom, ${BOUNDARY_CONTEXT_NEIGHBOUR_SIMPLIFY_DEG})
                        )::json
                    END AS geometry,
                    CASE
                        WHEN a.geom IS NULL OR ST_IsEmpty(a.geom) THEN NULL
                        ELSE ARRAY[
                            ST_XMin(a.geom::box2d)::float8,
                            ST_YMin(a.geom::box2d)::float8,
                            ST_XMax(a.geom::box2d)::float8,
                            ST_YMax(a.geom::box2d)::float8
                        ]
                    END AS bbox
                FROM core.core_admin_areas AS a
                JOIN ref.ref_admin_levels AS al ON al.id = a.admin_level_id
                LEFT JOIN ref.ref_admin_area_types AS t ON t.id = a.admin_area_type_id
                WHERE a.id = ${selected.parent_id}
                  AND a.deleted_at IS NULL
                LIMIT 1
            `;
            parent = parentRows[0] ?? null;
        }

        const margin = BOUNDARY_CONTEXT_BBOX_MARGIN_DEG;
        const limit = BOUNDARY_CONTEXT_NEIGHBOUR_LIMIT;
        const simplify = BOUNDARY_CONTEXT_NEIGHBOUR_SIMPLIFY_DEG;

        // Fetch one extra row to detect truncation without a second count query.
        const neighbourRows = await this.prisma.$queryRaw<AdminAreaBoundaryContextMemberRow[]>`
            WITH sel AS (
                SELECT
                    a.id,
                    a.admin_level_id,
                    a.geom,
                    ST_Expand(a.geom::box2d, ${margin}) AS search_box
                FROM core.core_admin_areas AS a
                WHERE a.id = ${adminAreaId}
                  AND a.deleted_at IS NULL
                  AND a.geom IS NOT NULL
                  AND NOT ST_IsEmpty(a.geom)
            )
            SELECT
                n.id,
                n.public_id::text AS public_id,
                n.parent_id,
                n.canonical_name AS display_name,
                coalesce(t.code, al.code) AS type_code,
                al.code AS admin_level_code,
                n.admin_level_id,
                n.geometry_source,
                n.verification_status,
                ST_AsGeoJSON(
                    ST_SimplifyPreserveTopology(n.geom, ${simplify})
                )::json AS geometry,
                ARRAY[
                    ST_XMin(n.geom::box2d)::float8,
                    ST_YMin(n.geom::box2d)::float8,
                    ST_XMax(n.geom::box2d)::float8,
                    ST_YMax(n.geom::box2d)::float8
                ] AS bbox
            FROM core.core_admin_areas AS n
            JOIN sel ON TRUE
            JOIN ref.ref_admin_levels AS al ON al.id = n.admin_level_id
            LEFT JOIN ref.ref_admin_area_types AS t ON t.id = n.admin_area_type_id
            WHERE n.deleted_at IS NULL
              AND n.is_active IS TRUE
              AND n.id <> sel.id
              AND n.admin_level_id = sel.admin_level_id
              AND n.geom IS NOT NULL
              AND NOT ST_IsEmpty(n.geom)
              AND n.geom && sel.search_box
            ORDER BY ST_Distance(n.geom, sel.geom) ASC, n.id ASC
            LIMIT ${limit + 1}
        `;

        const truncated = neighbourRows.length > limit;
        const neighbours = truncated ? neighbourRows.slice(0, limit) : neighbourRows;

        return {
            selected,
            parent,
            neighbours,
            neighbour_truncated: truncated,
            bbox_margin_deg: margin,
            neighbour_limit: limit,
        };
    }

    /**
     * Draft geometry checks with PostGIS. Does not write. Gaps are not scored as errors.
     */
    async validateDraftGeometry(args: {
        adminAreaId: bigint;
        geojsonText: string;
    }): Promise<AdminAreaDraftGeometryValidationRow | null> {
        const margin = BOUNDARY_CONTEXT_BBOX_MARGIN_DEG;
        const limit = BOUNDARY_CONTEXT_NEIGHBOUR_LIMIT;
        const epsilonM2 = BOUNDARY_AREA_EPSILON_HA * 10_000;

        const rows = await this.prisma.$queryRaw<AdminAreaDraftGeometryValidationRow[]>`
            WITH inp AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(${args.geojsonText})::geometry, 4326) AS g_raw
            ),
            draft AS (
                SELECT
                    CASE
                        WHEN ST_GeometryType(g_raw) IN ('ST_Polygon', 'ST_MultiPolygon')
                            THEN g_raw
                        ELSE NULL
                    END AS geom
                FROM inp
            ),
            sel AS (
                SELECT
                    a.id,
                    a.parent_id,
                    a.admin_level_id
                FROM core.core_admin_areas AS a
                WHERE a.id = ${args.adminAreaId}
                  AND a.deleted_at IS NULL
                LIMIT 1
            ),
            parent_geom AS (
                SELECT p.geom
                FROM core.core_admin_areas AS p
                JOIN sel ON p.id = sel.parent_id
                WHERE p.deleted_at IS NULL
                  AND p.geom IS NOT NULL
                  AND NOT ST_IsEmpty(p.geom)
                LIMIT 1
            ),
            validity AS (
                SELECT
                    (SELECT geom FROM draft) IS NOT NULL AS allowed_type,
                    CASE
                        WHEN (SELECT geom FROM draft) IS NULL THEN FALSE
                        ELSE ST_IsValid((SELECT geom FROM draft))
                    END AS is_valid,
                    CASE
                        WHEN (SELECT geom FROM draft) IS NOT NULL
                             AND NOT ST_IsValid((SELECT geom FROM draft))
                            THEN ST_IsValidReason((SELECT geom FROM draft))
                        ELSE NULL
                    END AS invalid_reason,
                    CASE
                        WHEN (SELECT geom FROM draft) IS NULL THEN TRUE
                        ELSE ST_IsEmpty((SELECT geom FROM draft))
                    END AS is_empty
            ),
            outside AS (
                SELECT
                    CASE
                        WHEN (SELECT geom FROM draft) IS NULL
                             OR NOT (SELECT is_valid FROM validity)
                             OR (SELECT is_empty FROM validity)
                             OR NOT EXISTS (SELECT 1 FROM parent_geom)
                            THEN NULL
                        ELSE ST_Area(
                            ST_Difference(
                                (SELECT geom FROM draft),
                                (SELECT geom FROM parent_geom)
                            )::geography
                        )::double precision
                    END AS outside_m2,
                    CASE
                        WHEN (SELECT geom FROM draft) IS NULL
                             OR NOT (SELECT is_valid FROM validity)
                             OR (SELECT is_empty FROM validity)
                             OR NOT EXISTS (SELECT 1 FROM parent_geom)
                            THEN NULL
                        ELSE ST_AsGeoJSON(
                            ST_Difference(
                                (SELECT geom FROM draft),
                                (SELECT geom FROM parent_geom)
                            )
                        )::json
                    END AS outside_geojson
            ),
            neighbours AS (
                SELECT
                    n.id,
                    n.public_id::text AS public_id,
                    n.canonical_name AS display_name,
                    n.geom
                FROM core.core_admin_areas AS n
                JOIN sel ON TRUE
                CROSS JOIN draft
                WHERE draft.geom IS NOT NULL
                  AND (SELECT is_valid FROM validity)
                  AND NOT (SELECT is_empty FROM validity)
                  AND n.deleted_at IS NULL
                  AND n.is_active IS TRUE
                  AND n.id <> sel.id
                  AND n.admin_level_id = sel.admin_level_id
                  AND n.geom IS NOT NULL
                  AND NOT ST_IsEmpty(n.geom)
                  AND n.geom && ST_Expand(draft.geom::box2d, ${margin})
                ORDER BY ST_Distance(n.geom, draft.geom) ASC, n.id ASC
                LIMIT ${limit}
            ),
            overlaps AS (
                SELECT
                    n.public_id,
                    n.display_name,
                    ST_Area(ST_Intersection(draft.geom, n.geom)::geography)::double precision AS overlap_m2,
                    ST_AsGeoJSON(ST_Intersection(draft.geom, n.geom))::json AS overlap_geojson
                FROM neighbours AS n
                CROSS JOIN draft
                WHERE ST_Intersects(draft.geom, n.geom)
                  AND NOT ST_Touches(draft.geom, n.geom)
                  AND ST_Area(ST_Intersection(draft.geom, n.geom)::geography) > ${epsilonM2}
            ),
            touching AS (
                SELECT count(*)::int AS touching_count
                FROM neighbours AS n
                CROSS JOIN draft
                WHERE ST_Touches(draft.geom, n.geom)
                   OR (
                       ST_Intersects(draft.geom, n.geom)
                       AND ST_Area(ST_Intersection(draft.geom, n.geom)::geography) <= ${epsilonM2}
                   )
            )
            SELECT
                (SELECT allowed_type FROM validity) AS allowed_type,
                (SELECT is_valid FROM validity) AS is_valid,
                (SELECT invalid_reason FROM validity) AS invalid_reason,
                (SELECT is_empty FROM validity) AS is_empty,
                EXISTS (SELECT 1 FROM parent_geom) AS has_parent,
                (SELECT outside_m2 FROM outside) AS outside_parent_m2,
                (SELECT outside_geojson FROM outside) AS outside_parent_geojson,
                COALESCE(
                    (
                        SELECT json_agg(
                            json_build_object(
                                'public_id', o.public_id,
                                'display_name', o.display_name,
                                'overlap_m2', o.overlap_m2,
                                'overlap_geojson', o.overlap_geojson
                            )
                            ORDER BY o.overlap_m2 DESC
                        )
                        FROM overlaps AS o
                    ),
                    '[]'::json
                ) AS overlaps_json,
                (SELECT touching_count FROM touching) AS touching_neighbour_count
        `;

        return rows[0] ?? null;
    }
}

/** Statement timeout wrapper note: Prisma $queryRaw cannot SET LOCAL easily;
 * tile route relies on feature limit + bbox GiST filter. Timeout constant exported for docs/tests. */
export const ADMIN_AREA_MVT_TIMEOUT_MS = ADMIN_AREAS_MVT_STATEMENT_TIMEOUT_MS;
