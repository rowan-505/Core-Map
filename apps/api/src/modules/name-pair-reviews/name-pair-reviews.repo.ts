import { Prisma, type PrismaClient } from "@prisma/client";

import type {
    ListNamePairGapsQuery,
    ListNamePairReviewsQuery,
} from "./name-pair-reviews.schema.js";

export type NamePairReviewRow = {
    id: bigint;
    public_id: string;
    entity_type: string;
    entity_id: bigint;
    entity_public_id: string | null;
    direction: string;
    source_name: string;
    proposed_mm: string | null;
    proposed_en: string | null;
    confidence: number;
    reason: string;
    status: string;
    fill_run_id: string | null;
    reviewed_by: bigint | null;
    reviewed_at: Date | null;
    review_note: string | null;
    created_at: Date;
    updated_at: Date;
};

export type NamePairGapRow = {
    entity_type: string;
    entity_id: bigint;
    entity_public_id: string | null;
    source_name: string;
    name_mm: string | null;
    name_en: string | null;
    gap_reason: string;
};

export type EntityCountRow = {
    entity_type: string;
    count: bigint;
};

export type GapStatsCache = {
    computed_at: string;
    complete?: boolean;
    remain_non_street: { total: number; by_entity: Record<string, number> };
    remain_minor_streets: { total: number; by_entity: Record<string, number> };
};

/** Stable fill_runs row that caches expensive remain bucket totals for the dashboard. */
export const GAP_STATS_RUN_ID = "name-pair-gap-stats";

const selectSql = Prisma.sql`
    SELECT
        id,
        public_id::text AS public_id,
        entity_type,
        entity_id,
        entity_public_id::text AS entity_public_id,
        direction,
        source_name,
        proposed_mm,
        proposed_en,
        confidence,
        reason,
        status,
        fill_run_id,
        reviewed_by,
        reviewed_at,
        review_note,
        created_at,
        updated_at
    FROM ops.name_pair_reviews
`;

