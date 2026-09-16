/**
 * Disposable-DB verification for permanent delete of rejected reports.
 *
 * Safety: refuses any host except localhost/127.0.0.1 and any DB except coremap_field_test.
 * Never contacts production. Seeds synthetic data only; cleans up on exit.
 *
 * Usage:
 *   DATABASE_URL=postgresql://coremap:***@127.0.0.1:55432/coremap_field_test \
 *     NODE_ENV=test npx tsx src/scripts/reports-permanent-delete-db-verify.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";

import authPlugin from "../plugins/auth.js";
import { ReportsRepository } from "../modules/reports/reports.repo.js";
import { ReportsError, ReportsService } from "../modules/reports/reports.service.js";

const PREFIX = `rpt-del-verify-${Date.now()}`;

type CaseResult = { id: string; ok: boolean; ms: number; detail: string };

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

    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const reportsRepo = new ReportsRepository(prisma);
    const deletedKeys: string[] = [];
    const reportsService = new ReportsService(
        reportsRepo,
        { listReadyPrivateForReport: async () => [] } as never,
        { loadRevisionParts: async () => ({}) } as never,
        prisma,
        {} as never,
        {
            deleteObject: async (input) => {
                deletedKeys.push(`${input.bucket}:${input.objectKey}`);
            },
        },
        { privateBucket: "priv-test", publicBucket: "pub-test" }
    );

    const audit = {
        actorUserId: 0n,
        ipAddress: "127.0.0.1",
        userAgent: "reports-permanent-delete-db-verify",
    };

    const cases: CaseResult[] = [];
    let fixture: Awaited<ReturnType<typeof seedFixture>> | null = null;

    try {
        fixture = await seedFixture(prisma, PREFIX);
        audit.actorUserId = fixture.adminUserId;

        // 1. Rejected delete succeeds
        {
            const beforeUsers = await countUsers(prisma, fixture.reporterUserId);
            const beforeStop = await stopExists(prisma, fixture.stopPublicId);
            const beforeRoute = await routeExists(prisma, fixture.routePublicId);
            const beforeSession = await sessionExists(prisma, fixture.sessionPublicId);
            const beforeOther = await reportExists(prisma, fixture.keepReportPublicId);
            const beforeFollowups = await childCount(prisma, "feedback.report_followups", fixture.rejectReportId);
            const beforeEvents = await childCount(prisma, "feedback.report_status_events", fixture.rejectReportId);
            const beforeMedia = await childCount(prisma, "feedback.report_media", fixture.rejectReportId);

            deletedKeys.length = 0;
            const { value, ms } = await timed(() =>
                reportsService.adminPermanentDelete(fixture!.rejectReportPublicId, audit)
            );
            assert.equal(value.deleted, true);
            assert.equal(value.public_id, fixture.rejectReportPublicId);
            assert.equal(await reportExists(prisma, fixture.rejectReportPublicId), false);
            assert.equal(await childCount(prisma, "feedback.report_followups", fixture.rejectReportId), 0);
            assert.equal(await childCount(prisma, "feedback.report_status_events", fixture.rejectReportId), 0);
            assert.equal(await childCount(prisma, "feedback.report_media", fixture.rejectReportId), 0);
            assert.equal(await assetExists(prisma, fixture.ownedAssetPublicId), false);
            assert.equal(await assetExists(prisma, fixture.publishedSourceAssetPublicId), true);
            assert.equal(await assetExists(prisma, fixture.keptPublishedAssetPublicId), true);
            assert.deepEqual(deletedKeys, [`priv-test:${fixture.ownedObjectKey}`]);

            assert.equal(await countUsers(prisma, fixture.reporterUserId), beforeUsers);
            assert.equal(await stopExists(prisma, fixture.stopPublicId), beforeStop);
            assert.equal(await routeExists(prisma, fixture.routePublicId), beforeRoute);
            assert.equal(await sessionExists(prisma, fixture.sessionPublicId), beforeSession);
            assert.equal(await reportExists(prisma, fixture.keepReportPublicId), beforeOther);
            assert.ok(beforeFollowups >= 1 && beforeEvents >= 1 && beforeMedia >= 1);

            cases.push({
                id: "01_REJECTED_DELETE_OK",
                ok: true,
                ms,
                detail: "rejected report + owned children/media removed; canonical untouched",
            });
        }

        // 2. Open / resolved cannot delete
        {
            for (const [id, publicId, status] of [
                ["02_OPEN_BLOCKED", fixture.openReportPublicId, "submitted"],
                ["03_RESOLVED_BLOCKED", fixture.resolvedReportPublicId, "resolved"],
            ] as const) {
                const { ms } = await timed(async () => {
                    await assert.rejects(
                        () => reportsService.adminPermanentDelete(publicId, audit),
                        (error: unknown) =>
                            error instanceof ReportsError &&
                            error.statusCode === 409 &&
                            error.message.includes(status)
                    );
                });
                assert.equal(await reportExists(prisma, publicId), true);
                cases.push({ id, ok: true, ms, detail: `${status} blocked with 409` });
            }
        }

        // 3. Other report unchanged after delete
        {
            const ok = await reportExists(prisma, fixture.keepReportPublicId);
            cases.push({
                id: "04_SIBLING_UNCHANGED",
                ok,
                ms: 0,
                detail: ok ? "sibling report still present" : "sibling missing",
            });
        }

        // 4. Retry / double-delete is safe (404)
        {
            const { ms } = await timed(async () => {
                await assert.rejects(
                    () => reportsService.adminPermanentDelete(fixture!.rejectReportPublicId, audit),
                    (error: unknown) => error instanceof ReportsError && error.statusCode === 404
                );
            });
            cases.push({ id: "05_RETRY_SAFE", ok: true, ms, detail: "second delete returns 404" });
        }

        // 5. Concurrent delete: second waiter gets 404
        {
            const publicId = fixture.concurrentReportPublicId;
            const [first, second] = await Promise.allSettled([
                reportsService.adminPermanentDelete(publicId, audit),
                reportsService.adminPermanentDelete(publicId, audit),
            ]);
            const outcomes = [first, second].map((result) => {
                if (result.status === "fulfilled") {
                    return "ok";
                }
                const reason = result.reason;
                if (reason instanceof ReportsError) {
                    return String(reason.statusCode);
                }
                return "error";
            });
            const ok =
                outcomes.includes("ok") &&
                outcomes.includes("404") &&
                (await reportExists(prisma, publicId)) === false;
            cases.push({
                id: "06_CONCURRENT_SAFE",
                ok,
                ms: 0,
                detail: `outcomes=${outcomes.join(",")}`,
            });
        }

        // 6. Unauthorized → 403
        {
            const previous = {
                JWT_SECRET: process.env.JWT_SECRET,
                AUTH_BYPASS: process.env.AUTH_BYPASS,
                NODE_ENV: process.env.NODE_ENV,
            };
            process.env.JWT_SECRET = "reports-delete-db-verify-secret";
            delete process.env.AUTH_BYPASS;
            process.env.NODE_ENV = "test";
            const app = Fastify();
            const { ms } = await timed(async () => {
                await app.register(authPlugin);
                app.delete(
                    "/admin/reports/:id",
                    { preHandler: [app.authenticate, app.requireRole("admin", "super_admin")] },
                    async () => ({ deleted: true })
                );
                await app.ready();
                const denied = await app.inject({
                    method: "DELETE",
                    url: `/admin/reports/${fixture!.keepReportPublicId}`,
                    headers: {
                        authorization: `Bearer ${app.jwt.sign({
                            sub: "u-viewer",
                            email: "v@example.com",
                            roles: ["viewer"],
                        })}`,
                    },
                });
                assert.equal(denied.statusCode, 403);
                await app.close();
            });
            if (previous.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
            else process.env.JWT_SECRET = previous.JWT_SECRET;
            if (previous.AUTH_BYPASS === undefined) delete process.env.AUTH_BYPASS;
            else process.env.AUTH_BYPASS = previous.AUTH_BYPASS;
            if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = previous.NODE_ENV;
            cases.push({ id: "07_UNAUTHORIZED_403", ok: true, ms, detail: "viewer JWT rejected" });
        }
    } finally {
        if (fixture) {
            await cleanupFixture(prisma, PREFIX, fixture);
        }
        await prisma.$disconnect();
    }

    let failed = 0;
    for (const c of cases) {
        const mark = c.ok ? "PASS" : "FAIL";
        if (!c.ok) failed += 1;
        console.log(`[${mark}] ${c.id} (${c.ms.toFixed(1)}ms) ${c.detail}`);
    }
    if (failed > 0) {
        console.error(`\nBLOCKED — ${failed} case(s) failed`);
        process.exit(1);
    }
    console.log("\nPASS — permanent delete disposable DB verification");
}

async function seedFixture(prisma: PrismaClient, prefix: string) {
    const adminPublicId = randomUUID();
    const reporterPublicId = randomUUID();
    const routePublicId = randomUUID();
    const stopPublicId = randomUUID();
    const sessionPublicId = randomUUID();
    const rejectReportPublicId = randomUUID();
    const keepReportPublicId = randomUUID();
    const openReportPublicId = randomUUID();
    const resolvedReportPublicId = randomUUID();
    const concurrentReportPublicId = randomUUID();
    const ownedAssetPublicId = randomUUID();
    const publishedSourceAssetPublicId = randomUUID();
    const keptPublishedAssetPublicId = randomUUID();
    const ownedObjectKey = `private/${prefix}/owned.jpg`;
    const publishedSourceObjectKey = `private/${prefix}/published-source.jpg`;
    const publishedObjectKey = `public/${prefix}/kept.jpg`;

    const admin = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(`
        INSERT INTO app_auth.auth_users (public_id, email, display_name, password_hash, is_active)
        VALUES ('${adminPublicId}'::uuid, '${prefix}-admin@example.com', 'Admin', 'x', true)
        RETURNING id
    `);
    const reporter = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(`
        INSERT INTO app_auth.auth_users (public_id, email, display_name, password_hash, is_active)
        VALUES ('${reporterPublicId}'::uuid, '${prefix}-reporter@example.com', 'Reporter', 'x', true)
        RETURNING id
    `);
    const adminUserId = admin[0]!.id;
    const reporterUserId = reporter[0]!.id;

    const route = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(`
        INSERT INTO transport.routes (public_id, route_code, public_name, mode, is_active)
        VALUES ('${routePublicId}'::uuid, '${prefix}-r1', '${prefix} Route', 'bus', true)
        RETURNING id
    `);
    const stop = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(`
        INSERT INTO transport.stops (public_id, name, mode, stop_type, geom, review_status)
        VALUES (
            '${stopPublicId}'::uuid,
            '${prefix}-Stop',
            'bus',
            'stop',
            ST_SetSRID(ST_MakePoint(96.15, 16.8), 4326),
            'needs_review'
        )
        RETURNING id
    `);
    const routeId = route[0]!.id;
    const stopId = stop[0]!.id;

    // survey_sessions requires a route_variant; create a minimal one for FK safety checks.
    const variantPublicId = randomUUID();
    const variant = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(`
        INSERT INTO transport.route_variants (public_id, route_id, variant_code, is_active)
        VALUES ('${variantPublicId}'::uuid, ${routeId}, 'D0', true)
        RETURNING id
    `);
    const variantId = variant[0]!.id;

    const session = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(`
        INSERT INTO feedback.survey_sessions (
            public_id, client_session_id, created_by, route_variant_id, snapshot_revision, started_at, status
        ) VALUES (
            '${sessionPublicId}'::uuid, '${randomUUID()}'::uuid, ${reporterUserId}, ${variantId},
            'verify-rev', now(), 'completed'
        )
        RETURNING id
    `);
    const sessionId = session[0]!.id;

    async function insertReport(input: {
        publicId: string;
        status: string;
        type?: string;
    }): Promise<bigint> {
        const rows = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(`
            INSERT INTO feedback.user_reports (
                public_id, created_by, is_anonymous, eligible_for_points,
                report_type_code, status_code, description,
                target_entity_type, target_public_id, source_code, survey_session_id,
                report_data, geom, observed_at
            ) VALUES (
                '${input.publicId}'::uuid, ${reporterUserId}, false, false,
                '${input.type ?? "wrong_location"}', '${input.status}',
                '${prefix} description',
                'stop', '${stopPublicId}'::uuid, 'field_survey', ${sessionId},
                '{"routePublicId":"${routePublicId}","stopPublicId":"${stopPublicId}"}'::jsonb,
                ST_SetSRID(ST_MakePoint(96.15, 16.8), 4326),
                now()
            )
            RETURNING id
        `);
        return rows[0]!.id;
    }

    const rejectReportId = await insertReport({ publicId: rejectReportPublicId, status: "rejected" });
    const keepReportId = await insertReport({ publicId: keepReportPublicId, status: "rejected" });
    const openReportId = await insertReport({ publicId: openReportPublicId, status: "submitted" });
    const resolvedReportId = await insertReport({
        publicId: resolvedReportPublicId,
        status: "resolved",
    });
    const concurrentReportId = await insertReport({
        publicId: concurrentReportPublicId,
        status: "rejected",
    });

    await prisma.$executeRawUnsafe(`
        INSERT INTO feedback.report_status_events (report_id, old_status_code, new_status_code, actor_user_id, note)
        VALUES (${rejectReportId}, 'submitted', 'rejected', ${adminUserId}, 'reject')
    `);
    await prisma.$executeRawUnsafe(`
        INSERT INTO feedback.report_followups (report_id, actor_type, actor_user_id, message)
        VALUES (${rejectReportId}, 'admin', ${adminUserId}, 'not useful')
    `);

    const ownedAsset = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(`
        INSERT INTO media.assets (
            public_id, media_type, storage_scope, object_key, mime_type, byte_size,
            status, created_by, ready_at
        ) VALUES (
            '${ownedAssetPublicId}'::uuid, 'image', 'private', '${ownedObjectKey}',
            'image/jpeg', 12, 'ready', ${reporterUserId}, now()
        )
        RETURNING id
    `);
    const publishedSource = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(`
        INSERT INTO media.assets (
            public_id, media_type, storage_scope, object_key, mime_type, byte_size,
            status, created_by, ready_at
        ) VALUES (
            '${publishedSourceAssetPublicId}'::uuid, 'image', 'private', '${publishedSourceObjectKey}',
            'image/jpeg', 12, 'ready', ${reporterUserId}, now()
        )
        RETURNING id
    `);
    const publishedAsset = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(`
        INSERT INTO media.assets (
            public_id, media_type, storage_scope, object_key, mime_type, byte_size,
            status, created_by, ready_at, source_asset_id
        ) VALUES (
            '${keptPublishedAssetPublicId}'::uuid, 'image', 'public', '${publishedObjectKey}',
            'image/jpeg', 12, 'ready', ${reporterUserId}, now(), ${publishedSource[0]!.id}
        )
        RETURNING id
    `);

    // Orphan private asset: owned only by this report → deleted with report.
    // Published source private asset: also linked to report, but kept because public derivative references it.
    await prisma.$executeRawUnsafe(`
        INSERT INTO feedback.report_media (report_id, asset_id, sort_order)
        VALUES
            (${rejectReportId}, ${ownedAsset[0]!.id}, 0),
            (${rejectReportId}, ${publishedSource[0]!.id}, 1)
    `);
    await prisma.$executeRawUnsafe(`
        INSERT INTO transport.stop_media (stop_id, asset_id, source_report_media_id, is_primary, is_active, published_at)
        VALUES (
            ${stopId},
            ${publishedAsset[0]!.id},
            (SELECT id FROM feedback.report_media WHERE report_id = ${rejectReportId} AND asset_id = ${publishedSource[0]!.id} LIMIT 1),
            true,
            true,
            now()
        )
    `);

    void routeId;
    void keepReportId;
    void openReportId;
    void resolvedReportId;
    void concurrentReportId;

    return {
        adminUserId,
        reporterUserId,
        routePublicId,
        stopPublicId,
        sessionPublicId,
        rejectReportPublicId,
        rejectReportId,
        keepReportPublicId,
        openReportPublicId,
        resolvedReportPublicId,
        concurrentReportPublicId,
        ownedAssetPublicId,
        publishedSourceAssetPublicId,
        keptPublishedAssetPublicId,
        ownedObjectKey,
    };
}

async function cleanupFixture(
    prisma: PrismaClient,
    prefix: string,
    fixture: Awaited<ReturnType<typeof seedFixture>>
) {
    await prisma.$executeRawUnsafe(`
        DELETE FROM transport.stop_media
        WHERE stop_id IN (SELECT id FROM transport.stops WHERE name LIKE '${prefix}%')
    `);
    await prisma.$executeRawUnsafe(`
        DELETE FROM feedback.report_media
        WHERE report_id IN (
            SELECT id FROM feedback.user_reports WHERE description LIKE '${prefix}%'
        )
    `);
    await prisma.$executeRawUnsafe(`
        DELETE FROM feedback.report_followups
        WHERE report_id IN (
            SELECT id FROM feedback.user_reports WHERE description LIKE '${prefix}%'
        )
    `);
    await prisma.$executeRawUnsafe(`
        DELETE FROM feedback.report_status_events
        WHERE report_id IN (
            SELECT id FROM feedback.user_reports WHERE description LIKE '${prefix}%'
        )
    `);
    await prisma.$executeRawUnsafe(`
        DELETE FROM feedback.user_reports WHERE description LIKE '${prefix}%'
    `);
    await prisma.$executeRawUnsafe(`
        DELETE FROM media.assets WHERE object_key LIKE '%${prefix}%'
    `);
    await prisma.$executeRawUnsafe(`
        DELETE FROM feedback.survey_sessions WHERE public_id = '${fixture.sessionPublicId}'::uuid
    `);
    await prisma.$executeRawUnsafe(`
        DELETE FROM transport.route_variants
        WHERE route_id IN (SELECT id FROM transport.routes WHERE route_code LIKE '${prefix}%')
    `);
    await prisma.$executeRawUnsafe(`DELETE FROM transport.stops WHERE name LIKE '${prefix}%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM transport.routes WHERE route_code LIKE '${prefix}%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM app_auth.auth_users WHERE email LIKE '${prefix}%'`);
    await prisma.$executeRawUnsafe(`
        DELETE FROM system.audit_logs
        WHERE action_type = 'report_permanently_deleted'
          AND before_snapshot::text LIKE '%${prefix}%'
    `);
}

async function reportExists(prisma: PrismaClient, publicId: string) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
        SELECT count(*)::int AS n FROM feedback.user_reports WHERE public_id = '${publicId}'::uuid
    `);
    return rows[0]!.n > 0;
}

async function childCount(prisma: PrismaClient, table: string, reportId: bigint) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
        SELECT count(*)::int AS n FROM ${table} WHERE report_id = ${reportId}
    `);
    return rows[0]!.n;
}

async function assetExists(prisma: PrismaClient, publicId: string) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
        SELECT count(*)::int AS n FROM media.assets WHERE public_id = '${publicId}'::uuid
    `);
    return rows[0]!.n > 0;
}

async function countUsers(prisma: PrismaClient, userId: bigint) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
        SELECT count(*)::int AS n FROM app_auth.auth_users WHERE id = ${userId}
    `);
    return rows[0]!.n;
}

async function stopExists(prisma: PrismaClient, publicId: string) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
        SELECT count(*)::int AS n FROM transport.stops WHERE public_id = '${publicId}'::uuid
    `);
    return rows[0]!.n > 0;
}

async function routeExists(prisma: PrismaClient, publicId: string) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
        SELECT count(*)::int AS n FROM transport.routes WHERE public_id = '${publicId}'::uuid
    `);
    return rows[0]!.n > 0;
}

async function sessionExists(prisma: PrismaClient, publicId: string) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
        SELECT count(*)::int AS n FROM feedback.survey_sessions WHERE public_id = '${publicId}'::uuid
    `);
    return rows[0]!.n > 0;
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
