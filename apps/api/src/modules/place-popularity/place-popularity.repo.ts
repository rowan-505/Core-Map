import { Prisma, type PrismaClient } from "@prisma/client";

import {
    PLACE_ACTIVITY_WINDOW_DAYS,
    type PlaceActivityCounts,
    type PlacePopularityContextKind,
} from "./place-popularity.weights.js";

export type PlaceActivityKind = "view" | "save" | "share" | "directions";

export type PlaceActivity30dRow = {
    placeId: bigint;
    views: number;
    saves: number;
    shares: number;
    directions: number;
};

const TOWNSHIP_LEVEL_CODES = ["township", "town"] as const;
const REGION_LEVEL_CODES = ["region", "state", "state_region", "division"] as const;

/**
 * Resolve containing township for a place.
 * Does NOT assume core_places.admin_area_id is already a township —
 * climbs parent_id using ref.ref_admin_levels codes.
 */
export const PLACE_TOWNSHIP_RESOLVE_SQL = Prisma.sql`
    WITH RECURSIVE chain AS (
        SELECT a.id, a.parent_id, 0 AS depth
        FROM core.core_admin_areas AS a
        WHERE a.id = p.admin_area_id
        UNION ALL
        SELECT parent.id, parent.parent_id, chain.depth + 1
        FROM core.core_admin_areas AS parent
        INNER JOIN chain ON parent.id = chain.parent_id
        WHERE chain.depth < 16
    )
    SELECT chain.id
    FROM chain
    INNER JOIN core.core_admin_areas AS aa ON aa.id = chain.id
    INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    WHERE lower(btrim(al.code)) IN (${Prisma.join([...TOWNSHIP_LEVEL_CODES])})
    ORDER BY chain.depth ASC
    LIMIT 1
`;

export const PLACE_REGION_RESOLVE_FROM_START_SQL = Prisma.sql`
    WITH RECURSIVE chain AS (
        SELECT a.id, a.parent_id, 0 AS depth
        FROM core.core_admin_areas AS a
        WHERE a.id = start_admin_area_id
        UNION ALL
        SELECT parent.id, parent.parent_id, chain.depth + 1
        FROM core.core_admin_areas AS parent
        INNER JOIN chain ON parent.id = chain.parent_id
        WHERE chain.depth < 16
    )
    SELECT chain.id
    FROM chain
    INNER JOIN core.core_admin_areas AS aa ON aa.id = chain.id
    INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
    WHERE lower(btrim(al.code)) IN (${Prisma.join([...REGION_LEVEL_CODES])})
    ORDER BY chain.depth ASC
    LIMIT 1
`;

/** Food & Drink ranking population — categories with ranking_group = food_drink. */
const foodDrinkCategoryIdsSql = Prisma.sql`
    SELECT id
    FROM ref.ref_poi_categories
    WHERE ranking_group = 'food_drink'
`;

