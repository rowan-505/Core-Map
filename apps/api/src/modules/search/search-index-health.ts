import type { PrismaClient } from "@prisma/client";

import {
    getCachedSearchIndexHealthReport,
    clearSearchIndexHealthCache,
    peekSearchIndexHealthCache,
} from "./search-index-health-cache.js";
import {
    deriveSearchIndexFamilySeverity,
    deriveSearchIndexOverallSeverity,
    severityToBinaryHealthStatus,
    type SearchIndexHealthSeverity,
} from "./search-index-health-severity.js";
import { SEARCH_INDEX_RUN_SUCCESSFUL_STATUS_SQL } from "./search-index-run-status.js";

export type SearchIndexHealthRow = {
    entity_family: string;
    search_entity_type: string;
    canonical_count: bigint | number;
    indexed_count: bigint | number;
    missing_count: bigint | number;
    ghost_count: bigint | number;
    stale_count: bigint | number;
    latest_indexed_at: Date | null;
    latest_source_updated_at: Date | null;
};

export type SearchIndexHealthIssueCounts = {
    missing: number;
    ghost: number;
    stale: number;
};

export type SearchIndexFamilyHealth = SearchIndexHealthRow & SearchIndexHealthIssueCounts;

/** Health entity_family → rebuild view key for `search.rebuild_search_documents`. */
export const SEARCH_HEALTH_FAMILY_REBUILD_VIEWS: Readonly<Record<string, string>> = {
    places: "places",
    settlements: "settlements",
    admin_areas: "admin_areas",
    street_groups: "street_groups",
    addresses: "addresses",
    transport_stops: "bus_stops",
    transport_terminals: "transport_terminals",
    transport_routes: "bus_routes",
    transport_route_variants: "bus_routes",
    buildings: "buildings",
    land_area: "land_area",
    water_lines: "water_lines",
    water_polygons: "water_polygons",
};

/**
 * Full rebuilds for these families routinely take 1–3+ hours on production and
 * often look stuck. Auto-repair skips them unless missing+ghost is large or the
 * operator opts in with includeHeavy / an explicit family reindex.
 */
export const SEARCH_INDEX_HEAVY_REBUILD_FAMILIES = new Set([
    "settlements",
    "street_groups",
]);

/** Minimum missing+ghost before auto-repair will queue a heavy family. */
export const SEARCH_INDEX_HEAVY_REBUILD_CRITICAL_GAP_MIN = 100;

export function isSearchIndexHeavyRebuildFamily(entityFamily: string): boolean {
    return SEARCH_INDEX_HEAVY_REBUILD_FAMILIES.has(entityFamily);
}

/**
 * Decide whether auto-repair should rebuild a family.
 * Default is critical-only (missing/ghost), and heavy families need a large gap
 * unless `includeHeavy` is set.
 */
export function shouldQueueFamilyForAutoRepair(
    row: Pick<SearchIndexFamilyHealth, "entity_family" | "missing" | "ghost" | "stale">,
    options: { criticalOnly?: boolean; includeHeavy?: boolean } = {},
): boolean {
    const criticalOnly = options.criticalOnly !== false;
    const gap = row.missing + row.ghost;

    if (criticalOnly) {
        if (gap <= 0) {
            return false;
        }
    } else if (!isSearchIndexFamilyUnhealthy(row)) {
        return false;
    }

    if (isSearchIndexHeavyRebuildFamily(row.entity_family) && options.includeHeavy !== true) {
        return gap >= SEARCH_INDEX_HEAVY_REBUILD_CRITICAL_GAP_MIN;
    }

    return true;
}

/**
 * Per-family reconciliation. Avoids one MATERIALIZED union + FULL OUTER JOIN
 * across every source view (that pattern blocks the dashboard for minutes).
 * Each family joins only its own indexed slice against its source view.
 */
