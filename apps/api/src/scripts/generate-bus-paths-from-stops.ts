/**
 * Generate Valhalla-snapped route paths for every bus route variant.
 *
 * Uses the same TransportService.generatePathFromStops path as
 * POST /transport/route-variants/:publicId/generate-path-from-stops.
 *
 * Usage (from repo root):
 *   npm --prefix apps/api run transport:generate-bus-paths
 *   npm --prefix apps/api run transport:generate-bus-paths -- --apply
 *   npm --prefix apps/api run transport:generate-bus-paths -- --apply --limit 1
 *
 * --apply  write paths
 * --force  also regenerate verified Valhalla paths (otherwise skip those)
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(apiRoot, "../..");
config({ path: resolve(repoRoot, ".env") });
config({ path: resolve(apiRoot, ".env"), override: true });

import { prisma } from "../db/prisma.js";
import { TransportService } from "../modules/transport/transport.service.js";
import { TransportGeneratePathFromStopsError } from "../modules/transport/transport.errors.js";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

function readIntFlag(name: string): number | null {
    const index = process.argv.indexOf(name);
    if (index === -1) {
        return null;
    }
    const raw = process.argv[index + 1];
    const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(value) && value >= 0 ? value : null;
}

const LIMIT = readIntFlag("--limit");
const OFFSET = readIntFlag("--offset") ?? 0;

type VariantCandidate = {
    route_public_id: string;
    route_code: string;
    route_review_status: string;
    variant_public_id: string;
    variant_code: string | null;
    direction_name: string | null;
    stop_count: number;
    path_kind: string | null;
    path_review_status: string | null;
};

function skipReason(row: VariantCandidate): string | null {
    if (row.stop_count < 2) {
        return "fewer than 2 stops";
    }
    if (!FORCE && row.path_kind === "valhalla_snapped" && row.path_review_status === "verified") {
        return "verified Valhalla path (use --force to overwrite)";
    }
    return null;
}

async function listCandidates(): Promise<VariantCandidate[]> {
    return prisma.$queryRaw<VariantCandidate[]>`
        SELECT
            r.public_id::text AS route_public_id,
            r.route_code,
            r.review_status AS route_review_status,
            v.public_id::text AS variant_public_id,
            v.variant_code,
            v.direction_name,
            (
                SELECT count(*)::int
                FROM transport.route_stops rs
                JOIN transport.stops s ON s.id = rs.stop_id AND s.deleted_at IS NULL
                WHERE rs.route_variant_id = v.id
            ) AS stop_count,
            p.path_kind,
            p.review_status AS path_review_status
        FROM transport.routes r
        JOIN transport.route_variants v
            ON v.route_id = r.id AND v.deleted_at IS NULL
        LEFT JOIN LATERAL (
            SELECT path_kind, review_status
            FROM transport.route_paths
            WHERE route_variant_id = v.id AND deleted_at IS NULL
            ORDER BY id ASC
            LIMIT 1
        ) p ON true
        WHERE r.deleted_at IS NULL
          AND r.mode = 'bus'
          AND r.review_status IS DISTINCT FROM 'rejected'
        ORDER BY r.route_code, v.variant_code, v.id
    `;
}

async function printSummary(rows: VariantCandidate[]): Promise<void> {
    const byPathKind = new Map<string, number>();
    const skipCounts = new Map<string, number>();
    let eligible = 0;

    for (const row of rows) {
        const kind = row.path_kind ?? "(no path)";
        byPathKind.set(kind, (byPathKind.get(kind) ?? 0) + 1);
        const skip = skipReason(row);
        if (skip) {
            skipCounts.set(skip, (skipCounts.get(skip) ?? 0) + 1);
        } else {
            eligible += 1;
        }
    }

    const routeCodes = new Set(rows.map((row) => row.route_code));
    console.log(`[generate-bus-paths] ${APPLY ? "APPLY" : "DRY-RUN"}${FORCE ? " --force" : ""}`);
    console.log(`[generate-bus-paths] Bus numbers (route_code): ${routeCodes.size}`);
    console.log(`[generate-bus-paths] Variants: ${rows.length}`);
    console.log(`[generate-bus-paths] Eligible to generate: ${eligible}`);
    console.log("[generate-bus-paths] Path kind:");
    for (const [kind, count] of [...byPathKind.entries()].sort()) {
        console.log(`  ${kind}: ${count}`);
    }
    if (skipCounts.size > 0) {
        console.log("[generate-bus-paths] Skipped:");
        for (const [reason, count] of [...skipCounts.entries()].sort()) {
            console.log(`  ${reason}: ${count}`);
        }
    }
}

async function main(): Promise<void> {
    const rows = await listCandidates();
    await printSummary(rows);

    const work = rows.filter((row) => skipReason(row) === null).slice(OFFSET, LIMIT === null ? undefined : OFFSET + LIMIT);
    console.log(`[generate-bus-paths] This run: ${work.length} variant(s) (offset=${OFFSET}${LIMIT === null ? "" : `, limit=${LIMIT}`})`);
    if (!APPLY) {
        for (const row of work.slice(0, 12)) {
            console.log(
                `  ${row.route_code} ${row.variant_code ?? "?"} stops=${row.stop_count} path=${row.path_kind ?? "none"}`,
            );
        }
        if (work.length > 12) {
            console.log(`  ... ${work.length - 12} more eligible variants`);
        }
        console.log("[generate-bus-paths] Re-run with --apply to write paths.");
        return;
    }

    const service = new TransportService(prisma);
    const audit = {
        actorUserId: null,
        requestId: `generate-bus-paths-${randomUUID()}`,
    };

    let ok = 0;
    let failed = 0;
    const failures: string[] = [];

    for (let index = 0; index < work.length; index++) {
        const row = work[index]!;
        const label = `${row.route_code} ${row.variant_code ?? row.variant_public_id}`;
        process.stdout.write(
            `[generate-bus-paths] ${index + 1}/${work.length} ${label} (${row.stop_count} stops)... `,
        );
        try {
            const result = await service.generatePathFromStops(row.variant_public_id, audit);
            const warningCount = result.warnings.length;
            console.log(
                `ok path_kind=${result.path_kind} distance_m=${result.distance_m ?? "n/a"} warnings=${warningCount}`,
            );
            ok += 1;
        } catch (error) {
            failed += 1;
            const message =
                error instanceof TransportGeneratePathFromStopsError || error instanceof Error
                    ? error.message
                    : String(error);
            console.log(`FAIL ${message}`);
            failures.push(`${label}: ${message}`);
        }
    }

    console.log(`[generate-bus-paths] Done. ok=${ok} failed=${failed}`);
    if (failures.length > 0) {
        console.log("[generate-bus-paths] Failures:");
        for (const line of failures) {
            console.log(`  ${line}`);
        }
    }
}

main()
    .catch((error) => {
        console.error("[generate-bus-paths] Fatal:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
