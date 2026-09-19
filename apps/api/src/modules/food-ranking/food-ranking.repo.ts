import { Prisma, type PrismaClient } from "@prisma/client";

import { PLACE_TOWNSHIP_RESOLVE_SQL } from "../place-popularity/place-popularity.repo.js";
import { FOOD_DRINK_RANKING_GROUP } from "./food-ranking.js";

export type FoodDrinkRankingCandidateRow = {
    placeId: bigint;
    publicId: string;
    displayName: string | null;
    primaryName: string | null;
    nameMm: string | null;
    nameEn: string | null;
    lat: number;
    lng: number;
    importanceScore: number | null;
    categoryCode: string;
    categoryName: string;
    categoryNameMm: string | null;
    publishedReviewCount: number;
    averageRating: number | null;
};

export class FoodRankingRepository {
    constructor(private readonly prisma: PrismaClient) {}

    /**
     * Eligible places: public, not deleted, category.ranking_group = food_drink,
     * resolved township matches request.
     */
    async listTownshipCandidates(
        townshipAdminAreaId: bigint
    ): Promise<FoodDrinkRankingCandidateRow[]> {
        return this.prisma.$queryRaw<FoodDrinkRankingCandidateRow[]>`
            SELECT
                p.id AS "placeId",
                p.public_id::text AS "publicId",
                p.display_name AS "displayName",
                p.primary_name AS "primaryName",
                name_mm.name AS "nameMm",
                name_en.name AS "nameEn",
                p.lat,
                p.lng,
                p.importance_score::float8 AS "importanceScore",
                c.code AS "categoryCode",
                c.name AS "categoryName",
                c.name_mm AS "categoryNameMm",
                COALESCE(s.published_review_count, 0)::int AS "publishedReviewCount",
                s.average_rating::float8 AS "averageRating"
            FROM core.core_places AS p
            INNER JOIN ref.ref_poi_categories AS c ON c.id = p.category_id
            LEFT JOIN community.place_rating_summaries AS s ON s.place_id = p.id
            ${foodPlaceNameMmLateralSql()}
            ${foodPlaceNameEnLateralSql()}
            WHERE p.is_public IS TRUE
              AND p.deleted_at IS NULL
              AND c.ranking_group = ${FOOD_DRINK_RANKING_GROUP}
              AND (${PLACE_TOWNSHIP_RESOLVE_SQL}) = ${townshipAdminAreaId}
        `;
    }

    async findTownshipLabel(townshipAdminAreaId: bigint): Promise<{
        id: string;
        name: string;
        nameMm: string | null;
        nameEn: string | null;
    } | null> {
        const rows = await this.prisma.$queryRaw<
            Array<{
                id: bigint;
                canonicalName: string;
                nameMm: string | null;
                nameEn: string | null;
            }>
        >`
            SELECT
                a.id,
                a.canonical_name AS "canonicalName",
                an_mm.name AS "nameMm",
                an_en.name AS "nameEn"
            FROM core.core_admin_areas AS a
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = a.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) = 'my'
                      OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
                  )
                ORDER BY
                    CASE
                        WHEN n.name_type = 'official' AND n.is_primary = true THEN 1
                        WHEN n.is_primary = true THEN 2
                        WHEN n.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    n.search_weight DESC NULLS LAST,
                    n.name ASC
                LIMIT 1
            ) AS an_mm ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = a.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) = 'en'
                      OR upper(trim(coalesce(n.script_code, ''))) = 'LATN'
                  )
                ORDER BY
                    CASE
                        WHEN n.name_type = 'official' AND n.is_primary = true THEN 1
                        WHEN n.is_primary = true THEN 2
                        WHEN n.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    n.search_weight DESC NULLS LAST,
                    n.name ASC
                LIMIT 1
            ) AS an_en ON true
            WHERE a.id = ${townshipAdminAreaId}
            LIMIT 1
        `;
        const row = rows[0];
        if (!row) return null;
        return {
            id: String(row.id),
            name: row.canonicalName,
            nameMm: row.nameMm,
            nameEn: row.nameEn,
        };
    }
}

function foodPlaceNameMmLateralSql() {
    return Prisma.sql`
        LEFT JOIN LATERAL (
            SELECT pn.name
            FROM core.core_place_names AS pn
            WHERE pn.place_id = p.id
              AND (
                  pn.language_code = 'my'
                  OR upper(trim(coalesce(pn.script_code, ''))) = 'MYMR'
              )
            ORDER BY
                CASE
                    WHEN pn.name_type = 'official' AND pn.is_primary = true THEN 1
                    WHEN pn.is_primary = true THEN 2
                    WHEN pn.name_type = 'official' THEN 3
                    ELSE 4
                END,
                pn.search_weight DESC NULLS LAST,
                pn.name ASC
            LIMIT 1
        ) AS name_mm ON true
    `;
}

function foodPlaceNameEnLateralSql() {
    return Prisma.sql`
        LEFT JOIN LATERAL (
            SELECT pn.name
            FROM core.core_place_names AS pn
            WHERE pn.place_id = p.id
              AND (
                  pn.language_code = 'en'
                  OR upper(trim(coalesce(pn.script_code, ''))) = 'LATN'
              )
            ORDER BY
                CASE
                    WHEN pn.name_type = 'official' AND pn.is_primary = true THEN 1
                    WHEN pn.is_primary = true THEN 2
                    WHEN pn.name_type = 'official' THEN 3
                    ELSE 4
                END,
                pn.search_weight DESC NULLS LAST,
                pn.name ASC
            LIMIT 1
        ) AS name_en ON true
    `;
}
