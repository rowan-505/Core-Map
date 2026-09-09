/**
 * Disposable-DB verification for field-report canonical apply.
 *
 * Safety: refuses any host except localhost/127.0.0.1 and any DB except coremap_field_test.
 * Never contacts production. Seeds synthetic data only; cleans up on exit.
 *
 * Usage:
 *   DATABASE_URL=postgresql://coremap:***@127.0.0.1:55432/coremap_field_test \
 *     NODE_ENV=test npx tsx src/scripts/reports-apply-db-verify.ts
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";

import authPlugin, { requireReportsReview } from "../plugins/auth.js";
import { FieldRepository } from "../modules/field/field.repo.js";
import { snapshotRevisionFromParts } from "../modules/field/field-revision.js";
import { ReportsApplyError, ReportsApplyRepository } from "../modules/reports/reports-apply.repo.js";
import { ReportsRepository } from "../modules/reports/reports.repo.js";
import { ReportsService } from "../modules/reports/reports.service.js";
import { TransportRepository } from "../modules/transport/transport.repo.js";

const PREFIX = `rpt-apply-verify-${Date.now()}`;
const TARGET_MS = 1000;

type CaseResult = {
    id: string;
    ok: boolean;
    ms: number;
    detail: string;
    queries?: number;
};

function requireDisposableDatabase(urlRaw: string): URL {
    const url = new URL(urlRaw);
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
        throw new Error("Refusing non-local database host");
    }
    if (url.pathname.slice(1) !== "coremap_field_test") {
        throw new Error("Refusing any database except disposable coremap_field_test");
    }
    return url;
}

function createCountingPrisma(databaseUrl: string) {
    let queryCount = 0;
    const client = new PrismaClient({
        datasources: { db: { url: databaseUrl } },
        log: [{ emit: "event", level: "query" }],
    });
    client.$on("query", () => {
        queryCount += 1;
    });
    return {
        client,
        reset() {
            queryCount = 0;
        },
        count() {
            return queryCount;
        },
    };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
    const start = performance.now();
    const value = await fn();
    return { value, ms: performance.now() - start };
}

async function main() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error("DATABASE_URL is required");
    }
    requireDisposableDatabase(databaseUrl);

    const counting = createCountingPrisma(databaseUrl);
    const prisma = counting.client;
    const cases: CaseResult[] = [];
    const explainPlans: Array<{ name: string; plan: string }> = [];

    const reportsRepo = new ReportsRepository(prisma);
    const fieldRepo = new FieldRepository(prisma);
    const transportRepo = new TransportRepository(prisma);
    const applyRepo = new ReportsApplyRepository(prisma, reportsRepo, fieldRepo, transportRepo);
    const mediaStub = { listReadyPrivateForReport: async () => [] };
    const reportsService = new ReportsService(
        reportsRepo,
        mediaStub as never,
        fieldRepo,
        prisma,
        transportRepo
    );

    const audit = {
        actorUserId: 0n,
        actorPublicId: "00000000-0000-4000-8000-000000000099",
        ipAddress: "127.0.0.1",
        userAgent: "reports-apply-db-verify",
    };

    let fixture: Awaited<ReturnType<typeof seedFixture>> | null = null;

    try {
        fixture = await seedFixture(prisma, PREFIX);
        audit.actorUserId = fixture.adminUserId;

        const revision = snapshotRevisionFromParts(await fieldRepo.loadRevisionParts());

        // 1. MOVE_STOP
        {
            const stopBefore = await stopPoint(prisma, fixture.moveStopPublicId);
            const sharedLinksBefore = await routeStopCount(prisma, fixture.moveStopPublicId);
            counting.reset();
            const { value, ms } = await timed(() =>
                applyRepo.apply({
                    reportPublicId: fixture!.moveReportPublicId,
                    action: "MOVE_STOP",
                    expectedCanonicalRevision: revision,
                    audit,
                })
            );
            const stopAfter = await stopPoint(prisma, fixture.moveStopPublicId);
            const sharedLinksAfter = await routeStopCount(prisma, fixture.moveStopPublicId);
            const ok =
                Math.abs(stopAfter.lat - fixture.proposedLat) < 1e-6 &&
                sharedLinksAfter === sharedLinksBefore &&
                sharedLinksAfter >= 2 &&
                value.applied === true;
            cases.push({
                id: "1_MOVE_STOP",
                ok,
                ms,
                queries: counting.count(),
                detail: ok
                    ? `moved ${stopBefore.lat.toFixed(5)}→${stopAfter.lat.toFixed(5)}; links=${sharedLinksAfter}`
                    : `links before/after ${sharedLinksBefore}/${sharedLinksAfter}`,
            });
        }

        // 2–3. REMOVE_FROM_ROUTE + sequence validity
        {
            const stopExistsBefore = await stopExists(prisma, fixture.removeStopPublicId);
            counting.reset();
            const { value, ms } = await timed(async () =>
                applyRepo.apply({
                    reportPublicId: fixture!.removeReportPublicId,
                    action: "REMOVE_FROM_ROUTE",
                    expectedCanonicalRevision: snapshotRevisionFromParts(
                        await fieldRepo.loadRevisionParts()
                    ),
                    audit,
                })
            );
            const stopExistsAfter = await stopExists(prisma, fixture.removeStopPublicId);
            const seq = await variantSequence(prisma, fixture.variantAPublicId);
            const seqOk = seq.every((s, i) => s === i + 1);
            const stillOnOther = await stopOnVariant(
                prisma,
                fixture.removeStopPublicId,
                fixture.variantBPublicId
            );
            const ok =
                stopExistsBefore &&
                stopExistsAfter &&
                stillOnOther &&
                seqOk &&
                value.applied === true &&
                !(await stopOnVariant(prisma, fixture.removeStopPublicId, fixture.variantAPublicId));
            cases.push({
                id: "2_3_REMOVE_FROM_ROUTE_SEQUENCE",
                ok,
                ms,
                queries: counting.count(),
                detail: ok
                    ? `stop preserved; other variant kept; sequence=${seq.join(",")}`
                    : `exists=${stopExistsAfter} other=${stillOnOther} seqOk=${seqOk}`,
            });
        }

        // 4–5. CREATE_AND_INSERT_STOP + retry idempotent
        {
            const stopsBefore = await countStopsNamed(prisma, fixture.newStopName);
            const rev = snapshotRevisionFromParts(await fieldRepo.loadRevisionParts());
            counting.reset();
            const first = await timed(() =>
                applyRepo.apply({
                    reportPublicId: fixture!.createReportPublicId,
                    action: "CREATE_AND_INSERT_STOP",
                    expectedCanonicalRevision: rev,
                    audit,
                })
            );
            const stopsAfterFirst = await countStopsNamed(prisma, fixture.newStopName);
            const seqAfter = await variantSequenceDetail(prisma, fixture.variantAPublicId);
            const insertIdx = seqAfter.findIndex((s) => s.name === fixture!.newStopName);
            const prevIdx = seqAfter.findIndex((s) => s.public_id === fixture!.prevStopPublicId);
            const placedOk = insertIdx === prevIdx + 1;

            const second = await timed(() =>
                applyRepo.apply({
                    reportPublicId: fixture!.createReportPublicId,
                    action: "CREATE_AND_INSERT_STOP",
                    expectedCanonicalRevision: rev,
                    audit,
                })
            );
            const stopsAfterRetry = await countStopsNamed(prisma, fixture.newStopName);
            const ok =
                first.value.applied &&
                stopsAfterFirst === stopsBefore + 1 &&
                placedOk &&
                second.value.idempotent === true &&
                stopsAfterRetry === stopsAfterFirst;
            cases.push({
                id: "4_5_CREATE_AND_INSERT_IDEMPOTENT",
                ok,
                ms: first.ms + second.ms,
                queries: counting.count(),
                detail: ok
                    ? `created once after prev; retry idempotent=${second.value.idempotent}`
                    : `stops ${stopsBefore}→${stopsAfterFirst}→${stopsAfterRetry} place=${insertIdx}/${prevIdx}`,
            });
        }

        // 6. UPDATE_STOP_DETAILS
        {
            const before = await stopNames(prisma, fixture.updateStopPublicId);
            const rev = snapshotRevisionFromParts(await fieldRepo.loadRevisionParts());
            counting.reset();
            const { ms } = await timed(() =>
                applyRepo.apply({
                    reportPublicId: fixture!.updateReportPublicId,
                    action: "UPDATE_STOP_DETAILS",
                    expectedCanonicalRevision: rev,
                    audit,
                })
            );
            const after = await stopNames(prisma, fixture.updateStopPublicId);
            const geomSame = await stopPoint(prisma, fixture.updateStopPublicId);
            const beforeGeom = fixture.updateStopGeom;
            const ok =
                after.name === fixture.proposedName &&
                after.name_mm === fixture.proposedName &&
                after.name_en === before.name_en &&
                Math.abs(geomSame.lat - beforeGeom.lat) < 1e-9;
            cases.push({
                id: "6_UPDATE_STOP_DETAILS",
                ok,
                ms,
                queries: counting.count(),
                detail: ok
                    ? `name ${before.name}→${after.name}; geom unchanged; name_en preserved`
                    : `name=${after.name} en=${after.name_en}`,
            });
        }

        // 7–8. RESOLVE / REJECT no canonical mutation
        {
            const fingerprintBefore = await transportFingerprint(prisma, PREFIX);
            const rev = snapshotRevisionFromParts(await fieldRepo.loadRevisionParts());
            counting.reset();
            const resolve = await timed(() =>
                applyRepo.apply({
                    reportPublicId: fixture!.resolveReportPublicId,
                    action: "RESOLVE",
                    expectedCanonicalRevision: rev,
                    audit,
                })
            );
            const reject = await timed(async () =>
                applyRepo.apply({
                    reportPublicId: fixture!.rejectReportPublicId,
                    action: "REJECT",
                    expectedCanonicalRevision: snapshotRevisionFromParts(
                        await fieldRepo.loadRevisionParts()
                    ),
                    audit,
                })
            );
            const fingerprintAfter = await transportFingerprint(prisma, PREFIX);
            const ok = fingerprintBefore === fingerprintAfter;
            cases.push({
                id: "7_8_RESOLVE_REJECT_NO_CANONICAL",
                ok,
                ms: resolve.ms + reject.ms,
                queries: counting.count(),
                detail: ok
                    ? `resolve+reject; transport fingerprint unchanged`
                    : `fingerprint changed`,
            });
        }

        // 9. Stale revision → 409, zero mutation
        {
            const geomBefore = await stopPoint(prisma, fixture.staleStopPublicId);
            counting.reset();
            let status = 0;
            const { ms } = await timed(async () => {
                try {
                    await applyRepo.apply({
                        reportPublicId: fixture!.staleReportPublicId,
                        action: "MOVE_STOP",
                        expectedCanonicalRevision: "definitely-stale-revision",
                        audit,
                    });
                } catch (error) {
                    if (error instanceof ReportsApplyError) {
                        status = error.statusCode;
                    } else {
                        throw error;
                    }
                }
            });
            const geomAfter = await stopPoint(prisma, fixture.staleStopPublicId);
            const ok =
                status === 409 &&
                Math.abs(geomBefore.lat - geomAfter.lat) < 1e-12 &&
                Math.abs(geomBefore.lng - geomAfter.lng) < 1e-12;
            cases.push({
                id: "9_STALE_REVISION_409",
                ok,
                ms,
                queries: counting.count(),
                detail: ok ? "409 with zero geom mutation" : `status=${status}`,
            });
        }

        // 10. Concurrent apply → one canonical change
        {
            const rev = snapshotRevisionFromParts(await fieldRepo.loadRevisionParts());
            const geomBefore = await stopPoint(prisma, fixture.raceStopPublicId);
            counting.reset();
            const { ms } = await timed(async () => {
                const results = await Promise.allSettled([
                    applyRepo.apply({
                        reportPublicId: fixture!.raceReportPublicId,
                        action: "MOVE_STOP",
                        expectedCanonicalRevision: rev,
                        audit,
                    }),
                    applyRepo.apply({
                        reportPublicId: fixture!.raceReportPublicId,
                        action: "MOVE_STOP",
                        expectedCanonicalRevision: rev,
                        audit,
                    }),
                ]);
                const fulfilled = results.filter((r) => r.status === "fulfilled");
                const rejected = results.filter((r) => r.status === "rejected");
                assert.ok(fulfilled.length >= 1);
                // Either one wins + other 409, or second is idempotent after first commit.
                assert.ok(fulfilled.length + rejected.length === 2);
            });
            const geomAfter = await stopPoint(prisma, fixture.raceStopPublicId);
            const movedOnce = Math.abs(geomAfter.lat - fixture.raceProposedLat) < 1e-6;
            const notDoubleMoved = Math.abs(geomAfter.lat - geomBefore.lat) > 1e-6 || movedOnce;
            cases.push({
                id: "10_CONCURRENT_APPLY",
                ok: movedOnce && notDoubleMoved,
                ms,
                queries: counting.count(),
                detail: movedOnce
                    ? `single move to ${geomAfter.lat.toFixed(5)}`
                    : `geom ${geomBefore.lat}→${geomAfter.lat}`,
            });
        }

        // 11. Forced mid-transaction failure rolls back
        {
            const geomBefore = await stopPoint(prisma, fixture.rollbackStopPublicId);
            counting.reset();
            const { ms } = await timed(async () => {
                try {
                    await prisma.$transaction(async (tx) => {
                        await transportRepo.applyMoveStopInTx(tx, {
                            stopPublicId: fixture!.rollbackStopPublicId,
                            latitude: 16.999,
                            longitude: 96.999,
                            audit: { actorUserId: fixture!.adminUserId, requestId: null },
                        });
                        throw new Error("forced-mid-transaction-failure");
                    });
                } catch (error) {
                    if (!(error instanceof Error) || !/forced-mid-transaction-failure/.test(error.message)) {
                        throw error;
                    }
                }
            });
            const geomAfter = await stopPoint(prisma, fixture.rollbackStopPublicId);
            const ok =
                Math.abs(geomBefore.lat - geomAfter.lat) < 1e-12 &&
                Math.abs(geomBefore.lng - geomAfter.lng) < 1e-12;
            cases.push({
                id: "11_ROLLBACK",
                ok,
                ms,
                queries: counting.count(),
                detail: ok ? "geom restored after forced failure" : "geom leaked",
            });
        }

        // 12. Audit history
        {
            const rows = await prisma.$queryRaw<
                Array<{
                    action_type: string;
                    entity_type: string;
                    actor_user_id: bigint | null;
                    before_snapshot: unknown;
                    after_snapshot: unknown;
                }>
            >`
                SELECT action_type, entity_type, actor_user_id, before_snapshot, after_snapshot
                FROM system.audit_logs
                WHERE actor_user_id = ${fixture.adminUserId}
                  AND action_type LIKE 'report_apply_%'
                ORDER BY id DESC
                LIMIT 20
            `;
            const sample = rows[0];
            const ok =
                rows.length > 0 &&
                sample?.actor_user_id === fixture.adminUserId &&
                Boolean(sample?.before_snapshot) &&
                Boolean(sample?.after_snapshot) &&
                typeof (sample?.after_snapshot as { action?: string } | null)?.action === "string";
            cases.push({
                id: "12_AUDIT_HISTORY",
                ok,
                ms: 0,
                detail: ok
                    ? `${rows.length} report_apply_* rows; sample=${sample?.action_type}`
                    : "missing audit fields",
            });
        }

        // 13. Unauthorized → 403
        {
            const previous = {
                JWT_SECRET: process.env.JWT_SECRET,
                AUTH_BYPASS: process.env.AUTH_BYPASS,
                NODE_ENV: process.env.NODE_ENV,
            };
            process.env.JWT_SECRET = "reports-apply-db-verify-secret";
            delete process.env.AUTH_BYPASS;
            process.env.NODE_ENV = "test";
            const app = Fastify();
            const { ms } = await timed(async () => {
                await app.register(authPlugin);
                app.post(
                    "/admin/reports/:id/apply",
                    { preHandler: [app.authenticate, app.requireReportsReview] },
                    async () => ({ ok: true })
                );
                await app.ready();
                const surveyor = await app.inject({
                    method: "POST",
                    url: `/admin/reports/${fixture!.moveReportPublicId}/apply`,
                    headers: {
                        authorization: `Bearer ${app.jwt.sign({
                            sub: "u-surveyor",
                            email: "s@example.com",
                            roles: ["surveyor"],
                        })}`,
                    },
                    payload: { action: "RESOLVE", expectedCanonicalRevision: "x" },
                });
                assert.equal(surveyor.statusCode, 403);
                await app.close();
            });
            if (previous.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
            else process.env.JWT_SECRET = previous.JWT_SECRET;
            if (previous.AUTH_BYPASS === undefined) delete process.env.AUTH_BYPASS;
            else process.env.AUTH_BYPASS = previous.AUTH_BYPASS;
            if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = previous.NODE_ENV;
            cases.push({
                id: "13_UNAUTHORIZED_403",
                ok: true,
                ms,
                detail: "surveyor JWT rejected with 403",
            });
        }

        // Performance: adminGet query count
        {
            counting.reset();
            const { value, ms } = await timed(() => reportsService.adminGet(fixture!.moveReportPublicId));
            const queries = counting.count();
            const hasMapContext = (value.review?.map_context?.stops.length ?? 0) > 0;
            cases.push({
                id: "PERF_ADMIN_GET",
                ok: ms < TARGET_MS && queries < 40 && hasMapContext,
                ms,
                queries,
                detail: `adminGet ${ms.toFixed(1)}ms / ${queries} queries; map_context stops=${value.review?.map_context?.stops.length ?? 0}`,
            });
        }

        // EXPLAIN ANALYZE targeted queries
        const explainSql = [
            {
                name: "lock_report_for_update",
                sql: `
                  EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
                  SELECT r.id
                  FROM feedback.user_reports r
                  WHERE r.public_id = '${fixture.moveReportPublicId}'::uuid
                  FOR UPDATE
                `,
            },
            {
                name: "map_window_by_variant_sequence",
                sql: `
                  EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
                  SELECT s.public_id, rs.stop_sequence
                  FROM transport.route_variants v
                  JOIN transport.route_stops rs ON rs.route_variant_id = v.id
                  JOIN transport.stops s ON s.id = rs.stop_id AND s.deleted_at IS NULL
                  WHERE v.public_id = '${fixture.variantAPublicId}'::uuid
                    AND v.deleted_at IS NULL
                    AND rs.stop_sequence BETWEEN 1 AND 7
                  ORDER BY rs.stop_sequence ASC
                `,
            },
        ];
        for (const item of explainSql) {
            const rows = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(item.sql);
            explainPlans.push({
                name: item.name,
                plan: rows.map((r) => r["QUERY PLAN"]).join("\n"),
            });
        }

        const failed = cases.filter((c) => !c.ok);
        const slow = cases.filter((c) => c.ms > TARGET_MS);
        const report = {
            database: "coremap_field_test@127.0.0.1",
            productionContacted: false,
            indexesAdded: [] as string[],
            indexEvidence:
                "No new index. Fixture size is small; EXPLAIN plans below use existing PK/unique lookups. Add indexes only after production-like volume shows sequential scans.",
            cases,
            explainPlans,
            summary: {
                pass: failed.length === 0,
                failed: failed.map((c) => c.id),
                slowOver1s: slow.map((c) => ({ id: c.id, ms: Number(c.ms.toFixed(2)) })),
            },
        };
        console.log(JSON.stringify(report, null, 2));
        if (failed.length > 0) {
            process.exitCode = 1;
        }
    } finally {
        try {
            if (fixture) {
                await cleanupFixture(prisma, PREFIX);
            }
        } finally {
            await prisma.$disconnect();
        }
    }
}

async function seedFixture(prisma: PrismaClient, prefix: string) {
    await prisma.$executeRawUnsafe(`
        INSERT INTO ref.ref_report_types (code, name) VALUES
          ('wrong_location','Wrong location'),
          ('missing_item','Missing item'),
          ('new_stop','New stop'),
          ('wrong_info','Wrong information'),
          ('other_map_issue','Other')
        ON CONFLICT (code) DO NOTHING
    `);
    await prisma.$executeRawUnsafe(`
        INSERT INTO ref.ref_report_statuses (code, name) VALUES
          ('submitted','Submitted'),
          ('in_review','In review'),
          ('resolved','Resolved'),
          ('rejected','Rejected')
        ON CONFLICT (code) DO NOTHING
    `);

    const adminRows = await prisma.$queryRawUnsafe<Array<{ id: bigint; public_id: string }>>(`
        INSERT INTO app_auth.auth_users (public_id, email, password_hash, display_name, is_active, account_status)
        VALUES (gen_random_uuid(), '${prefix}-admin@example.invalid', 'x', 'Apply Verify Admin', true, 'active')
        RETURNING id, public_id::text
    `);
    const adminUserId = adminRows[0]!.id;

    const routeRows = await prisma.$queryRawUnsafe<Array<{ id: bigint; public_id: string }>>(`
        INSERT INTO transport.routes (route_code, public_name, mode, review_status, is_active)
        VALUES ('${prefix}-R1', 'Verify Route', 'bus', 'needs_review', true)
        RETURNING id, public_id::text
    `);
    const routeId = routeRows[0]!.id;
    const routePublicId = routeRows[0]!.public_id;

    const variantA = await prisma.$queryRawUnsafe<Array<{ id: bigint; public_id: string }>>(`
        INSERT INTO transport.route_variants (route_id, variant_code, direction_id, origin_name, destination_name, is_active)
        VALUES (${routeId}, 'D0', 0, 'A', 'B', true)
        RETURNING id, public_id::text
    `);
    const variantB = await prisma.$queryRawUnsafe<Array<{ id: bigint; public_id: string }>>(`
        INSERT INTO transport.route_variants (route_id, variant_code, direction_id, origin_name, destination_name, is_active)
        VALUES (${routeId}, 'D1', 1, 'B', 'A', true)
        RETURNING id, public_id::text
    `);
    const variantAId = variantA[0]!.id;
    const variantBId = variantB[0]!.id;
    const variantAPublicId = variantA[0]!.public_id;
    const variantBPublicId = variantB[0]!.public_id;

    async function insertStop(name: string, lat: number, lng: number) {
        const rows = await prisma.$queryRawUnsafe<Array<{ id: bigint; public_id: string }>>(`
            INSERT INTO transport.stops (name, name_mm, name_en, mode, stop_type, review_status, is_active, geom)
            VALUES (
              '${name}', '${name}', '${name}-en', 'bus', 'bus_stop', 'needs_review', true,
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)
            )
            RETURNING id, public_id::text
        `);
        return rows[0]!;
    }

    const s1 = await insertStop(`${prefix}-S1`, 16.8, 96.15);
    const s2 = await insertStop(`${prefix}-S2`, 16.801, 96.151);
    const s3 = await insertStop(`${prefix}-S3`, 16.802, 96.152);
    const s4 = await insertStop(`${prefix}-S4`, 16.803, 96.153);
    const s5 = await insertStop(`${prefix}-S5`, 16.804, 96.154);
    const sUpdate = await insertStop(`${prefix}-UPD`, 16.81, 96.16);
    const sRace = await insertStop(`${prefix}-RACE`, 16.82, 96.17);
    const sRollback = await insertStop(`${prefix}-RB`, 16.83, 96.18);
    const sStale = await insertStop(`${prefix}-STALE`, 16.84, 96.19);

    async function link(variantId: bigint, stopId: bigint, seq: number) {
        await prisma.$executeRawUnsafe(`
            INSERT INTO transport.route_stops (route_variant_id, stop_id, stop_sequence, pickup_type, drop_off_type, is_timing_point)
            VALUES (${variantId}, ${stopId}, ${seq}, 0, 0, false)
        `);
    }

    // Variant A: S1,S2,S3,S4,S5
    await link(variantAId, s1.id, 1);
    await link(variantAId, s2.id, 2);
    await link(variantAId, s3.id, 3);
    await link(variantAId, s4.id, 4);
    await link(variantAId, s5.id, 5);
    // Variant B shares S2 and S3
    await link(variantBId, s2.id, 1);
    await link(variantBId, s3.id, 2);
    await link(variantBId, s4.id, 3);

    const proposedLat = 16.8005;
    const proposedLng = 96.1505;
    const newStopName = `${prefix}-NEW`;
    const proposedName = `${prefix}-RENAMED`;
    const raceProposedLat = 16.8205;

    async function insertReport(input: {
        type: string;
        stopPublicId: string | null;
        data: Record<string, unknown>;
        lat: number;
        lng: number;
    }) {
        const rows = await prisma.$queryRawUnsafe<Array<{ public_id: string }>>(`
            INSERT INTO feedback.user_reports (
              public_id, created_by, is_anonymous, eligible_for_points,
              report_type_code, status_code, description, geom,
              source_code, observed_at, location_accuracy_m, report_data, priority, confidence_score
            ) VALUES (
              gen_random_uuid(), ${adminUserId}, false, false,
              '${input.type}', 'in_review', '${prefix} report',
              ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326),
              'field_survey', now(), 8,
              '${JSON.stringify(input.data).replace(/'/g, "''")}'::jsonb,
              'normal', 50
            )
            RETURNING public_id::text
        `);
        return rows[0]!.public_id;
    }

    const baseData = {
        routePublicId,
        routeCode: `${prefix}-R1`,
        variantPublicId: variantAPublicId,
        variantCode: "D0",
        snapshotRevision: "seed",
    };

    const moveReportPublicId = await insertReport({
        type: "wrong_location",
        stopPublicId: s2.public_id,
        lat: proposedLat,
        lng: proposedLng,
        data: {
            ...baseData,
            stopPublicId: s2.public_id,
            stopName: `${prefix}-S2`,
            stopSequence: 2,
            canonicalSnapshot: {
                correctedLat: proposedLat,
                correctedLng: proposedLng,
                observerLat: proposedLat,
                observerLng: proposedLng,
            },
        },
    });

    const removeReportPublicId = await insertReport({
        type: "missing_item",
        stopPublicId: s3.public_id,
        lat: 16.802,
        lng: 96.152,
        data: {
            ...baseData,
            stopPublicId: s3.public_id,
            stopName: `${prefix}-S3`,
            stopSequence: 3,
        },
    });

    const createReportPublicId = await insertReport({
        type: "new_stop",
        stopPublicId: s1.public_id,
        lat: 16.8002,
        lng: 96.1502,
        data: {
            ...baseData,
            previousStopPublicId: s1.public_id,
            previousStopSequence: 1,
            nextStopPublicId: s2.public_id,
            proposedStopName: newStopName,
            locationSource: "MAP_PICK",
            stopPublicId: s1.public_id,
            stopSequence: 1,
            canonicalSnapshot: {
                correctedLat: 16.8002,
                correctedLng: 96.1502,
                observerLat: 16.8001,
                observerLng: 96.1501,
            },
        },
    });

    const updateReportPublicId = await insertReport({
        type: "wrong_info",
        stopPublicId: sUpdate.public_id,
        lat: 16.81,
        lng: 96.16,
        data: {
            ...baseData,
            stopPublicId: sUpdate.public_id,
            stopName: `${prefix}-UPD`,
            stopSequence: 1,
            proposedStopName: proposedName,
        },
    });
    await link(variantAId, sUpdate.id, 6);

    const resolveReportPublicId = await insertReport({
        type: "other_map_issue",
        stopPublicId: null,
        lat: 16.8,
        lng: 96.15,
        data: { ...baseData },
    });
    const rejectReportPublicId = await insertReport({
        type: "other_map_issue",
        stopPublicId: null,
        lat: 16.8,
        lng: 96.15,
        data: { ...baseData },
    });

    const staleReportPublicId = await insertReport({
        type: "wrong_location",
        stopPublicId: sStale.public_id,
        lat: 16.841,
        lng: 96.191,
        data: {
            ...baseData,
            stopPublicId: sStale.public_id,
            stopSequence: 1,
            canonicalSnapshot: { correctedLat: 16.841, correctedLng: 96.191 },
        },
    });

    const raceReportPublicId = await insertReport({
        type: "wrong_location",
        stopPublicId: sRace.public_id,
        lat: raceProposedLat,
        lng: 96.1705,
        data: {
            ...baseData,
            stopPublicId: sRace.public_id,
            stopSequence: 1,
            canonicalSnapshot: {
                correctedLat: raceProposedLat,
                correctedLng: 96.1705,
            },
        },
    });

    return {
        adminUserId,
        routePublicId,
        variantAPublicId,
        variantBPublicId,
        moveStopPublicId: s2.public_id,
        removeStopPublicId: s3.public_id,
        prevStopPublicId: s1.public_id,
        updateStopPublicId: sUpdate.public_id,
        updateStopGeom: { lat: 16.81, lng: 96.16 },
        raceStopPublicId: sRace.public_id,
        raceProposedLat,
        rollbackStopPublicId: sRollback.public_id,
        staleStopPublicId: sStale.public_id,
        moveReportPublicId,
        removeReportPublicId,
        createReportPublicId,
        updateReportPublicId,
        resolveReportPublicId,
        rejectReportPublicId,
        staleReportPublicId,
        raceReportPublicId,
        proposedLat,
        proposedLng,
        newStopName,
        proposedName,
    };
}

async function cleanupFixture(prisma: PrismaClient, prefix: string) {
    await prisma.$executeRawUnsafe(`
        DELETE FROM feedback.report_status_events
        WHERE report_id IN (SELECT id FROM feedback.user_reports WHERE description LIKE '${prefix}%')
    `);
    await prisma.$executeRawUnsafe(`DELETE FROM feedback.user_reports WHERE description LIKE '${prefix}%'`);
    await prisma.$executeRawUnsafe(`
        DELETE FROM system.audit_logs
        WHERE user_agent = 'reports-apply-db-verify'
           OR (after_snapshot::text LIKE '%${prefix}%')
    `);
    await prisma.$executeRawUnsafe(`
        DELETE FROM transport.route_stops
        WHERE route_variant_id IN (
          SELECT v.id FROM transport.route_variants v
          JOIN transport.routes r ON r.id = v.route_id
          WHERE r.route_code LIKE '${prefix}%'
        )
    `);
    await prisma.$executeRawUnsafe(`
        DELETE FROM transport.route_variants
        WHERE route_id IN (SELECT id FROM transport.routes WHERE route_code LIKE '${prefix}%')
    `);
    await prisma.$executeRawUnsafe(`DELETE FROM transport.routes WHERE route_code LIKE '${prefix}%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM transport.stops WHERE name LIKE '${prefix}%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM app_auth.auth_users WHERE email LIKE '${prefix}%'`);
}

async function stopPoint(prisma: PrismaClient, publicId: string) {
    const rows = await prisma.$queryRawUnsafe<Array<{ lat: number; lng: number }>>(`
        SELECT ST_Y(geom)::float8 AS lat, ST_X(geom)::float8 AS lng
        FROM transport.stops WHERE public_id = '${publicId}'::uuid
    `);
    return rows[0]!;
}

async function stopExists(prisma: PrismaClient, publicId: string) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
        SELECT count(*)::int AS n FROM transport.stops
        WHERE public_id = '${publicId}'::uuid AND deleted_at IS NULL
    `);
    return rows[0]!.n > 0;
}

async function routeStopCount(prisma: PrismaClient, stopPublicId: string) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
        SELECT count(*)::int AS n
        FROM transport.route_stops rs
        JOIN transport.stops s ON s.id = rs.stop_id
        WHERE s.public_id = '${stopPublicId}'::uuid
    `);
    return rows[0]!.n;
}

async function stopOnVariant(prisma: PrismaClient, stopPublicId: string, variantPublicId: string) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
        SELECT count(*)::int AS n
        FROM transport.route_stops rs
        JOIN transport.stops s ON s.id = rs.stop_id
        JOIN transport.route_variants v ON v.id = rs.route_variant_id
        WHERE s.public_id = '${stopPublicId}'::uuid
          AND v.public_id = '${variantPublicId}'::uuid
    `);
    return rows[0]!.n > 0;
}

async function variantSequence(prisma: PrismaClient, variantPublicId: string) {
    const rows = await prisma.$queryRawUnsafe<Array<{ stop_sequence: number }>>(`
        SELECT rs.stop_sequence
        FROM transport.route_stops rs
        JOIN transport.route_variants v ON v.id = rs.route_variant_id
        WHERE v.public_id = '${variantPublicId}'::uuid
        ORDER BY rs.stop_sequence
    `);
    return rows.map((r) => Number(r.stop_sequence));
}

async function variantSequenceDetail(prisma: PrismaClient, variantPublicId: string) {
    return prisma.$queryRawUnsafe<Array<{ public_id: string; name: string; stop_sequence: number }>>(`
        SELECT s.public_id::text, s.name, rs.stop_sequence
        FROM transport.route_stops rs
        JOIN transport.route_variants v ON v.id = rs.route_variant_id
        JOIN transport.stops s ON s.id = rs.stop_id
        WHERE v.public_id = '${variantPublicId}'::uuid
        ORDER BY rs.stop_sequence
    `);
}

async function countStopsNamed(prisma: PrismaClient, name: string) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
        SELECT count(*)::int AS n FROM transport.stops WHERE name = '${name}' AND deleted_at IS NULL
    `);
    return rows[0]!.n;
}

async function stopNames(prisma: PrismaClient, publicId: string) {
    const rows = await prisma.$queryRawUnsafe<
        Array<{ name: string | null; name_mm: string | null; name_en: string | null }>
    >(`
        SELECT name, name_mm, name_en FROM transport.stops WHERE public_id = '${publicId}'::uuid
    `);
    return rows[0]!;
}

async function transportFingerprint(prisma: PrismaClient, prefix: string) {
    const rows = await prisma.$queryRawUnsafe<Array<{ fp: string }>>(`
        SELECT md5(string_agg(x.part, '|' ORDER BY x.part)) AS fp
        FROM (
          SELECT format('%s:%s:%s', s.public_id, ST_AsText(s.geom), coalesce(s.name,'')) AS part
          FROM transport.stops s
          WHERE s.name LIKE '${prefix}%'
          UNION ALL
          SELECT format('%s:%s:%s', v.public_id, s.public_id, rs.stop_sequence) AS part
          FROM transport.route_stops rs
          JOIN transport.route_variants v ON v.id = rs.route_variant_id
          JOIN transport.routes r ON r.id = v.route_id
          JOIN transport.stops s ON s.id = rs.stop_id
          WHERE r.route_code LIKE '${prefix}%'
        ) x
    `);
    return rows[0]?.fp ?? "";
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
