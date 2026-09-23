/**
 * Unified search index health check and optional targeted repair.
 *
 * Default: read-only health report (no mutations).
 * With --repair: rebuild critical missing/ghost gaps, then re-check.
 * Skips heavy families (settlements, street_groups) unless gap ≥ 100 or --include-heavy.
 *
 * Usage (from repo root / apps/api):
 *   npm run search:health
 *   npm run search:reconcile
 *   npm run search:reconcile -- --repair
 *   npm run search:reconcile -- --repair --families=admin_areas
 *   npm run search:reconcile -- --repair --include-stale
 *   npm run search:reconcile -- --repair --include-heavy
 *   npm run search:reconcile -- --repair --families=admin_areas,places
 */

import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, "../..");
const repoRoot = resolve(apiRoot, "../..");
config({ path: resolve(repoRoot, ".env") });
config({ path: resolve(apiRoot, ".env"), override: true });

import { prisma } from "../db/prisma.js";
import {
    hasSearchIndexHealthIssues,
    isAllowlistedSearchIndexHealthFamily,
    isSearchIndexFamilyCriticallyUnhealthy,
    isSearchIndexFamilyUnhealthy,
    printSearchIndexHealthTable,
    runSearchIndexHealthCheck,
    type SearchIndexFamilyHealth,
} from "../modules/search/search-index-health.js";
import { repairUnhealthySearchIndexFamilies } from "../modules/search/search-index-maintenance.service.js";

const SQL_PATH = resolve(
    repoRoot,
    "infrastructure/database/verification/verify_search_index_health.sql",
);

function readRepairFlag(): boolean {
    return process.argv.includes("--repair");
}

/** Critical-only is the default. Pass --include-stale to also rebuild stale-only drift. */
function readCriticalOnlyFlag(): boolean {
    if (process.argv.includes("--include-stale") || process.argv.includes("--all-unhealthy")) {
        return false;
    }
    // --critical-only kept for backwards compatibility (explicit no-op).
    return true;
}

function readIncludeHeavyFlag(): boolean {
    return process.argv.includes("--include-heavy");
}

/** Parse `--families=a,b` or `--families a,b`. */
function readFamiliesFlag(): string[] | null {
    const eqArg = process.argv.find((arg) => arg.startsWith("--families="));
    if (eqArg) {
        return eqArg
            .slice("--families=".length)
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean);
    }
    const idx = process.argv.indexOf("--families");
    if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")) {
        return process.argv[idx + 1]
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean);
    }
    return null;
}

function logFamilySummary(
    prefix: string,
    rows: readonly SearchIndexFamilyHealth[],
    repairedByFamily?: ReadonlyMap<string, boolean>,
): void {
    for (const row of rows) {
        const repaired = repairedByFamily?.get(row.entity_family) ?? false;
        console.log(
            `${prefix} family=${row.entity_family} missing=${row.missing} ghost=${row.ghost} stale=${row.stale} repaired=${repaired}`,
        );
    }
}

async function main(): Promise<void> {
    const repair = readRepairFlag();
    const criticalOnly = readCriticalOnlyFlag();
    const includeHeavy = readIncludeHeavyFlag();
    const families = readFamiliesFlag();
    const startedAt = Date.now();

    readFileSync(SQL_PATH, "utf8");

    if (families != null) {
        const invalid = families.filter((f) => !isAllowlistedSearchIndexHealthFamily(f));
        if (invalid.length > 0) {
            console.error(
                `[search-reconcile] unknown --families value(s): ${invalid.join(", ")}. ` +
                    `Allowed: admin_areas, places, settlements, street_groups, …`,
            );
            process.exitCode = 1;
            return;
        }
    }

    const modeParts = [
        repair ? "repair" : "check-only",
        criticalOnly ? "critical-only" : "include-stale",
        includeHeavy ? "include-heavy" : null,
        families != null ? `families=${families.join(",")}` : null,
    ].filter(Boolean);
    console.log(`[search-reconcile] mode=${modeParts.join(" ")}`);
    console.log(`[search-reconcile] sql=${SQL_PATH}`);

    if (!repair) {
        const before = await runSearchIndexHealthCheck(prisma);
        const scoped =
            families != null ? before.filter((row) => families.includes(row.entity_family)) : before;
        console.log("\n=== search_index_health ===\n");
        printSearchIndexHealthTable(scoped);
        logFamilySummary("[search-reconcile]", scoped);

        const needsWork = criticalOnly
            ? scoped.filter(isSearchIndexFamilyCriticallyUnhealthy)
            : scoped.filter(isSearchIndexFamilyUnhealthy);
        const duration_ms = Date.now() - startedAt;
        if (needsWork.length === 0) {
            console.log(`\n[search-reconcile] all selected families healthy duration_ms=${duration_ms}`);
            return;
        }

        console.error(
            `\n[search-reconcile] unhealthy families=${needsWork.length} duration_ms=${duration_ms} (pass --repair to rebuild)`,
        );
        process.exitCode = 1;
        return;
    }

    const repairStartedAt = Date.now();
    const outcome = await repairUnhealthySearchIndexFamilies(
        prisma,
        {
            info: (obj, msg) => console.log(`[search-reconcile] ${msg}`, obj),
            error: (obj, msg) => console.error(`[search-reconcile] ${msg}`, obj),
        },
        {
            families: families ?? undefined,
            criticalOnly,
            includeHeavy,
        },
    );
    const repairDuration_ms = Date.now() - repairStartedAt;

    console.log("\n=== search_index_health ===\n");
    printSearchIndexHealthTable(outcome.before);
    logFamilySummary("[search-reconcile]", outcome.before);

    if (outcome.skippedHeavyFamilies.length > 0) {
        console.log(
            `[search-reconcile] skipped_heavy=${outcome.skippedHeavyFamilies.join(",")} ` +
                `(pass --include-heavy or --families=<name> with Reindex family)`,
        );
    }

    if (outcome.skipped) {
        const duration_ms = Date.now() - startedAt;
        console.log(`\n[search-reconcile] nothing to repair duration_ms=${duration_ms}`);
        return;
    }

    console.log(`\n[search-reconcile] rebuilding views=${outcome.rebuildViews.join(",")}`);

    console.log("\n=== search_index_health_after_repair ===\n");
    printSearchIndexHealthTable(outcome.after);
    logFamilySummary("[search-reconcile]", outcome.after, outcome.repairedByFamily);

    const duration_ms = Date.now() - startedAt;
    const stillUnhealthy = outcome.after.filter(
        criticalOnly ? isSearchIndexFamilyCriticallyUnhealthy : isSearchIndexFamilyUnhealthy,
    ).length;
    const repairedCount = [...outcome.repairedByFamily.values()].filter(Boolean).length;

    console.log(
        `\n[search-reconcile] repair_views=${outcome.rebuildViews.join(",")} ` +
            `repair_duration_ms=${repairDuration_ms} ` +
            `rebuild_success=${outcome.rebuild?.success ?? false} ` +
            `families_repaired=${repairedCount} ` +
            `still_unhealthy=${stillUnhealthy} ` +
            `duration_ms=${duration_ms}`,
    );

    if (
        (criticalOnly
            ? outcome.after.some(isSearchIndexFamilyCriticallyUnhealthy)
            : hasSearchIndexHealthIssues(outcome.after)) ||
        outcome.rebuild?.success === false
    ) {
        process.exitCode = 1;
    }
}

main()
    .catch((err) => {
        console.error("[search-reconcile] Failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