function buildFamilyHealthStatsSql(input: {
    entityFamily: string;
    searchEntityType: string;
    sourceView: string;
    /** When the source view mixes entity types (bus routes), filter the type. */
    filterSourceEntityType?: boolean;
}): string {
    const sourceFrom = input.filterSourceEntityType
        ? `(
        SELECT entity_id::bigint AS entity_id, source_updated_at
        FROM ${input.sourceView}
        WHERE entity_type = '${input.searchEntityType}'
    )`
        : `(
        SELECT entity_id::bigint AS entity_id, source_updated_at
        FROM ${input.sourceView}
    )`;

    return `
SELECT
    '${input.entityFamily}'::text AS entity_family,
    '${input.searchEntityType}'::text AS search_entity_type,
    count(c.entity_id) AS canonical_count,
    count(i.entity_id) AS indexed_count,
    count(*) FILTER (
        WHERE c.entity_id IS NOT NULL
          AND i.entity_id IS NULL
    ) AS missing_count,
    count(*) FILTER (
        WHERE i.entity_id IS NOT NULL
          AND c.entity_id IS NULL
    ) AS ghost_count,
    count(*) FILTER (
        WHERE c.entity_id IS NOT NULL
          AND i.entity_id IS NOT NULL
          AND (
              i.source_updated_at IS NULL
              OR c.source_updated_at IS NULL
              OR i.source_updated_at < c.source_updated_at
          )
    ) AS stale_count,
    max(i.indexed_at) AS latest_indexed_at,
    max(c.source_updated_at) AS latest_source_updated_at
FROM ${sourceFrom} c
FULL OUTER JOIN (
    SELECT
        entity_id::bigint AS entity_id,
        source_updated_at,
        indexed_at
    FROM search.search_documents
    WHERE entity_type = '${input.searchEntityType}'
      AND is_public = true
      AND is_active = true
) i ON i.entity_id = c.entity_id
`.trim();
}

const SEARCH_INDEX_HEALTH_FAMILY_SPECS = [
    { entityFamily: "places", searchEntityType: "place", sourceView: "search.v_search_places_source" },
    {
        entityFamily: "settlements",
        searchEntityType: "settlement",
        sourceView: "search.v_search_settlements_source",
    },
    {
        entityFamily: "admin_areas",
        searchEntityType: "admin_area",
        sourceView: "search.v_search_admin_areas_source",
    },
    {
        entityFamily: "street_groups",
        searchEntityType: "street_group",
        sourceView: "search.v_search_street_groups_source",
    },
    {
        entityFamily: "addresses",
        searchEntityType: "address",
        sourceView: "search.v_search_addresses_source",
    },
    {
        entityFamily: "transport_stops",
        searchEntityType: "transport_stop",
        sourceView: "search.v_search_bus_stops_source",
    },
    {
        entityFamily: "transport_terminals",
        searchEntityType: "transport_terminal",
        sourceView: "search.v_search_transport_terminals_source",
    },
    {
        entityFamily: "transport_routes",
        searchEntityType: "transport_route",
        sourceView: "search.v_search_bus_routes_source",
        filterSourceEntityType: true,
    },
    {
        entityFamily: "transport_route_variants",
        searchEntityType: "transport_route_variant",
        sourceView: "search.v_search_bus_routes_source",
        filterSourceEntityType: true,
    },
    {
        entityFamily: "buildings",
        searchEntityType: "building",
        sourceView: "search.v_search_buildings_source",
    },
    {
        entityFamily: "land_area",
        searchEntityType: "land_area",
        sourceView: "search.v_search_land_area_source",
    },
    {
        entityFamily: "water_lines",
        searchEntityType: "water_line",
        sourceView: "search.v_search_water_lines_source",
    },
    {
        entityFamily: "water_polygons",
        searchEntityType: "water_polygon",
        sourceView: "search.v_search_water_polygons_source",
    },
] as const;

export const SEARCH_INDEX_HEALTH_QUERY = `
${SEARCH_INDEX_HEALTH_FAMILY_SPECS.map((spec) => buildFamilyHealthStatsSql(spec)).join("\nUNION ALL\n")}
ORDER BY entity_family
`;

export function toHealthCount(value: bigint | number): number {
    return typeof value === "bigint" ? Number(value) : value;
}

