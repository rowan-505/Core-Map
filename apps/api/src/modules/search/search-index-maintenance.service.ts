import type { PrismaClient } from "@prisma/client";

import {
    rebuildSearchFamilies,
    summarizeSearchFamilyRebuildRows,
    type SearchFamilyRebuildLog,
    type SearchFamilyRebuildOutcome,
} from "./search-family-rebuild.js";
import {
    buildRepairedByFamily,
    buildSearchIndexHealthReport,
    fetchSearchIndexRunMetadata,
    getSearchIndexHealthReport,
    hasSearchIndexHealthIssues,
    isAllowlistedSearchIndexHealthFamily,
    isSearchIndexFamilyUnhealthy,
    isSearchIndexHeavyRebuildFamily,
    loadSearchIndexHealthReportUncached,
    resolveRebuildViewForHealthFamily,
    resolveRebuildViewsForHealthFamilies,
    runSearchIndexHealthCheck,
    shouldQueueFamilyForAutoRepair,
    SEARCH_INDEX_HEAVY_REBUILD_CRITICAL_GAP_MIN,
    type SearchIndexHealthReport,
} from "./search-index-health.js";
import {
    peekSearchIndexHealthCache,
    seedSearchIndexHealthCache,
} from "./search-index-health-cache.js";
import {
    SearchIndexRebuildLockError,
    withSearchIndexRebuildLocks,
} from "./search-index-maintenance.lock.js";
import {
    SearchIndexMaintenanceRepository,
    type SearchIndexMaintenanceAuditContext,
} from "./search-index-maintenance.repo.js";
import type {
    ReindexSearchEntityBody,
    ReindexSearchFamilyBody,
} from "./search-index-maintenance.schema.js";
import { UnifiedSearchSyncRepository } from "./unified-search-sync.repo.js";
import { normalizeTransportSearchEntityType } from "./transport-search-entity.js";
import type { UnifiedSearchSyncEntityType } from "./unified-search-sync.types.js";

export class SearchIndexMaintenanceError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
    ) {
        super(message);
        this.name = "SearchIndexMaintenanceError";
    }
}

export type SearchIndexMaintenanceActor = {
    publicId: string;
    ipAddress: string | null;
    userAgent: string | null;
};

export type SearchIndexMaintenanceOperationStatus =
    | "success"
    | "partial"
    | "failed"
    | "skipped"
    | "conflict";

export type SearchIndexMaintenanceOperationResult = {
    operation: "health_check" | "reindex_family" | "reindex_entity" | "repair_unhealthy";
    status: SearchIndexMaintenanceOperationStatus;
    duration_ms: number;
    affected_families: string[];
    entity_family: string | null;
    entity_type: string | null;
    entity_id: string | null;
    rebuild_views: string[];
    rebuild_run_id: string | null;
    rows_rebuilt: number;
    message: string | null;
    health_before: SearchIndexHealthReport;
    health_after: SearchIndexHealthReport;
};

type MaintenanceLog = SearchFamilyRebuildLog;

function deriveOperationStatus(input: {
    rebuild?: SearchFamilyRebuildOutcome | null;
    healthAfterUnhealthy: boolean;
    skipped?: boolean;
    conflict?: boolean;
    partialRepair?: boolean;
}): SearchIndexMaintenanceOperationStatus {
    if (input.conflict) {
        return "conflict";
    }
    if (input.skipped) {
        return "skipped";
    }
    if (input.rebuild?.success === false) {
        return "failed";
    }
    if (input.partialRepair || input.healthAfterUnhealthy) {
        return "partial";
    }
    return "success";
}

async function loadHealthReport(prisma: PrismaClient): Promise<SearchIndexHealthReport> {
    return loadSearchIndexHealthReportUncached(prisma);
}

function publishFreshHealthReport(report: SearchIndexHealthReport): void {
    seedSearchIndexHealthCache(report);
}