export class PlacePopularityRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async incrementActivity(
        placeId: bigint,
        kind: PlaceActivityKind,
        delta = 1
    ): Promise<void> {
        if (delta <= 0) return;

        const views = kind === "view" ? delta : 0;
        const saves = kind === "save" ? delta : 0;
        const shares = kind === "share" ? delta : 0;
        const directions = kind === "directions" ? delta : 0;

        if (kind === "view") {
            await this.prisma.$executeRaw`
                INSERT INTO app.place_activity_daily AS d (
                    place_id, activity_date, view_count, save_count, share_count, directions_count, updated_at
                ) VALUES (
                    ${placeId}, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
                    ${views}, 0, 0, 0, now()
                )
                ON CONFLICT (place_id, activity_date) DO UPDATE
                SET view_count = d.view_count + EXCLUDED.view_count, updated_at = now()
            `;
            return;
        }
        if (kind === "save") {
            await this.prisma.$executeRaw`
                INSERT INTO app.place_activity_daily AS d (
                    place_id, activity_date, view_count, save_count, share_count, directions_count, updated_at
                ) VALUES (
                    ${placeId}, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
                    0, ${saves}, 0, 0, now()
                )
                ON CONFLICT (place_id, activity_date) DO UPDATE
                SET save_count = d.save_count + EXCLUDED.save_count, updated_at = now()
            `;
            return;
        }
        if (kind === "share") {
            await this.prisma.$executeRaw`
                INSERT INTO app.place_activity_daily AS d (
                    place_id, activity_date, view_count, save_count, share_count, directions_count, updated_at
                ) VALUES (
                    ${placeId}, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
                    0, 0, ${shares}, 0, now()
                )
                ON CONFLICT (place_id, activity_date) DO UPDATE
                SET share_count = d.share_count + EXCLUDED.share_count, updated_at = now()
            `;
            return;
        }

        await this.prisma.$executeRaw`
            INSERT INTO app.place_activity_daily AS d (
                place_id, activity_date, view_count, save_count, share_count, directions_count, updated_at
            ) VALUES (
                ${placeId}, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
                0, 0, 0, ${directions}, now()
            )
            ON CONFLICT (place_id, activity_date) DO UPDATE
            SET directions_count = d.directions_count + EXCLUDED.directions_count, updated_at = now()
        `;
    }

    async findPlaceIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
            SELECT id
            FROM core.core_places
            WHERE public_id = ${publicId}::uuid
              AND deleted_at IS NULL
            LIMIT 1
        `;
        return rows[0]?.id ?? null;
    }

    async resolveTownshipAdminAreaIdForPlace(placeId: bigint): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<Array<{ township_id: bigint | null }>>`
            SELECT (${PLACE_TOWNSHIP_RESOLVE_SQL}) AS township_id
            FROM core.core_places AS p
            WHERE p.id = ${placeId}
            LIMIT 1
        `;
        return rows[0]?.township_id ?? null;
    }

    async resolveRegionAdminAreaIdForPlace(placeId: bigint): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<Array<{ region_id: bigint | null }>>`
            SELECT (
                WITH start_point AS (
                    SELECT COALESCE(
                        (${PLACE_TOWNSHIP_RESOLVE_SQL}),
                        p.admin_area_id
                    ) AS start_admin_area_id
                    FROM core.core_places AS p
                    WHERE p.id = ${placeId}
                    LIMIT 1
                )
                SELECT (${PLACE_REGION_RESOLVE_FROM_START_SQL})
                FROM start_point
                WHERE start_admin_area_id IS NOT NULL
            ) AS region_id
        `;
        return rows[0]?.region_id ?? null;
    }

    async listActivity30dForContext(input: {
        kind: PlacePopularityContextKind;
        townshipAdminAreaId?: bigint | null;
        regionAdminAreaId?: bigint | null;
    }): Promise<PlaceActivity30dRow[]> {
        const sinceDays = PLACE_ACTIVITY_WINDOW_DAYS - 1;

        if (input.kind === "tourism_national") {
            return this.prisma.$queryRaw<PlaceActivity30dRow[]>`
                SELECT
                    p.id AS "placeId",
                    COALESCE(SUM(d.view_count), 0)::int AS views,
                    COALESCE(SUM(d.save_count), 0)::int AS saves,
                    COALESCE(SUM(d.share_count), 0)::int AS shares,
                    COALESCE(SUM(d.directions_count), 0)::int AS directions
                FROM tourism.place_profiles AS tp
                INNER JOIN core.core_places AS p ON p.id = tp.place_id
                LEFT JOIN app.place_activity_daily AS d
                    ON d.place_id = p.id
                   AND d.activity_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
                       - CAST(${sinceDays} AS integer)
                WHERE tp.is_public IS TRUE
                  AND p.is_public IS TRUE
                  AND p.deleted_at IS NULL
                GROUP BY p.id
            `;
        }

        if (input.kind === "tourism_township") {
            if (input.townshipAdminAreaId == null) return [];
            return this.prisma.$queryRaw<PlaceActivity30dRow[]>`
                SELECT
                    p.id AS "placeId",
                    COALESCE(SUM(d.view_count), 0)::int AS views,
                    COALESCE(SUM(d.save_count), 0)::int AS saves,
                    COALESCE(SUM(d.share_count), 0)::int AS shares,
                    COALESCE(SUM(d.directions_count), 0)::int AS directions
                FROM tourism.place_profiles AS tp
                INNER JOIN core.core_places AS p ON p.id = tp.place_id
                LEFT JOIN app.place_activity_daily AS d
                    ON d.place_id = p.id
                   AND d.activity_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
                       - CAST(${sinceDays} AS integer)
                WHERE tp.is_public IS TRUE
                  AND p.is_public IS TRUE
                  AND p.deleted_at IS NULL
                  AND (${PLACE_TOWNSHIP_RESOLVE_SQL}) = ${input.townshipAdminAreaId}
                GROUP BY p.id
            `;
        }

        if (input.kind === "tourism_region") {
            if (input.regionAdminAreaId == null) return [];
            return this.prisma.$queryRaw<PlaceActivity30dRow[]>`
                SELECT
                    p.id AS "placeId",
                    COALESCE(SUM(d.view_count), 0)::int AS views,
                    COALESCE(SUM(d.save_count), 0)::int AS saves,
                    COALESCE(SUM(d.share_count), 0)::int AS shares,
                    COALESCE(SUM(d.directions_count), 0)::int AS directions
                FROM tourism.place_profiles AS tp
                INNER JOIN core.core_places AS p ON p.id = tp.place_id
                LEFT JOIN app.place_activity_daily AS d
                    ON d.place_id = p.id
                   AND d.activity_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
                       - CAST(${sinceDays} AS integer)
                WHERE tp.is_public IS TRUE
                  AND p.is_public IS TRUE
                  AND p.deleted_at IS NULL
                  AND (
                      WITH start_point AS (
                          SELECT COALESCE(
                              (${PLACE_TOWNSHIP_RESOLVE_SQL}),
                              p.admin_area_id
                          ) AS start_admin_area_id
                      )
                      SELECT (${PLACE_REGION_RESOLVE_FROM_START_SQL})
                      FROM start_point
                      WHERE start_admin_area_id IS NOT NULL
                  ) = ${input.regionAdminAreaId}
                GROUP BY p.id
            `;
        }

        if (input.townshipAdminAreaId == null) return [];
        return this.prisma.$queryRaw<PlaceActivity30dRow[]>`
            SELECT
                p.id AS "placeId",
                COALESCE(SUM(d.view_count), 0)::int AS views,
                COALESCE(SUM(d.save_count), 0)::int AS saves,
                COALESCE(SUM(d.share_count), 0)::int AS shares,
                COALESCE(SUM(d.directions_count), 0)::int AS directions
            FROM core.core_places AS p
            LEFT JOIN app.place_activity_daily AS d
                ON d.place_id = p.id
               AND d.activity_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
                       - CAST(${sinceDays} AS integer)
            WHERE p.is_public IS TRUE
              AND p.deleted_at IS NULL
              AND p.category_id IN (${foodDrinkCategoryIdsSql})
              AND (${PLACE_TOWNSHIP_RESOLVE_SQL}) = ${input.townshipAdminAreaId}
            GROUP BY p.id
        `;
    }

    toCounts(row: PlaceActivity30dRow): PlaceActivityCounts {
        return {
            views: row.views,
            saves: row.saves,
            shares: row.shares,
            directions: row.directions,
        };
    }
}