export function normalizeSearchIndexHealthRow(row: SearchIndexHealthRow): SearchIndexFamilyHealth {
    return {
        ...row,
        canonical_count: toHealthCount(row.canonical_count),
        indexed_count: toHealthCount(row.indexed_count),
        missing_count: toHealthCount(row.missing_count),
        ghost_count: toHealthCount(row.ghost_count),
        stale_count: toHealthCount(row.stale_count),
        missing: toHealthCount(row.missing_count),
        ghost: toHealthCount(row.ghost_count),
        stale: toHealthCount(row.stale_count),
    };
}

export function isSearchIndexFamilyUnhealthy(row: Pick<SearchIndexFamilyHealth, "missing" | "ghost" | "stale">): boolean {
    return row.missing > 0 || row.ghost > 0 || row.stale > 0;
}

/** Missing or ghost only — ignores stale (avoids full rebuild for tiny freshness drift). */
export function isSearchIndexFamilyCriticallyUnhealthy(
    row: Pick<SearchIndexFamilyHealth, "missing" | "ghost">,
): boolean {
    return row.missing > 0 || row.ghost > 0;
}

export function hasSearchIndexHealthIssues(
    rows: readonly Pick<SearchIndexFamilyHealth, "missing" | "ghost" | "stale">[],
): boolean {
    return rows.some(isSearchIndexFamilyUnhealthy);
}

export function buildRepairedByFamily(
    before: readonly SearchIndexFamilyHealth[],
    after: readonly SearchIndexFamilyHealth[],
): Map<string, boolean> {
    const afterByFamily = new Map(after.map((row) => [row.entity_family, row]));
    const repaired = new Map<string, boolean>();

    for (const row of before) {
        if (!isSearchIndexFamilyUnhealthy(row)) {
            repaired.set(row.entity_family, false);
            continue;
        }
        const next = afterByFamily.get(row.entity_family);
        repaired.set(row.entity_family, next != null && !isSearchIndexFamilyUnhealthy(next));
    }

    return repaired;
}

export const SEARCH_INDEX_HEALTH_FAMILIES = Object.keys(
    SEARCH_HEALTH_FAMILY_REBUILD_VIEWS,
) as (keyof typeof SEARCH_HEALTH_FAMILY_REBUILD_VIEWS)[];

export function isAllowlistedSearchIndexHealthFamily(
    entityFamily: string,
): entityFamily is keyof typeof SEARCH_HEALTH_FAMILY_REBUILD_VIEWS {
    return Object.prototype.hasOwnProperty.call(SEARCH_HEALTH_FAMILY_REBUILD_VIEWS, entityFamily);
}

export function resolveRebuildViewForHealthFamily(entityFamily: string): string | null {
    return SEARCH_HEALTH_FAMILY_REBUILD_VIEWS[entityFamily] ?? null;
}

export function resolveRebuildViewsForHealthFamilies(entityFamilies: Iterable<string>): string[] {
    const views = new Set<string>();
    for (const family of entityFamilies) {
        const view = SEARCH_HEALTH_FAMILY_REBUILD_VIEWS[family];
        if (view) {
            views.add(view);
        }
    }
    return [...views].sort();
}

export async function runSearchIndexHealthCheck(prisma: PrismaClient): Promise<SearchIndexFamilyHealth[]> {
    // Full reconciliation against geospatial source views is slow; do not inherit
    // a short pooler/session statement_timeout. Cap concurrency so we overlap the
    // large families without exhausting the Prisma pool.
    const concurrency = 3;
    const familyRows: SearchIndexHealthRow[] = new Array(SEARCH_INDEX_HEALTH_FAMILY_SPECS.length);
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= SEARCH_INDEX_HEALTH_FAMILY_SPECS.length) {
                return;
            }
            const spec = SEARCH_INDEX_HEALTH_FAMILY_SPECS[index]!;
            familyRows[index] = await prisma.$transaction(
                async (tx) => {
                    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = 0");
                    const rows = await tx.$queryRawUnsafe<SearchIndexHealthRow[]>(
                        buildFamilyHealthStatsSql(spec),
                    );
                    return (
                        rows[0] ?? {
                            entity_family: spec.entityFamily,
                            search_entity_type: spec.searchEntityType,
                            canonical_count: 0,
                            indexed_count: 0,
                            missing_count: 0,
                            ghost_count: 0,
                            stale_count: 0,
                            latest_indexed_at: null,
                            latest_source_updated_at: null,
                        }
                    );
                },
                {
                    timeout: 10 * 60 * 1000,
                    maxWait: 60 * 1000,
                },
            );
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(concurrency, SEARCH_INDEX_HEALTH_FAMILY_SPECS.length) }, () =>
            worker(),
        ),
    );

    return familyRows
        .map(normalizeSearchIndexHealthRow)
        .sort((a, b) => a.entity_family.localeCompare(b.entity_family));
}
export function formatSearchHealthTimestamp(value: Date | null): string {
    if (!value) {
        return "-";
    }
    return value.toISOString().replace("T", " ").replace("Z", " UTC");
}