function auditSnapshot(result: SearchIndexMaintenanceOperationResult): Record<string, unknown> {
    return {
        operation: result.operation,
        status: result.status,
        duration_ms: result.duration_ms,
        affected_families: result.affected_families,
        entity_family: result.entity_family,
        entity_type: result.entity_type,
        entity_id: result.entity_id,
        rebuild_views: result.rebuild_views,
        rebuild_run_id: result.rebuild_run_id,
        rows_rebuilt: result.rows_rebuilt,
        message: result.message,
        health_before_status: result.health_before.overall_status,
        health_after_status: result.health_after.overall_status,
    };
}

export class SearchIndexMaintenanceService {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly repo = new SearchIndexMaintenanceRepository(prisma),
    ) {}

    private async writeAudit(
        actor: SearchIndexMaintenanceActor,
        actionType: string,
        entityId: bigint | null,
        before: SearchIndexMaintenanceOperationResult | null,
        after: SearchIndexMaintenanceOperationResult,
    ): Promise<void> {
        const actorUserId = await this.repo.findUserIdByPublicId(actor.publicId);
        const audit: SearchIndexMaintenanceAuditContext = {
            actorUserId,
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
        };
        await this.repo.insertAudit({
            actionType,
            entityId,
            before: before ? auditSnapshot(before) : null,
            after: auditSnapshot(after),
            audit,
        });
    }

    async runHealthCheck(actor: SearchIndexMaintenanceActor): Promise<SearchIndexMaintenanceOperationResult> {
        const startedAt = Date.now();
        const report = await getSearchIndexHealthReport(this.prisma, { refresh: true });
        publishFreshHealthReport(report);
        const result: SearchIndexMaintenanceOperationResult = {
            operation: "health_check",
            status: report.overall_status === "healthy" ? "success" : "partial",
            duration_ms: Date.now() - startedAt,
            affected_families: [],
            entity_family: null,
            entity_type: null,
            entity_id: null,
            rebuild_views: [],
            rebuild_run_id: null,
            rows_rebuilt: 0,
            message: null,
            health_before: report,
            health_after: report,
        };
        await this.writeAudit(actor, "search_index.health_check", null, null, result);
        return result;
    }

    async reindexFamily(
        actor: SearchIndexMaintenanceActor,
        body: ReindexSearchFamilyBody,
        log?: MaintenanceLog,
    ): Promise<SearchIndexMaintenanceOperationResult> {
        if (!isAllowlistedSearchIndexHealthFamily(body.entity_family)) {
            throw new SearchIndexMaintenanceError("Unknown search index family.", 400);
        }

        const rebuildView = resolveRebuildViewForHealthFamily(body.entity_family);
        if (!rebuildView) {
            throw new SearchIndexMaintenanceError("No rebuild view mapped for family.", 400);
        }

        const startedAt = Date.now();
        const skipHealthRefresh = body.skip_health_refresh === true;
        const cached = peekSearchIndexHealthCache();
        const healthBefore =
            skipHealthRefresh
                ? (cached ?? (await getSearchIndexHealthReport(this.prisma, { refresh: false })))
                : await loadHealthReport(this.prisma);

        let rebuild: SearchFamilyRebuildOutcome | null = null;
        let status: SearchIndexMaintenanceOperationStatus = "failed";
        let message: string | null = null;

        try {
            rebuild = await withSearchIndexRebuildLocks(this.prisma, [rebuildView], (tx) =>
                rebuildSearchFamilies(tx, [rebuildView], log),
            );
        } catch (err) {
            if (err instanceof SearchIndexRebuildLockError) {
                message = err.message;
                status = "conflict";
            } else {
                throw err;
            }
        }

        const healthAfter = skipHealthRefresh
            ? healthBefore
            : await loadHealthReport(this.prisma);
        const familyAfter = healthAfter.families.find((row) => row.entity_family === body.entity_family);

        if (status !== "conflict") {
            status = deriveOperationStatus({
                rebuild,
                // When health refresh is skipped, trust rebuild success for status.
                healthAfterUnhealthy: skipHealthRefresh
                    ? false
                    : familyAfter?.status === "unhealthy",
            });
        }

        const result: SearchIndexMaintenanceOperationResult = {
            operation: "reindex_family",
            status,
            duration_ms: Date.now() - startedAt,
            affected_families: [body.entity_family],
            entity_family: body.entity_family,
            entity_type: familyAfter?.search_entity_type ?? null,
            entity_id: null,
            rebuild_views: rebuild?.views ?? [rebuildView],
            rebuild_run_id: rebuild?.run_id != null ? String(rebuild.run_id) : null,
            rows_rebuilt: rebuild
                ? summarizeSearchFamilyRebuildRows(rebuild.entity_counts, rebuild.view_results)
                : 0,
            message: skipHealthRefresh
                ? [message, "Health report not refreshed (sequential repair)."].filter(Boolean).join(" ")
                : message,
            health_before: healthBefore,
            health_after: healthAfter,
        };
        await this.writeAudit(actor, "search_index.reindex_family", null, null, result);
        if (!skipHealthRefresh) {
            publishFreshHealthReport(healthAfter);
        }
        return result;
    }

    async repairUnhealthyFamilies(
        actor: SearchIndexMaintenanceActor,
        log?: MaintenanceLog,
        options?: Pick<RepairUnhealthySearchIndexOptions, "criticalOnly" | "includeHeavy">,
    ): Promise<SearchIndexMaintenanceOperationResult> {
        const startedAt = Date.now();
        const criticalOnly = options?.criticalOnly !== false;
        const includeHeavy = options?.includeHeavy === true;

        let outcome: Awaited<ReturnType<typeof repairUnhealthySearchIndexFamilies>>;
        try {
            outcome = await repairUnhealthySearchIndexFamilies(this.prisma, log, {
                criticalOnly,
                includeHeavy,
            });
        } catch (err) {
            if (err instanceof SearchIndexRebuildLockError) {
                const health = await loadHealthReport(this.prisma);
                const result: SearchIndexMaintenanceOperationResult = {
                    operation: "repair_unhealthy",
                    status: "conflict",
                    duration_ms: Date.now() - startedAt,
                    affected_families: [],
                    entity_family: null,
                    entity_type: null,
                    entity_id: null,
                    rebuild_views: [],
                    rebuild_run_id: null,
                    rows_rebuilt: 0,
                    message: err.message,
                    health_before: health,
                    health_after: health,
                };
                await this.writeAudit(actor, "search_index.repair_unhealthy", null, null, result);
                publishFreshHealthReport(health);
                return result;
            }
            throw err;
        }

        const healthBefore = buildSearchIndexHealthReport(
            outcome.before,
            await fetchSearchIndexRunMetadata(this.prisma),
        );
        const heavyNote =
            outcome.skippedHeavyFamilies.length > 0
                ? ` Skipped heavy families (use Reindex family): ${outcome.skippedHeavyFamilies.join(", ")}.`
                : "";

        if (outcome.skipped) {
            const result: SearchIndexMaintenanceOperationResult = {
                operation: "repair_unhealthy",
                status: "skipped",
                duration_ms: Date.now() - startedAt,
                affected_families: [],
                entity_family: null,
                entity_type: null,
                entity_id: null,
                rebuild_views: [],
                rebuild_run_id: null,
                rows_rebuilt: 0,
                message:
                    `No critical missing/ghost gaps queued for auto-repair.${heavyNote}`.trim(),
                health_before: healthBefore,
                health_after: healthBefore,
            };
            await this.writeAudit(actor, "search_index.repair_unhealthy", null, null, result);
            publishFreshHealthReport(healthBefore);
            return result;
        }

        const healthAfter = buildSearchIndexHealthReport(
            outcome.after,
            await fetchSearchIndexRunMetadata(this.prisma),
        );
        const repairedCount = [...outcome.repairedByFamily.values()].filter(Boolean).length;
        const queuedCount = outcome.before.filter((row) =>
            shouldQueueFamilyForAutoRepair(row, { criticalOnly, includeHeavy }),
        ).length;

        const status = deriveOperationStatus({
            rebuild: outcome.rebuild,
            healthAfterUnhealthy: hasSearchIndexHealthIssues(outcome.after),
            partialRepair: repairedCount > 0 && repairedCount < queuedCount,
        });

        const result: SearchIndexMaintenanceOperationResult = {
            operation: "repair_unhealthy",
            status,
            duration_ms: Date.now() - startedAt,
            affected_families: outcome.before
                .filter((row) => outcome.repairedByFamily.get(row.entity_family))
                .map((row) => row.entity_family),
            entity_family: null,
            entity_type: null,
            entity_id: null,
            rebuild_views: outcome.rebuildViews,
            rebuild_run_id:
                outcome.rebuild?.run_id != null ? String(outcome.rebuild.run_id) : null,
            rows_rebuilt: outcome.rebuild
                ? summarizeSearchFamilyRebuildRows(
                      outcome.rebuild.entity_counts,
                      outcome.rebuild.view_results,
                  )
                : 0,
            message: [
                outcome.rebuild && !outcome.rebuild.success
                    ? `Rebuild finished with status ${outcome.rebuild.status}.`
                    : repairedCount < queuedCount
                      ? `Repaired ${repairedCount}/${queuedCount} queued families.`
                      : null,
                heavyNote.trim() || null,
            ]
                .filter(Boolean)
                .join(" ") || null,
            health_before: healthBefore,
            health_after: healthAfter,
        };
        await this.writeAudit(actor, "search_index.repair_unhealthy", null, null, result);
        publishFreshHealthReport(healthAfter);
        return result;
    }

    async reindexEntity(
        actor: SearchIndexMaintenanceActor,
        body: ReindexSearchEntityBody,
        log?: MaintenanceLog,
    ): Promise<SearchIndexMaintenanceOperationResult> {
        const startedAt = Date.now();
        const healthBefore = await loadHealthReport(this.prisma);
        const canonicalType = normalizeTransportSearchEntityType(body.entity_type);
        const syncRepo = new UnifiedSearchSyncRepository(this.prisma);

        let syncResult;
        try {
            syncResult = await syncRepo.syncDocuments(
                canonicalType as UnifiedSearchSyncEntityType,
                [body.entity_id],
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : "search.sync_search_documents failed";
            log?.error?.({ err, entity_type: canonicalType, entity_id: body.entity_id.toString() }, message);
            throw new SearchIndexMaintenanceError(message, 500);
        }

        const healthAfter = await loadHealthReport(this.prisma);
        const rowsRebuilt = syncResult.synced + syncResult.removed;
        const familyAfter = healthAfter.families.find((row) => row.search_entity_type === canonicalType);

        const result: SearchIndexMaintenanceOperationResult = {
            operation: "reindex_entity",
            status: rowsRebuilt > 0 || familyAfter?.status === "healthy" ? "success" : "partial",
            duration_ms: Date.now() - startedAt,
            affected_families: familyAfter ? [familyAfter.entity_family] : [],
            entity_family: familyAfter?.entity_family ?? null,
            entity_type: canonicalType,
            entity_id: body.entity_id.toString(),
            rebuild_views: [],
            rebuild_run_id: null,
            rows_rebuilt: rowsRebuilt,
            message:
                rowsRebuilt === 0
                    ? "Incremental sync completed with no index row changes."
                    : null,
            health_before: healthBefore,
            health_after: healthAfter,
        };
        await this.writeAudit(actor, "search_index.reindex_entity", body.entity_id, null, result);
        publishFreshHealthReport(healthAfter);
        return result;
    }
}