export class NamePairReviewsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async list(filters: ListNamePairReviewsQuery): Promise<{
        items: NamePairReviewRow[];
        total: number;
    }> {
        const conditions: Prisma.Sql[] = [Prisma.sql`status = ${filters.status}`];
        if (filters.entity_type) {
            conditions.push(Prisma.sql`entity_type = ${filters.entity_type}`);
        }
        if (filters.reason) {
            conditions.push(Prisma.sql`reason = ${filters.reason}`);
        } else if (filters.exclude_reason) {
            conditions.push(Prisma.sql`reason IS DISTINCT FROM ${filters.exclude_reason}`);
        }
        if (filters.q) {
            const term = `%${filters.q}%`;
            conditions.push(
                Prisma.sql`(
                    source_name ILIKE ${term}
                    OR coalesce(proposed_mm, '') ILIKE ${term}
                    OR coalesce(proposed_en, '') ILIKE ${term}
                    OR reason ILIKE ${term}
                )`,
            );
        }
        const where = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;

        const [countRows, items] = await Promise.all([
            this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
                SELECT count(*)::bigint AS count
                FROM ops.name_pair_reviews
                ${where}
            `),
            this.prisma.$queryRaw<NamePairReviewRow[]>(Prisma.sql`
                ${selectSql}
                ${where}
                ORDER BY created_at DESC, id DESC
                LIMIT ${filters.limit}
                OFFSET ${filters.offset}
            `),
        ]);

        return {
            items,
            total: Number(countRows[0]?.count ?? 0n),
        };
    }

    async getByPublicId(publicId: string): Promise<NamePairReviewRow | null> {
        const rows = await this.prisma.$queryRaw<NamePairReviewRow[]>(Prisma.sql`
            ${selectSql}
            WHERE public_id = ${publicId}::uuid
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async markStatus(args: {
        publicId: string;
        status: "approved" | "rejected" | "skipped";
        actorUserId: bigint;
        reviewNote: string | null;
        proposedMm?: string | null;
        proposedEn?: string | null;
    }): Promise<NamePairReviewRow | null> {
        const rows = await this.prisma.$queryRaw<NamePairReviewRow[]>(Prisma.sql`
            UPDATE ops.name_pair_reviews
            SET
                status = ${args.status},
                reviewed_by = ${args.actorUserId},
                reviewed_at = now(),
                review_note = ${args.reviewNote},
                proposed_mm = COALESCE(${args.proposedMm ?? null}, proposed_mm),
                proposed_en = COALESCE(${args.proposedEn ?? null}, proposed_en),
                updated_at = now()
            WHERE public_id = ${args.publicId}::uuid
              AND status = 'pending'
            RETURNING
                id,
                public_id::text AS public_id,
                entity_type,
                entity_id,
                entity_public_id::text AS entity_public_id,
                direction,
                source_name,
                proposed_mm,
                proposed_en,
                confidence,
                reason,
                status,
                fill_run_id,
                reviewed_by,
                reviewed_at,
                review_note,
                created_at,
                updated_at
        `);
        return rows[0] ?? null;
    }

    async approveAndApply(args: {
        publicId: string;
        actorUserId: bigint;
        reviewNote: string | null;
        proposedMm: string | null;
        proposedEn: string | null;
    }): Promise<NamePairReviewRow | null> {
        return this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<NamePairReviewRow[]>(Prisma.sql`
                UPDATE ops.name_pair_reviews
                SET
                    status = 'approved',
                    reviewed_by = ${args.actorUserId},
                    reviewed_at = now(),
                    review_note = ${args.reviewNote},
                    proposed_mm = ${args.proposedMm},
                    proposed_en = ${args.proposedEn},
                    updated_at = now()
                WHERE public_id = ${args.publicId}::uuid
                  AND status = 'pending'
                RETURNING
                    id,
                    public_id::text AS public_id,
                    entity_type,
                    entity_id,
                    entity_public_id::text AS entity_public_id,
                    direction,
                    source_name,
                    proposed_mm,
                    proposed_en,
                    confidence,
                    reason,
                    status,
                    fill_run_id,
                    reviewed_by,
                    reviewed_at,
                    review_note,
                    created_at,
                    updated_at
            `);
            const updated = rows[0];
            if (!updated) return null;

            await this.applyApprovedNamesWithClient(tx, updated);
            return updated;
        });
    }

    async applyApprovedNames(row: NamePairReviewRow): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            await this.applyApprovedNamesWithClient(tx, row);
        });
    }

    private async applyApprovedNamesWithClient(
        tx: Prisma.TransactionClient,
        row: NamePairReviewRow,
    ): Promise<void> {
        const mm = row.proposed_mm?.trim() || null;
        const en = row.proposed_en?.trim() || null;
        const entityId = row.entity_id;
        const forceOverwrite =
            row.reason === "auto_applied_needs_review" ||
            row.direction === "review_auto_applied";

        switch (row.entity_type) {
            case "settlement":
                if (mm) {
                    if (forceOverwrite) {
                        await tx.$executeRaw(Prisma.sql`
                            UPDATE core.core_settlements
                            SET name_mm = ${mm}, updated_at = now()
                            WHERE id = ${entityId}
                        `);
                    } else {
                        await tx.$executeRaw(Prisma.sql`
                            UPDATE core.core_settlements
                            SET name_mm = coalesce(nullif(btrim(name_mm), ''), ${mm}),
                                updated_at = now()
                            WHERE id = ${entityId}
                              AND (name_mm IS NULL OR btrim(name_mm) = '')
                        `);
                    }
                }
                if (en) {
                    if (forceOverwrite) {
                        await tx.$executeRaw(Prisma.sql`
                            UPDATE core.core_settlements
                            SET name_en = ${en}, updated_at = now()
                            WHERE id = ${entityId}
                        `);
                    } else {
                        await tx.$executeRaw(Prisma.sql`
                            UPDATE core.core_settlements
                            SET name_en = coalesce(nullif(btrim(name_en), ''), ${en}),
                                updated_at = now()
                            WHERE id = ${entityId}
                              AND (name_en IS NULL OR btrim(name_en) = '')
                        `);
                    }
                }
                break;
            case "transport_stop":
                if (mm) {
                    await tx.$executeRaw(Prisma.sql`
                        UPDATE transport.stops
                        SET name_mm = coalesce(nullif(btrim(name_mm), ''), ${mm}),
                            updated_at = now()
                        WHERE id = ${entityId}
                          AND (name_mm IS NULL OR btrim(name_mm) = '')
                    `);
                }
                if (en) {
                    await tx.$executeRaw(Prisma.sql`
                        UPDATE transport.stops
                        SET name_en = coalesce(nullif(btrim(name_en), ''), ${en}),
                            updated_at = now()
                        WHERE id = ${entityId}
                          AND (name_en IS NULL OR btrim(name_en) = '')
                    `);
                }
                break;
            case "transport_terminal":
                if (mm) {
                    await tx.$executeRaw(Prisma.sql`
                        UPDATE transport.terminals
                        SET name_mm = coalesce(nullif(btrim(name_mm), ''), ${mm}),
                            updated_at = now()
                        WHERE id = ${entityId}
                          AND (name_mm IS NULL OR btrim(name_mm) = '')
                    `);
                }
                if (en) {
                    await tx.$executeRaw(Prisma.sql`
                        UPDATE transport.terminals
                        SET name_en = coalesce(nullif(btrim(name_en), ''), ${en}),
                            updated_at = now()
                        WHERE id = ${entityId}
                          AND (name_en IS NULL OR btrim(name_en) = '')
                    `);
                }
                break;
            case "place":
                await this.insertLanguageName(tx, "core.core_place_names", "place_id", entityId, mm, en);
                break;
            case "admin_area":
                await this.insertLanguageName(
                    tx,
                    "core.core_admin_area_names",
                    "admin_area_id",
                    entityId,
                    mm,
                    en,
                );
                break;
            case "street":
                await this.insertLanguageName(
                    tx,
                    "core.core_street_names",
                    "street_id",
                    entityId,
                    mm,
                    en,
                    false,
                );
                break;
            case "building":
                await this.insertLanguageName(
                    tx,
                    "core.core_building_names",
                    "building_id",
                    entityId,
                    mm,
                    en,
                );
                break;
            default:
                throw new Error(`Unsupported entity_type ${row.entity_type}`);
        }

        await tx.$executeRaw(Prisma.sql`
            INSERT INTO system.audit_logs (
                actor_user_id,
                action_type,
                entity_type,
                entity_id,
                before_snapshot,
                after_snapshot
            )
            VALUES (
                ${row.reviewed_by},
                'name_pair_review_approve',
                ${row.entity_type},
                ${entityId},
                ${JSON.stringify({
                    source_name: row.source_name,
                    direction: row.direction,
                })}::jsonb,
                ${JSON.stringify({
                    proposed_mm: mm,
                    proposed_en: en,
                    review_public_id: row.public_id,
                })}::jsonb
            )
        `);
    }

    private async insertLanguageName(
        tx: Prisma.TransactionClient,
        table: string,
        fk: string,
        entityId: bigint,
        mm: string | null,
        en: string | null,
        withSearchWeight = true,
    ): Promise<void> {
        if (mm) {
            await this.insertOne(tx, table, fk, entityId, mm, "my", "Mymr", withSearchWeight);
        }
        if (en) {
            await this.insertOne(tx, table, fk, entityId, en, "en", "Latn", withSearchWeight);
        }
    }

    private async insertOne(
        tx: Prisma.TransactionClient,
        table: string,
        fk: string,
        entityId: bigint,
        name: string,
        languageCode: string,
        scriptCode: string,
        withSearchWeight: boolean,
    ): Promise<void> {
        // Table/fk are internal constants only — never user input.
        // Prefer updating an existing AI transliteration row so dashboard edits stick.
        const updated = await tx.$executeRawUnsafe(
            `
            UPDATE ${table}
            SET name = $2,
                language_code = $3,
                script_code = $4,
                name_type = 'transliteration',
                is_primary = false
            WHERE ${fk} = $1
              AND name_type = 'transliteration'
              AND (
                  language_code = $3
                  OR upper(trim(coalesce(script_code, ''))) = upper($4)
              )
            `,
            entityId,
            name,
            languageCode,
            scriptCode,
        );
        if (typeof updated === "number" && updated > 0) return;

        if (withSearchWeight) {
            await tx.$executeRawUnsafe(
                `
                INSERT INTO ${table} (
                    ${fk}, name, language_code, script_code, name_type, is_primary, search_weight
                )
                SELECT $1, $2, $3, $4, 'transliteration', false, 70
                WHERE NOT EXISTS (
                    SELECT 1 FROM ${table} n
                    WHERE n.${fk} = $1
                      AND (
                          n.language_code = $3
                          OR upper(trim(coalesce(n.script_code, ''))) = upper($4)
                      )
                      AND nullif(btrim(n.name), '') IS NOT NULL
                )
                `,
                entityId,
                name,
                languageCode,
                scriptCode,
            );
        } else {
            await tx.$executeRawUnsafe(
                `
                INSERT INTO ${table} (
                    ${fk}, name, language_code, script_code, name_type, is_primary
                )
                SELECT $1, $2, $3, $4, 'transliteration', false
                WHERE NOT EXISTS (
                    SELECT 1 FROM ${table} n
                    WHERE n.${fk} = $1
                      AND (
                          n.language_code = $3
                          OR upper(trim(coalesce(n.script_code, ''))) = upper($4)
                      )
                      AND nullif(btrim(n.name), '') IS NOT NULL
                )
                `,
                entityId,
                name,
                languageCode,
                scriptCode,
            );
        }
    }

    /**
     * Remove AI/auto transliteration rows when a re-queued review is rejected.
     */
    async deleteTransliterationNames(row: NamePairReviewRow): Promise<void> {
        const entityId = row.entity_id;
        switch (row.entity_type) {
            case "place":
                await this.prisma.$executeRaw(Prisma.sql`
                    DELETE FROM core.core_place_names
                    WHERE place_id = ${entityId}
                      AND name_type = 'transliteration'
                `);
                break;
            case "admin_area":
                await this.prisma.$executeRaw(Prisma.sql`
                    DELETE FROM core.core_admin_area_names
                    WHERE admin_area_id = ${entityId}
                      AND name_type = 'transliteration'
                `);
                break;
            case "street":
                await this.prisma.$executeRaw(Prisma.sql`
                    DELETE FROM core.core_street_names
                    WHERE street_id = ${entityId}
                      AND name_type = 'transliteration'
                `);
                break;
            case "building":
                await this.prisma.$executeRaw(Prisma.sql`
                    DELETE FROM core.core_building_names
                    WHERE building_id = ${entityId}
                      AND name_type = 'transliteration'
                `);
                break;
            case "settlement":
                // Settlement auto-fill wrote name_en from romanization; clear only that side.
                if (row.proposed_en) {
                    await this.prisma.$executeRaw(Prisma.sql`
                        UPDATE core.core_settlements
                        SET name_en = NULL, updated_at = now()
                        WHERE id = ${entityId}
                          AND btrim(coalesce(name_en, '')) = btrim(${row.proposed_en})
                    `);
                }
                break;
            default:
                break;
        }

        await this.prisma.$executeRaw(Prisma.sql`
            INSERT INTO system.audit_logs (
                actor_user_id,
                action_type,
                entity_type,
                entity_id,
                before_snapshot,
                after_snapshot
            )
            VALUES (
                ${row.reviewed_by},
                'name_pair_review_reject_remove_transliteration',
                ${row.entity_type},
                ${entityId},
                ${JSON.stringify({
                    source_name: row.source_name,
                    proposed_mm: row.proposed_mm,
                    proposed_en: row.proposed_en,
                    reason: row.reason,
                })}::jsonb,
                ${JSON.stringify({
                    review_public_id: row.public_id,
                    removed: true,
                })}::jsonb
            )
        `);
    }

    async summarizeReview(): Promise<{
        total: number;
        by_entity: Record<string, number>;
        auto_applied: { total: number; by_entity: Record<string, number> };
        other: { total: number; by_entity: Record<string, number> };
    }> {
        const reviewByEntity = toCountMap(await this.countPendingReviewsByEntity());
        const autoByEntity = toCountMap(
            await this.countPendingReviewsByEntity("auto_applied_needs_review"),
        );
        const otherByEntity: Record<string, number> = {};
        for (const [entity, count] of Object.entries(reviewByEntity)) {
            const auto = autoByEntity[entity] ?? 0;
            const rest = count - auto;
            if (rest > 0) otherByEntity[entity] = rest;
        }
        const total = Object.values(reviewByEntity).reduce((a, b) => a + b, 0);
        const autoTotal = Object.values(autoByEntity).reduce((a, b) => a + b, 0);
        return {
            total,
            by_entity: reviewByEntity,
            auto_applied: { total: autoTotal, by_entity: autoByEntity },
            other: {
                total: total - autoTotal,
                by_entity: otherByEntity,
            },
        };
    }

    private async countPendingReviewsByEntity(
        reason?: string,
    ): Promise<EntityCountRow[]> {
        if (reason) {
            return this.prisma.$queryRaw<EntityCountRow[]>(Prisma.sql`
                SELECT entity_type, count(*)::bigint AS count
                FROM ops.name_pair_reviews
                WHERE status = 'pending'
                  AND reason = ${reason}
                GROUP BY entity_type
            `);
        }
        return this.prisma.$queryRaw<EntityCountRow[]>(Prisma.sql`
            SELECT entity_type, count(*)::bigint AS count
            FROM ops.name_pair_reviews
            WHERE status = 'pending'
            GROUP BY entity_type
        `);
    }

    /**
     * Fast remain counts for summary cards (no full place/street scans).
     * Place + street come from cache when available.
     */
    async countCheapRemainNonStreet(): Promise<Record<string, number>> {
        const settlement = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM core.core_settlements
            WHERE nullif(btrim(name_mm), '') IS NULL
              AND nullif(btrim(name_en), '') IS NULL
        `);
        const admin = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM core.core_admin_areas a
            WHERE a.is_active = true
              AND NOT EXISTS (
                  SELECT 1 FROM core.core_admin_area_names n
                  WHERE n.admin_area_id = a.id
                    AND (n.language_code IN ('my','mm') OR n.name ~ '[\\u1000-\\u109F]')
              )
              AND NOT EXISTS (
                  SELECT 1 FROM core.core_admin_area_names n
                  WHERE n.admin_area_id = a.id
                    AND (
                        n.language_code = 'en'
                        OR (n.name ~ '[A-Za-z]' AND n.name !~ '[\\u1000-\\u109F]')
                    )
              )
        `);
        const building = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM (
                SELECT
                    building_id,
                    coalesce(
                        bool_or(
                            language_code IN ('my','mm') OR name ~ '[\\u1000-\\u109F]'
                        ),
                        false
                    ) AS has_mm,
                    coalesce(
                        bool_or(
                            language_code = 'en'
                            OR (name ~ '[A-Za-z]' AND name !~ '[\\u1000-\\u109F]')
                        ),
                        false
                    ) AS has_en
                FROM core.core_building_names
                GROUP BY building_id
            ) b
            JOIN core.core_buildings bld
              ON bld.id = b.building_id AND bld.deleted_at IS NULL
            WHERE (has_en AND NOT has_mm AND coalesce(bld.is_verified, false) IS FALSE)
               OR (NOT has_mm AND NOT has_en)
        `);
        const stop = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM transport.stops
            WHERE deleted_at IS NULL AND is_active = true
              AND (
                (
                    nullif(btrim(name_en), '') IS NOT NULL
                    AND nullif(btrim(name_mm), '') IS NULL
                    AND lower(coalesce(stop_type, '')) NOT IN (
                        'station', 'terminal', 'ferry_terminal'
                    )
                )
                OR (
                    nullif(btrim(name_mm), '') IS NULL
                    AND nullif(btrim(name_en), '') IS NULL
                )
              )
        `);
        const terminal = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM transport.terminals
            WHERE deleted_at IS NULL AND is_active = true
              AND nullif(btrim(name_mm), '') IS NULL
              AND nullif(btrim(name_en), '') IS NULL
        `);

        return {
            settlement: Number(settlement[0]?.count ?? 0n),
            admin_area: Number(admin[0]?.count ?? 0n),
            building: Number(building[0]?.count ?? 0n),
            transport_stop: Number(stop[0]?.count ?? 0n),
            transport_terminal: Number(terminal[0]?.count ?? 0n),
        };
    }

    async readGapStatsCache(): Promise<GapStatsCache | null> {
        const rows = await this.prisma.$queryRaw<
            { summary: GapStatsCache; finished_at: Date | null }[]
        >(Prisma.sql`
            SELECT summary, finished_at
            FROM ops.name_pair_fill_runs
            WHERE run_id = ${GAP_STATS_RUN_ID}
            LIMIT 1
        `);
        const row = rows[0];
        if (!row?.summary?.remain_non_street || !row.summary?.remain_minor_streets) {
            return null;
        }
        if (!row.summary.computed_at) {
            return null;
        }
        return row.summary;
    }

    async writeGapStatsCache(stats: GapStatsCache): Promise<void> {
        await this.prisma.$executeRaw(Prisma.sql`
            INSERT INTO ops.name_pair_fill_runs (run_id, dry_run, started_at, finished_at, summary)
            VALUES (
                ${GAP_STATS_RUN_ID},
                true,
                now(),
                now(),
                ${JSON.stringify(stats)}::jsonb
            )
            ON CONFLICT (run_id) DO UPDATE
            SET
                finished_at = now(),
                summary = EXCLUDED.summary
        `);
    }

    /**
     * Progressive remain stats. Writes cache after each step so the UI can show
     * cheap totals quickly; place/street use id-chunked scans to avoid timeouts.
     */
    async computeAndStoreGapStats(): Promise<GapStatsCache> {
        const existing = (await this.readGapStatsCache()) ?? {
            computed_at: new Date().toISOString(),
            complete: false,
            remain_non_street: { total: 0, by_entity: {} },
            remain_minor_streets: { total: 0, by_entity: { street: 0 } },
        };

        const cheap = await this.countCheapRemainNonStreet();
        const byEntity: Record<string, number> = {
            ...existing.remain_non_street.by_entity,
            ...cheap,
        };

        let stats: GapStatsCache = {
            computed_at: new Date().toISOString(),
            complete: false,
            remain_non_street: {
                total: Object.values(byEntity).reduce((a, b) => a + b, 0),
                by_entity: byEntity,
            },
            remain_minor_streets: existing.remain_minor_streets,
        };
        await this.writeGapStatsCache(stats);

        const placeCount = await this.countRemainPlacesChunked();
        byEntity.place = placeCount;
        stats = {
            computed_at: new Date().toISOString(),
            complete: false,
            remain_non_street: {
                total: Object.values(byEntity).reduce((a, b) => a + b, 0),
                by_entity: { ...byEntity },
            },
            remain_minor_streets: stats.remain_minor_streets,
        };
        await this.writeGapStatsCache(stats);

        const streetCount = await this.countMinorLatinStreetsChunked();
        stats = {
            computed_at: new Date().toISOString(),
            complete: true,
            remain_non_street: stats.remain_non_street,
            remain_minor_streets: {
                total: streetCount,
                by_entity: { street: streetCount },
            },
        };
        await this.writeGapStatsCache(stats);
        return stats;
    }

    private async countRemainPlacesChunked(): Promise<number> {
        const bounds = await this.prisma.$queryRaw<{ max_id: bigint | null }[]>(Prisma.sql`
            SELECT max(id) AS max_id FROM core.core_places
        `);
        const maxId = Number(bounds[0]?.max_id ?? 0n);
        if (maxId <= 0) return 0;

        const chunkSize = 25_000;
        let total = 0;
        for (let start = 1; start <= maxId; start += chunkSize) {
            const end = start + chunkSize - 1;
            const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
                SELECT count(*)::bigint AS count
                FROM core.core_places p
                WHERE p.id BETWEEN ${start} AND ${end}
                  AND p.deleted_at IS NULL
                  AND p.is_public = true
                  AND (
                    (
                        EXISTS (
                            SELECT 1 FROM core.core_place_names n
                            WHERE n.place_id = p.id
                              AND (
                                  n.language_code = 'en'
                                  OR (n.name ~ '[A-Za-z]' AND n.name !~ '[\\u1000-\\u109F]')
                              )
                        )
                        AND NOT EXISTS (
                            SELECT 1 FROM core.core_place_names n
                            WHERE n.place_id = p.id
                              AND (
                                  n.language_code IN ('my', 'mm')
                                  OR n.name ~ '[\\u1000-\\u109F]'
                              )
                        )
                        AND NOT (p.is_verified OR p.importance_score >= 70)
                    )
                    OR (
                        NOT EXISTS (
                            SELECT 1 FROM core.core_place_names n
                            WHERE n.place_id = p.id
                              AND nullif(btrim(n.name), '') IS NOT NULL
                        )
                        AND (
                            p.primary_name IS NULL
                            OR btrim(p.primary_name) = ''
                            OR (
                                p.primary_name ~ '[A-Za-z]'
                                AND p.primary_name !~ '[\\u1000-\\u109F]'
                                AND NOT (p.is_verified OR p.importance_score >= 70)
                            )
                            OR (
                                p.primary_name !~ '[\\u1000-\\u109F]'
                                AND p.primary_name !~ '[A-Za-z]'
                            )
                        )
                    )
                  )
            `);
            total += Number(rows[0]?.count ?? 0n);
        }
        return total;
    }

    private async countMinorLatinStreetsChunked(): Promise<number> {
        const bounds = await this.prisma.$queryRaw<{ max_id: bigint | null }[]>(Prisma.sql`
            SELECT max(id) AS max_id FROM core.core_streets
        `);
        const maxId = Number(bounds[0]?.max_id ?? 0n);
        if (maxId <= 0) return 0;

        const chunkSize = 25_000;
        let total = 0;
        for (let start = 1; start <= maxId; start += chunkSize) {
            const end = start + chunkSize - 1;
            const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
                SELECT count(*)::bigint AS count
                FROM core.core_streets s
                WHERE s.id BETWEEN ${start} AND ${end}
                  AND s.is_active = true
                  AND lower(coalesce(s.road_class, '')) NOT IN (
                      'motorway', 'trunk', 'primary', 'secondary',
                      'motorway_link', 'trunk_link', 'primary_link', 'secondary_link'
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM core.core_street_names n
                      WHERE n.street_id = s.id
                        AND (
                            n.language_code IN ('my', 'mm')
                            OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
                            OR n.name ~ '[\\u1000-\\u109F]'
                        )
                  )
            `);
            total += Number(rows[0]?.count ?? 0n);
        }
        return total;
    }

    async listGaps(filters: ListNamePairGapsQuery): Promise<{
        items: NamePairGapRow[];
        total: number;
    }> {
        const cached = await this.readGapStatsCache();
        if (filters.bucket === "remain_minor_streets") {
            return this.listMinorStreetGaps(filters, cached?.remain_minor_streets.total);
        }
        const entityType = filters.entity_type ?? "place";
        const cachedEntityTotal = cached?.remain_non_street.by_entity[entityType];
        switch (entityType) {
            case "place":
                return this.listRemainPlaces(filters, cachedEntityTotal);
            case "settlement":
                return this.listRemainSettlements(filters);
            case "admin_area":
                return this.listRemainAdminAreas(filters);
            case "building":
                return this.listRemainBuildings(filters);
            case "transport_stop":
                return this.listRemainStops(filters);
            case "transport_terminal":
                return this.listRemainTerminals(filters);
            case "street":
                return this.listMinorStreetGaps(filters, cached?.remain_minor_streets.total);
            default:
                return { items: [], total: 0 };
        }
    }

    private async listRemainPlaces(
        filters: ListNamePairGapsQuery,
        cachedTotal?: number,
    ) {
        const term = filters.q ? `%${filters.q}%` : null;
        // Page only — full place count times out; use cached bucket total when present.
        const items = await this.prisma.$queryRaw<NamePairGapRow[]>(Prisma.sql`
            SELECT
                'place'::text AS entity_type,
                p.id AS entity_id,
                p.public_id::text AS entity_public_id,
                coalesce(p.primary_name, '(unnamed)') AS source_name,
                NULL::text AS name_mm,
                (
                    SELECT n.name FROM core.core_place_names n
                    WHERE n.place_id = p.id
                      AND (
                          n.language_code = 'en'
                          OR (n.name ~ '[A-Za-z]' AND n.name !~ '[\\u1000-\\u109F]')
                      )
                    ORDER BY n.is_primary DESC NULLS LAST
                    LIMIT 1
                ) AS name_en,
                'remain_en_only_not_important'::text AS gap_reason
            FROM core.core_places p
            WHERE p.deleted_at IS NULL
              AND p.is_public = true
              AND NOT (p.is_verified OR p.importance_score >= 70)
              AND EXISTS (
                  SELECT 1 FROM core.core_place_names n
                  WHERE n.place_id = p.id
                    AND (
                        n.language_code = 'en'
                        OR (n.name ~ '[A-Za-z]' AND n.name !~ '[\\u1000-\\u109F]')
                    )
              )
              AND NOT EXISTS (
                  SELECT 1 FROM core.core_place_names n
                  WHERE n.place_id = p.id
                    AND (
                        n.language_code IN ('my', 'mm')
                        OR n.name ~ '[\\u1000-\\u109F]'
                    )
              )
              ${term ? Prisma.sql`AND coalesce(p.primary_name, '') ILIKE ${term}` : Prisma.empty}
            ORDER BY p.id
            LIMIT ${filters.limit} OFFSET ${filters.offset}
        `);
        const total =
            typeof cachedTotal === "number"
                ? cachedTotal
                : filters.offset + items.length + (items.length === filters.limit ? 1 : 0);
        return { items, total };
    }

    private async listRemainSettlements(filters: ListNamePairGapsQuery) {
        const term = filters.q ? `%${filters.q}%` : null;
        const whereExtra = term
            ? Prisma.sql`AND coalesce(canonical_name, '') ILIKE ${term}`
            : Prisma.empty;
        const [countRows, items] = await Promise.all([
            this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
                SELECT count(*)::bigint AS count FROM core.core_settlements
                WHERE nullif(btrim(name_mm), '') IS NULL AND nullif(btrim(name_en), '') IS NULL
                ${whereExtra}
            `),
            this.prisma.$queryRaw<NamePairGapRow[]>(Prisma.sql`
                SELECT 'settlement'::text AS entity_type, id AS entity_id, public_id::text AS entity_public_id,
                    coalesce(canonical_name, '(unnamed)') AS source_name,
                    name_mm, name_en, 'remain_neither'::text AS gap_reason
                FROM core.core_settlements
                WHERE nullif(btrim(name_mm), '') IS NULL AND nullif(btrim(name_en), '') IS NULL
                ${whereExtra}
                ORDER BY id LIMIT ${filters.limit} OFFSET ${filters.offset}
            `),
        ]);
        return { items, total: Number(countRows[0]?.count ?? 0n) };
    }

    private async listRemainAdminAreas(filters: ListNamePairGapsQuery) {
        const term = filters.q ? `%${filters.q}%` : null;
        const whereExtra = term
            ? Prisma.sql`AND a.canonical_name ILIKE ${term}`
            : Prisma.empty;
        const [countRows, items] = await Promise.all([
            this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
                SELECT count(*)::bigint AS count
                FROM core.core_admin_areas a
                WHERE a.is_active = true
                  AND NOT EXISTS (SELECT 1 FROM core.core_admin_area_names n WHERE n.admin_area_id=a.id AND (n.language_code IN ('my','mm') OR n.name ~ '[\\u1000-\\u109F]'))
                  AND NOT EXISTS (SELECT 1 FROM core.core_admin_area_names n WHERE n.admin_area_id=a.id AND (n.language_code='en' OR (n.name ~ '[A-Za-z]' AND n.name !~ '[\\u1000-\\u109F]')))
                ${whereExtra}
            `),
            this.prisma.$queryRaw<NamePairGapRow[]>(Prisma.sql`
                SELECT 'admin_area'::text AS entity_type, a.id AS entity_id, a.public_id::text AS entity_public_id,
                    a.canonical_name AS source_name, NULL::text AS name_mm, NULL::text AS name_en,
                    'remain_neither'::text AS gap_reason
                FROM core.core_admin_areas a
                WHERE a.is_active = true
                  AND NOT EXISTS (SELECT 1 FROM core.core_admin_area_names n WHERE n.admin_area_id=a.id AND (n.language_code IN ('my','mm') OR n.name ~ '[\\u1000-\\u109F]'))
                  AND NOT EXISTS (SELECT 1 FROM core.core_admin_area_names n WHERE n.admin_area_id=a.id AND (n.language_code='en' OR (n.name ~ '[A-Za-z]' AND n.name !~ '[\\u1000-\\u109F]')))
                ${whereExtra}
                ORDER BY a.id LIMIT ${filters.limit} OFFSET ${filters.offset}
            `),
        ]);
        return { items, total: Number(countRows[0]?.count ?? 0n) };
    }

    private async listRemainBuildings(filters: ListNamePairGapsQuery) {
        const [countRows, items] = await Promise.all([
            this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
                WITH b AS (
                    SELECT building_id,
                        bool_or(language_code IN ('my','mm') OR name ~ '[\\u1000-\\u109F]') AS has_mm,
                        bool_or(language_code='en' OR (name ~ '[A-Za-z]' AND name !~ '[\\u1000-\\u109F]')) AS has_en,
                        max(name) FILTER (WHERE language_code='en' OR (name ~ '[A-Za-z]' AND name !~ '[\\u1000-\\u109F]')) AS en_name
                    FROM core.core_building_names GROUP BY building_id
                )
                SELECT count(*)::bigint AS count FROM b
                JOIN core.core_buildings bld ON bld.id=b.building_id AND bld.deleted_at IS NULL
                WHERE (has_en AND NOT has_mm AND coalesce(bld.is_verified,false) IS FALSE) OR (NOT has_mm AND NOT has_en)
            `),
            this.prisma.$queryRaw<NamePairGapRow[]>(Prisma.sql`
                WITH b AS (
                    SELECT building_id,
                        bool_or(language_code IN ('my','mm') OR name ~ '[\\u1000-\\u109F]') AS has_mm,
                        bool_or(language_code='en' OR (name ~ '[A-Za-z]' AND name !~ '[\\u1000-\\u109F]')) AS has_en,
                        max(name) FILTER (WHERE language_code='en' OR (name ~ '[A-Za-z]' AND name !~ '[\\u1000-\\u109F]')) AS en_name,
                        max(name) FILTER (WHERE language_code IN ('my','mm') OR name ~ '[\\u1000-\\u109F]') AS mm_name
                    FROM core.core_building_names GROUP BY building_id
                )
                SELECT 'building'::text AS entity_type, bld.id AS entity_id, bld.public_id::text AS entity_public_id,
                    coalesce(b.en_name, b.mm_name, '(unnamed)') AS source_name,
                    b.mm_name AS name_mm, b.en_name AS name_en,
                    CASE WHEN b.has_en AND NOT b.has_mm THEN 'remain_en_only' ELSE 'remain_no_script' END AS gap_reason
                FROM b
                JOIN core.core_buildings bld ON bld.id=b.building_id AND bld.deleted_at IS NULL
                WHERE (b.has_en AND NOT b.has_mm AND coalesce(bld.is_verified,false) IS FALSE) OR (NOT b.has_mm AND NOT b.has_en)
                ORDER BY bld.id LIMIT ${filters.limit} OFFSET ${filters.offset}
            `),
        ]);
        return { items, total: Number(countRows[0]?.count ?? 0n) };
    }

    private async listRemainStops(filters: ListNamePairGapsQuery) {
        const term = filters.q ? `%${filters.q}%` : null;
        const whereExtra = term
            ? Prisma.sql`AND coalesce(name, name_en, name_mm, '') ILIKE ${term}`
            : Prisma.empty;
        const [countRows, items] = await Promise.all([
            this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
                SELECT count(*)::bigint AS count FROM transport.stops
                WHERE deleted_at IS NULL AND is_active = true
                  AND (
                    (nullif(btrim(name_en),'') IS NOT NULL AND nullif(btrim(name_mm),'') IS NULL
                     AND lower(coalesce(stop_type,'')) NOT IN ('station','terminal','ferry_terminal'))
                    OR (nullif(btrim(name_mm),'') IS NULL AND nullif(btrim(name_en),'') IS NULL)
                  )
                ${whereExtra}
            `),
            this.prisma.$queryRaw<NamePairGapRow[]>(Prisma.sql`
                SELECT 'transport_stop'::text AS entity_type, id AS entity_id, public_id::text AS entity_public_id,
                    coalesce(nullif(btrim(name),''), nullif(btrim(name_en),''), nullif(btrim(name_mm),''), '(unnamed)') AS source_name,
                    name_mm, name_en,
                    CASE WHEN nullif(btrim(name_en),'') IS NOT NULL THEN 'remain_en_only' ELSE 'remain_neither' END AS gap_reason
                FROM transport.stops
                WHERE deleted_at IS NULL AND is_active = true
                  AND (
                    (nullif(btrim(name_en),'') IS NOT NULL AND nullif(btrim(name_mm),'') IS NULL
                     AND lower(coalesce(stop_type,'')) NOT IN ('station','terminal','ferry_terminal'))
                    OR (nullif(btrim(name_mm),'') IS NULL AND nullif(btrim(name_en),'') IS NULL)
                  )
                ${whereExtra}
                ORDER BY id LIMIT ${filters.limit} OFFSET ${filters.offset}
            `),
        ]);
        return { items, total: Number(countRows[0]?.count ?? 0n) };
    }

    private async listRemainTerminals(filters: ListNamePairGapsQuery) {
        const [countRows, items] = await Promise.all([
            this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
                SELECT count(*)::bigint AS count FROM transport.terminals
                WHERE deleted_at IS NULL AND is_active = true
                  AND nullif(btrim(name_mm),'') IS NULL AND nullif(btrim(name_en),'') IS NULL
            `),
            this.prisma.$queryRaw<NamePairGapRow[]>(Prisma.sql`
                SELECT 'transport_terminal'::text AS entity_type, id AS entity_id, public_id::text AS entity_public_id,
                    coalesce(nullif(btrim(name),''), '(unnamed)') AS source_name,
                    name_mm, name_en, 'remain_neither'::text AS gap_reason
                FROM transport.terminals
                WHERE deleted_at IS NULL AND is_active = true
                  AND nullif(btrim(name_mm),'') IS NULL AND nullif(btrim(name_en),'') IS NULL
                ORDER BY id LIMIT ${filters.limit} OFFSET ${filters.offset}
            `),
        ]);
        return { items, total: Number(countRows[0]?.count ?? 0n) };
    }

    private async listMinorStreetGaps(
        filters: ListNamePairGapsQuery,
        cachedTotal?: number,
    ) {
        const term = filters.q ? `%${filters.q}%` : null;
        const whereExtra = term
            ? Prisma.sql`AND s.canonical_name ILIKE ${term}`
            : Prisma.empty;
        // Items only — count(*) over ~780k streets times out on the request path.
        const items = await this.prisma.$queryRaw<NamePairGapRow[]>(Prisma.sql`
            SELECT 'street'::text AS entity_type, s.id AS entity_id, s.public_id::text AS entity_public_id,
                coalesce(s.canonical_name, '(unnamed)') AS source_name,
                NULL::text AS name_mm,
                (
                    SELECT n.name FROM core.core_street_names n
                    WHERE n.street_id = s.id
                      AND (n.language_code = 'en' OR (n.name ~ '[A-Za-z]' AND n.name !~ '[\\u1000-\\u109F]'))
                    ORDER BY n.is_primary DESC LIMIT 1
                ) AS name_en,
                'remain_minor_latin_street'::text AS gap_reason
            FROM core.core_streets s
            WHERE s.is_active = true
              AND lower(coalesce(s.road_class, '')) NOT IN (
                  'motorway','trunk','primary','secondary',
                  'motorway_link','trunk_link','primary_link','secondary_link'
              )
              AND NOT EXISTS (
                  SELECT 1 FROM core.core_street_names n
                  WHERE n.street_id = s.id
                    AND (
                        n.language_code IN ('my','mm')
                        OR upper(trim(coalesce(n.script_code,''))) = 'MYMR'
                        OR n.name ~ '[\\u1000-\\u109F]'
                    )
              )
            ${whereExtra}
            ORDER BY s.id
            LIMIT ${filters.limit} OFFSET ${filters.offset}
        `);
        const total =
            typeof cachedTotal === "number"
                ? cachedTotal
                : filters.offset + items.length + (items.length === filters.limit ? 1 : 0);
        return { items, total };
    }
}

function toCountMap(rows: EntityCountRow[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const row of rows) {
        out[row.entity_type] = Number(row.count);
    }
    return out;
}