export type SearchIndexHealthStatus = "healthy" | "unhealthy";

export type { SearchIndexHealthSeverity } from "./search-index-health-severity.js";

export type SearchIndexRunRow = {
    id: bigint | number;
    status: string;
    started_at: Date;
    finished_at: Date | null;
    entity_counts: unknown;
};

export type SearchIndexRunSummary = {
    id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    entity_counts: unknown;
};

export type SearchIndexHealthFamilyReport = {
    entity_family: string;
    search_entity_type: string;
    /** Intended searchable rows from source views (same as canonical_count). */
    expected_searchable_count: number;
    canonical_count: number;
    indexed_count: number;
    missing_count: number;
    ghost_count: number;
    stale_count: number;
    latest_indexed_at: string | null;
    latest_source_updated_at: string | null;
    severity: SearchIndexHealthSeverity;
    severity_reasons: string[];
    status: SearchIndexHealthStatus;
};

export type SearchIndexHealthReport = {
    overall_status: SearchIndexHealthStatus;
    overall_severity: SearchIndexHealthSeverity;
    overall_severity_reasons: string[];
    health_query_ok: boolean;
    health_query_error: string | null;
    /**
     * `full` = exact missing/ghost/stale via row reconciliation.
     * `snapshot` = fast count-diff only (stale always 0); safe for page load.
     */
    report_mode: "full" | "snapshot";
    totals: {
        expected_searchable_count: number;
        canonical_count: number;
        indexed_count: number;
        missing_count: number;
        ghost_count: number;
        stale_count: number;
    };
    families: SearchIndexHealthFamilyReport[];
    last_rebuild_run: SearchIndexRunSummary | null;
    last_successful_run: SearchIndexRunSummary | null;
};

const LATEST_INDEX_RUN_QUERY = `
SELECT id, status, started_at, finished_at, entity_counts
FROM search.search_index_runs
ORDER BY id DESC
LIMIT 1
`;

const LATEST_SUCCESSFUL_INDEX_RUN_QUERY = `
SELECT id, status, started_at, finished_at, entity_counts
FROM search.search_index_runs
WHERE status = ${SEARCH_INDEX_RUN_SUCCESSFUL_STATUS_SQL}
ORDER BY finished_at DESC NULLS LAST, id DESC
LIMIT 1
`;

export function deriveSearchIndexFamilyStatus(
    row: Pick<SearchIndexFamilyHealth, "missing" | "ghost" | "stale">,
): SearchIndexHealthStatus {
    return isSearchIndexFamilyUnhealthy(row) ? "unhealthy" : "healthy";
}

export function deriveSearchIndexOverallStatus(
    rows: readonly Pick<SearchIndexFamilyHealth, "missing" | "ghost" | "stale">[],
): SearchIndexHealthStatus {
    return hasSearchIndexHealthIssues(rows) ? "unhealthy" : "healthy";
}

function serializeIndexRun(row: SearchIndexRunRow | undefined): SearchIndexRunSummary | null {
    if (!row) {
        return null;
    }
    return {
        id: String(toHealthCount(row.id)),
        status: row.status,
        started_at: row.started_at.toISOString(),
        finished_at: row.finished_at?.toISOString() ?? null,
        entity_counts: row.entity_counts,
    };
}