export type RepairUnhealthySearchIndexOptions = {
    /** When set, only rebuild these health families (e.g. `admin_areas`). */
    families?: readonly string[];
    /**
     * Rebuild only families with missing/ghost; skip stale-only.
     * Defaults to true for auto-repair so stale drift cannot queue multi-hour
     * street/settlement rebuilds.
     */
    criticalOnly?: boolean;
    /**
     * Allow auto-repair to queue settlements/street_groups even for smaller gaps.
     * Explicit single-family reindex always works regardless of this flag.
     */
    includeHeavy?: boolean;
};

/** Shared repair flow for CLI reconcile script and admin API. */
export async function repairUnhealthySearchIndexFamilies(
    prisma: PrismaClient,
    log?: MaintenanceLog,
    options?: RepairUnhealthySearchIndexOptions,
): Promise<{
    before: Awaited<ReturnType<typeof runSearchIndexHealthCheck>>;
    after: Awaited<ReturnType<typeof runSearchIndexHealthCheck>>;
    rebuild: SearchFamilyRebuildOutcome | null;
    rebuildViews: string[];
    skipped: boolean;
    repairedByFamily: Map<string, boolean>;
    skippedHeavyFamilies: string[];
}> {
    const before = await runSearchIndexHealthCheck(prisma);
    const familyFilter =
        options?.families != null && options.families.length > 0
            ? new Set(options.families)
            : null;
    const criticalOnly = options?.criticalOnly !== false;
    const includeHeavy = options?.includeHeavy === true;

    const candidates = before
        .filter((row) => familyFilter == null || familyFilter.has(row.entity_family))
        .filter((row) =>
            shouldQueueFamilyForAutoRepair(row, {
                criticalOnly,
                // Explicit --families=street_groups opts that family in.
                includeHeavy: includeHeavy || familyFilter?.has(row.entity_family) === true,
            }),
        )
        .slice()
        .sort(
            (a, b) =>
                Number(a.canonical_count) - Number(b.canonical_count) ||
                a.entity_family.localeCompare(b.entity_family),
        );

    const skippedHeavyFamilies = before
        .filter((row) => familyFilter == null || familyFilter.has(row.entity_family))
        .filter((row) => isSearchIndexHeavyRebuildFamily(row.entity_family))
        .filter((row) => {
            const gap = row.missing + row.ghost;
            if (criticalOnly && gap <= 0) return false;
            if (!criticalOnly && !isSearchIndexFamilyUnhealthy(row)) return false;
            return (
                !includeHeavy &&
                familyFilter?.has(row.entity_family) !== true &&
                gap < SEARCH_INDEX_HEAVY_REBUILD_CRITICAL_GAP_MIN
            );
        })
        .map((row) => row.entity_family);

    if (candidates.length === 0) {
        return {
            before,
            after: before,
            rebuild: null,
            rebuildViews: [],
            skipped: true,
            repairedByFamily: buildRepairedByFamily(before, before),
            skippedHeavyFamilies,
        };
    }

    const rebuildViews = resolveRebuildViewsForHealthFamilies(
        candidates.map((row) => row.entity_family),
    );
    if (rebuildViews.length === 0) {
        throw new Error("No rebuild views resolved for unhealthy families.");
    }

    let rebuild: SearchFamilyRebuildOutcome | null = null;
    for (const view of rebuildViews) {
        const part = await withSearchIndexRebuildLocks(prisma, [view], (tx) =>
            rebuildSearchFamilies(tx, [view], log),
        );
        if (!part) {
            break;
        }
        rebuild = part;
        if (!part.success) {
            break;
        }
    }
    const after = await runSearchIndexHealthCheck(prisma);

    return {
        before,
        after,
        rebuild,
        rebuildViews,
        skipped: false,
        repairedByFamily: buildRepairedByFamily(before, after),
        skippedHeavyFamilies,
    };
}