export function buildSearchIndexHealthReport(
    rows: readonly SearchIndexFamilyHealth[],
    runs: {
        latest: SearchIndexRunRow | null;
        lastSuccessful: SearchIndexRunRow | null;
    },
    options: {
        health_query_ok?: boolean;
        health_query_error?: string | null;
        now?: Date;
        report_mode?: "full" | "snapshot";
    } = {},
): SearchIndexHealthReport {
    const now = options.now ?? new Date();
    const healthQueryOk = options.health_query_ok ?? true;
    const healthQueryError = options.health_query_error ?? null;
    const reportMode = options.report_mode ?? "full";

    const families: SearchIndexHealthFamilyReport[] = rows.map((row) => {
        const expectedSearchableCount = toHealthCount(row.canonical_count);
        const familySeverity = deriveSearchIndexFamilySeverity(
            {
                missing_count: row.missing,
                ghost_count: row.ghost,
                stale_count: row.stale,
                expected_searchable_count: expectedSearchableCount,
                latest_indexed_at: row.latest_indexed_at,
            },
            now,
        );
        const reasons =
            reportMode === "snapshot"
                ? [
                      ...familySeverity.reasons,
                      "Fast snapshot: missing/ghost estimated from counts; stale not checked. Run health check for exact drift.",
                  ]
                : familySeverity.reasons;

        return {
            entity_family: row.entity_family,
            search_entity_type: row.search_entity_type,
            expected_searchable_count: expectedSearchableCount,
            canonical_count: expectedSearchableCount,
            indexed_count: toHealthCount(row.indexed_count),
            missing_count: row.missing,
            ghost_count: row.ghost,
            stale_count: row.stale,
            latest_indexed_at: row.latest_indexed_at?.toISOString() ?? null,
            latest_source_updated_at: row.latest_source_updated_at?.toISOString() ?? null,
            severity: familySeverity.severity,
            severity_reasons: reasons,
            status: severityToBinaryHealthStatus(familySeverity.severity),
        };
    });

    const totals = families.reduce(
        (acc, row) => ({
            expected_searchable_count: acc.expected_searchable_count + row.expected_searchable_count,
            canonical_count: acc.canonical_count + row.canonical_count,
            indexed_count: acc.indexed_count + row.indexed_count,
            missing_count: acc.missing_count + row.missing_count,
            ghost_count: acc.ghost_count + row.ghost_count,
            stale_count: acc.stale_count + row.stale_count,
        }),
        {
            expected_searchable_count: 0,
            canonical_count: 0,
            indexed_count: 0,
            missing_count: 0,
            ghost_count: 0,
            stale_count: 0,
        },
    );

    const overallSeverity = deriveSearchIndexOverallSeverity(
        {
            family_severities: families.map((family) => family.severity),
            last_rebuild_status: runs.latest?.status ?? null,
            last_successful_rebuild_finished_at: runs.lastSuccessful?.finished_at ?? null,
            health_query_ok: healthQueryOk,
        },
        now,
    );

    return {
        overall_status: severityToBinaryHealthStatus(overallSeverity.severity),
        overall_severity: overallSeverity.severity,
        overall_severity_reasons: healthQueryOk
            ? overallSeverity.reasons
            : ["health query failed"],
        health_query_ok: healthQueryOk,
        health_query_error: healthQueryError,
        report_mode: reportMode,
        totals,
        families,
        last_rebuild_run: serializeIndexRun(runs.latest ?? undefined),
        last_successful_run: serializeIndexRun(runs.lastSuccessful ?? undefined),
    };
}

export function buildFailedSearchIndexHealthReport(
    error: unknown,
    now: Date = new Date(),
): SearchIndexHealthReport {
    const message = error instanceof Error ? error.message : "search index health query failed";
    return buildSearchIndexHealthReport([], { latest: null, lastSuccessful: null }, {
        health_query_ok: false,
        health_query_error: message,
        now,
    });
}

export async function fetchSearchIndexRunMetadata(
    prisma: PrismaClient,
): Promise<{ latest: SearchIndexRunRow | null; lastSuccessful: SearchIndexRunRow | null }> {
    const [latestRows, successRows] = await Promise.all([
        prisma.$queryRawUnsafe<SearchIndexRunRow[]>(LATEST_INDEX_RUN_QUERY),
        prisma.$queryRawUnsafe<SearchIndexRunRow[]>(LATEST_SUCCESSFUL_INDEX_RUN_QUERY),
    ]);
    return {
        latest: latestRows[0] ?? null,
        lastSuccessful: successRows[0] ?? null,
    };
}

/**
 * Fast page-load health: indexed counts first (always quick), then best-effort
 * canonical counts with a short timeout. Missing/ghost are count-diff estimates;
 * stale is always 0. Exact drift requires Run health check / refresh=true.
 */
export async function runSearchIndexHealthSnapshot(
    prisma: PrismaClient,
): Promise<SearchIndexFamilyHealth[]> {
    type IndexedRow = {
        entity_type: string;
        indexed_count: bigint | number;
        latest_indexed_at: Date | null;
    };

    const indexedRows = await prisma.$queryRawUnsafe<IndexedRow[]>(`
        SELECT
            entity_type,
            count(*)::bigint AS indexed_count,
            max(indexed_at) AS latest_indexed_at
        FROM search.search_documents
        WHERE is_public = true
          AND is_active = true
        GROUP BY entity_type
    `);
    const indexedByType = new Map(
        indexedRows.map((row) => [
            row.entity_type,
            {
                indexed_count: toHealthCount(row.indexed_count),
                latest_indexed_at: row.latest_indexed_at,
            },
        ]),
    );

    const concurrency = 3;
    const familyRows: SearchIndexHealthRow[] = new Array(SEARCH_INDEX_HEALTH_FAMILY_SPECS.length);
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= SEARCH_INDEX_HEALTH_FAMILY_SPECS.length) {
                return;
            }
            const spec = SEARCH_INDEX_HEALTH_FAMILY_SPECS[index]!;
            const indexed = indexedByType.get(spec.searchEntityType) ?? {
                indexed_count: 0,
                latest_indexed_at: null,
            };

            let canonicalCount = indexed.indexed_count;
            try {
                const filterSource =
                    "filterSourceEntityType" in spec && spec.filterSourceEntityType === true;
                const canonicalSql = filterSource
                    ? `SELECT count(*)::bigint AS n FROM ${spec.sourceView} WHERE entity_type = '${spec.searchEntityType}'`
                    : `SELECT count(*)::bigint AS n FROM ${spec.sourceView}`;
                const rows = await prisma.$transaction(
                    async (tx) => {
                        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '20s'");
                        return tx.$queryRawUnsafe<Array<{ n: bigint | number }>>(canonicalSql);
                    },
                    { timeout: 25_000, maxWait: 10_000 },
                );
                canonicalCount = toHealthCount(rows[0]?.n ?? 0);
            } catch {
                // Keep indexed-only row when a large source view times out.
                canonicalCount = indexed.indexed_count;
            }

            const missing = Math.max(0, canonicalCount - indexed.indexed_count);
            const ghost = Math.max(0, indexed.indexed_count - canonicalCount);
            familyRows[index] = {
                entity_family: spec.entityFamily,
                search_entity_type: spec.searchEntityType,
                canonical_count: canonicalCount,
                indexed_count: indexed.indexed_count,
                missing_count: missing,
                ghost_count: ghost,
                stale_count: 0,
                latest_indexed_at: indexed.latest_indexed_at,
                latest_source_updated_at: null,
            };
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(concurrency, SEARCH_INDEX_HEALTH_FAMILY_SPECS.length) }, () =>
            worker(),
        ),
    );

    return familyRows
        .map(normalizeSearchIndexHealthRow)
        .sort((a, b) => a.entity_family.localeCompare(b.entity_family));
}

export async function loadSearchIndexHealthReportUncached(
    prisma: PrismaClient,
): Promise<SearchIndexHealthReport> {
    try {
        const [rows, runs] = await Promise.all([
            runSearchIndexHealthCheck(prisma),
            fetchSearchIndexRunMetadata(prisma),
        ]);
        return buildSearchIndexHealthReport(rows, runs, { report_mode: "full" });
    } catch (error) {
        return buildFailedSearchIndexHealthReport(error);
    }
}

export async function loadSearchIndexHealthSnapshotReport(
    prisma: PrismaClient,
): Promise<SearchIndexHealthReport> {
    try {
        const [rows, runs] = await Promise.all([
            runSearchIndexHealthSnapshot(prisma),
            fetchSearchIndexRunMetadata(prisma),
        ]);
        return buildSearchIndexHealthReport(rows, runs, { report_mode: "snapshot" });
    } catch (error) {
        return buildFailedSearchIndexHealthReport(error);
    }
}

export type SearchIndexHealthReportOptions = {
    /** Bypass cache and run exact full reconciliation (slow). */
    refresh?: boolean;
};

export async function getSearchIndexHealthReport(
    prisma: PrismaClient,
    options: SearchIndexHealthReportOptions = {},
): Promise<SearchIndexHealthReport> {
    if (options.refresh) {
        // Full reconciliation is intentional and slow — never serve snapshot here.
        return getCachedSearchIndexHealthReport(
            () => loadSearchIndexHealthReportUncached(prisma),
            { refresh: true, requireFresh: true },
        );
    }

    const cached = peekSearchIndexHealthCache(Date.now(), { allowStale: true });
    if (cached && cached.report_mode === "full") {
        return getCachedSearchIndexHealthReport(
            () => loadSearchIndexHealthReportUncached(prisma),
            { refresh: false },
        );
    }

    // Default page load: fast count snapshot so the dashboard never times out.
    return loadSearchIndexHealthSnapshotReport(prisma);
}

export type SearchIndexHealthSeveritySummary = Pick<
    SearchIndexHealthReport,
    "overall_severity" | "overall_status" | "health_query_ok"
>;

/**
 * Lightweight overview helper. Reuse a full reconciliation when one is cached;
 * otherwise derive a conservative status from rebuild metadata only. The search
 * overview must not materialize every canonical geospatial view on first load.
 */
export async function getSearchIndexHealthSeveritySummary(
    prisma: PrismaClient,
): Promise<SearchIndexHealthSeveritySummary> {
    const cached = peekSearchIndexHealthCache(Date.now(), { allowStale: true });
    if (cached) {
        return {
            overall_severity: cached.overall_severity,
            overall_status: cached.overall_status,
            health_query_ok: cached.health_query_ok,
        };
    }

    const runs = await fetchSearchIndexRunMetadata(prisma);
    const summary = deriveSearchIndexOverallSeverity({
        family_severities: [],
        last_rebuild_status: runs.latest?.status ?? null,
        last_successful_rebuild_finished_at: runs.lastSuccessful?.finished_at ?? null,
        health_query_ok: true,
    });
    return {
        overall_severity: summary.severity,
        overall_status: severityToBinaryHealthStatus(summary.severity),
        health_query_ok: true,
    };
}

export { clearSearchIndexHealthCache };

export function printSearchIndexHealthTable(rows: readonly SearchIndexFamilyHealth[]): void {
    const headers = [
        "entity_family",
        "search_entity_type",
        "canonical",
        "indexed",
        "missing",
        "ghost",
        "stale",
        "latest_indexed_at",
        "latest_source_updated_at",
    ];

    const body = rows.map((row) => [
        row.entity_family,
        row.search_entity_type,
        String(toHealthCount(row.canonical_count)),
        String(toHealthCount(row.indexed_count)),
        String(row.missing),
        String(row.ghost),
        String(row.stale),
        formatSearchHealthTimestamp(row.latest_indexed_at),
        formatSearchHealthTimestamp(row.latest_source_updated_at),
    ]);

    const widths = headers.map((header, index) =>
        Math.max(header.length, ...body.map((line) => line[index]?.length ?? 0)),
    );

    const formatLine = (cells: string[]) =>
        cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  ");

    console.log(formatLine(headers));
    console.log(widths.map((width) => "-".repeat(width)).join("  "));
    for (const line of body) {
        console.log(formatLine(line));
    }
}
