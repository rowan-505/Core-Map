import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

import { prisma } from "../db/prisma.js";
import { FieldReportsRepository } from "../modules/field/field-reports.repo.js";
import { FieldReportsService } from "../modules/field/field-reports.service.js";
import { SurveySessionsRepository } from "../modules/field/survey-sessions.repo.js";
import { SurveySessionsError, SurveySessionsService } from "../modules/field/survey-sessions.service.js";
import { ReportsRepository } from "../modules/reports/reports.repo.js";

const TEST_PREFIX = "field-hardening-load";
const SURVEYOR_COUNT = 10;

type TimedResult<T> = { value?: T; durationMs: number; error?: unknown };

function requireDisposableDatabase(): void {
    const raw = process.env.DATABASE_URL;
    if (!raw) throw new Error("DATABASE_URL is required");
    const url = new URL(raw);
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
        throw new Error("Refusing to run field hardening load test against a non-local database");
    }
    if (url.pathname.slice(1) !== "coremap_field_test") {
        throw new Error("Refusing to run outside the coremap_field_test disposable database");
    }
}

async function timed<T>(work: () => Promise<T>): Promise<TimedResult<T>> {
    const start = performance.now();
    try {
        return { value: await work(), durationMs: performance.now() - start };
    } catch (error) {
        return { error, durationMs: performance.now() - start };
    }
}

function percentile(values: number[], fraction: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function latency(values: number[]) {
    return {
        p50Ms: Number(percentile(values, 0.5).toFixed(2)),
        p95Ms: Number(percentile(values, 0.95).toFixed(2)),
        maxMs: Number(Math.max(0, ...values).toFixed(2)),
    };
}

async function cleanup(): Promise<void> {
    await prisma.$executeRawUnsafe(`
        DELETE FROM feedback.report_status_events
        WHERE report_id IN (
            SELECT id FROM feedback.user_reports
            WHERE description LIKE '${TEST_PREFIX}%'
        )
    `);
    await prisma.$executeRawUnsafe(`DELETE FROM feedback.user_reports WHERE description LIKE '${TEST_PREFIX}%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM feedback.survey_sessions WHERE snapshot_revision = '${TEST_PREFIX}'`);
    await prisma.$executeRawUnsafe(`
        DELETE FROM transport.route_variants
        WHERE route_id IN (SELECT id FROM transport.routes WHERE route_code LIKE 'YBS-FIELD-HARDENING-%')
    `);
    await prisma.$executeRawUnsafe(`DELETE FROM transport.routes WHERE route_code LIKE 'YBS-FIELD-HARDENING-%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM app_auth.auth_users WHERE email LIKE '${TEST_PREFIX}-%@example.invalid'`);
}

async function main(): Promise<void> {
    requireDisposableDatabase();
    await cleanup();

    const users = await prisma.$queryRawUnsafe<Array<{ id: bigint; public_id: string }>>(`
        INSERT INTO app_auth.auth_users (public_id, email, password_hash, display_name)
        SELECT gen_random_uuid(), format('${TEST_PREFIX}-%s@example.invalid', n),
               'test-only-not-a-login', format('Load surveyor %s', n)
        FROM generate_series(1, ${SURVEYOR_COUNT}) n
        RETURNING id, public_id::text
    `);
    await prisma.$executeRawUnsafe(`
        INSERT INTO ref.ref_report_types (code, name)
        VALUES
            ('other_map_issue', 'Other map issue'),
            ('new_stop', 'New stop')
        ON CONFLICT (code) DO NOTHING
    `);
    await prisma.$executeRawUnsafe(`
        INSERT INTO ref.ref_report_statuses (code, name)
        VALUES ('submitted', 'Submitted') ON CONFLICT (code) DO NOTHING
    `);
    const routes = await prisma.$queryRawUnsafe<Array<{ id: bigint; public_id: string }>>(`
        INSERT INTO transport.routes
            (public_id, route_code, public_name, mode, route_kind, confidence_score, review_status, is_active)
        VALUES
            (gen_random_uuid(), 'YBS-FIELD-HARDENING-A', 'Field hardening active', 'bus', 'urban_bus', 100, 'verified', true),
            (gen_random_uuid(), 'YBS-FIELD-HARDENING-I', 'Field hardening inactive', 'bus', 'urban_bus', 100, 'verified', false)
        RETURNING id, public_id::text
    `);
    const variants = await prisma.$queryRawUnsafe<Array<{ public_id: string; direction_id: number; is_active: boolean }>>(`
        INSERT INTO transport.route_variants
            (public_id, route_id, variant_code, direction_id, origin_name, destination_name,
             confidence_score, review_status, is_active)
        VALUES
            (gen_random_uuid(), ${routes[0]!.id}, 'D0', 0, 'A', 'B', 100, 'verified', true),
            (gen_random_uuid(), ${routes[0]!.id}, 'D1', 1, 'B', 'A', 100, 'verified', true),
            (gen_random_uuid(), ${routes[1]!.id}, 'D0', 0, 'A', 'B', 100, 'verified', false)
        RETURNING public_id::text, direction_id, is_active
    `);

    const sessions = new SurveySessionsService(new SurveySessionsRepository(prisma));
    const reports = new FieldReportsService(
        new FieldReportsRepository(prisma),
        new ReportsRepository(prisma),
        sessions
    );
    const activeVariants = variants.filter((variant) => variant.is_active);
    const sessionInputs = users.map((user, index) => ({
        user,
        clientSessionId: randomUUID(),
        variant: activeVariants[index % 2]!,
        startedAt: new Date(Date.now() - index * 1000),
    }));

    const writes = await Promise.all(sessionInputs.map((input) => timed(() => sessions.create(
        input.user.public_id,
        {
            clientSessionId: input.clientSessionId,
            routeVariantPublicId: input.variant.public_id,
            snapshotRevision: TEST_PREFIX,
            startedAt: input.startedAt,
        }
    ))));
    const writeErrors = writes.filter((result) => result.error);
    if (writeErrors.length) throw writeErrors[0]!.error;

    const duplicateWrites = await Promise.all(
        sessionInputs.flatMap((input) =>
            [0, 1].map(() =>
                timed(() =>
                    sessions.create(input.user.public_id, {
                        clientSessionId: input.clientSessionId,
                        routeVariantPublicId: input.variant.public_id,
                        snapshotRevision: TEST_PREFIX,
                        startedAt: input.startedAt,
                    })
                )
            )
        )
    );
    const duplicateCount = duplicateWrites.filter((result) => result.value && !result.value.created).length;

    const reportWriteGroups = await Promise.all(
        sessionInputs.map(async (input, surveyorIndex) => {
            const results: Array<TimedResult<Awaited<ReturnType<FieldReportsService["create"]>>>> = [];
            for (let reportIndex = 0; reportIndex < 5; reportIndex += 1) {
                const reportBody = {
                        clientPublicId: randomUUID(),
                        reportTypeCode: "other_map_issue",
                        observedAt: new Date(),
                        location: { lat: 16.76 + surveyorIndex / 1000, lng: 96.2, accuracyM: 5 },
                        target: { entityType: "route", publicId: routes[0]!.public_id },
                        context: {
                            snapshotRevision: TEST_PREFIX,
                            routePublicId: routes[0]!.public_id,
                            variantPublicId: input.variant.public_id,
                            variantCode: input.variant.direction_id === 0 ? "D0" : "D1",
                        },
                        surveySession: { clientSessionId: input.clientSessionId },
                        description: `${TEST_PREFIX}-${surveyorIndex}-${reportIndex}`,
                    } as const;
                results.push(await timed(() => reports.create(input.user.public_id, reportBody)));
            }
            return results;
        })
    );
    const reportWrites = reportWriteGroups.flat();
    const reportErrors = reportWrites.filter((result) => result.error);
    if (reportErrors.length) throw reportErrors[0]!.error;

    const duplicateReportBody = {
        clientPublicId: randomUUID(),
        reportTypeCode: "other_map_issue",
        observedAt: new Date(),
        location: { lat: 16.76, lng: 96.2, accuracyM: 5 },
        target: { entityType: "route", publicId: routes[0]!.public_id },
        context: {
            snapshotRevision: TEST_PREFIX,
            routePublicId: routes[0]!.public_id,
            variantPublicId: activeVariants[0]!.public_id,
            variantCode: "D0",
        },
        description: `${TEST_PREFIX}-concurrent-idempotent-report`,
    } as const;
    const duplicateReportWrites = await Promise.all([0, 1].map(() =>
        timed(() => reports.create(users[0]!.public_id, duplicateReportBody))
    ));
    if (duplicateReportWrites.some((result) => result.error)) {
        throw duplicateReportWrites.find((result) => result.error)!.error;
    }
    const reportDuplicateCount = duplicateReportWrites.filter(
        (result) => result.value && !result.value.created
    ).length;
    if (reportDuplicateCount !== 1) {
        throw new Error("Concurrent report idempotency did not produce one duplicate");
    }

    const zeroReportClientSessionId = randomUUID();
    const zeroReportSession = await sessions.create(users[0]!.public_id, {
        clientSessionId: zeroReportClientSessionId,
        routeVariantPublicId: activeVariants[0]!.public_id,
        snapshotRevision: TEST_PREFIX,
        startedAt: new Date(Date.now() - 86_400_000),
    });

    const reads = await Promise.all(sessionInputs.map((input) => timed(() => sessions.list(
        input.user.public_id,
        { limit: 2 }
    ))));
    if (reads.some((result) => result.error)) throw reads.find((result) => result.error)!.error;
    if (reads.some((result) => result.value?.items[0]?.reportCount !== 5)) {
        throw new Error("Derived report count mismatch");
    }
    const firstPage = await sessions.list(users[0]!.public_id, { limit: 1 });
    if (!firstPage.nextCursor) throw new Error("Cursor pagination did not return a next cursor");
    const secondPage = await sessions.list(users[0]!.public_id, {
        limit: 1,
        cursor: firstPage.nextCursor,
    });
    if (secondPage.items[0]?.publicId !== zeroReportSession.session.publicId || secondPage.items[0]?.reportCount !== 0) {
        throw new Error("Zero-report session history or cursor pagination mismatch");
    }

    const directionCounts = await prisma.$queryRawUnsafe<Array<{ direction_id: number; report_count: bigint }>>(`
        SELECT v.direction_id, count(ur.id) AS report_count
        FROM feedback.survey_sessions ss
        JOIN transport.route_variants v ON v.id = ss.route_variant_id
        LEFT JOIN feedback.user_reports ur ON ur.survey_session_id = ss.id
        WHERE ss.snapshot_revision = '${TEST_PREFIX}'
        GROUP BY v.direction_id
        ORDER BY v.direction_id
    `);
    if (directionCounts.length !== 2 || directionCounts.some((row) => row.report_count !== 25n)) {
        throw new Error("D0/D1 report separation mismatch");
    }

    const crossUser = await timed(() => sessions.get(
        users[1]!.public_id,
        writes[0]!.value!.session.publicId
    ));
    if (!(crossUser.error instanceof SurveySessionsError) || crossUser.error.statusCode !== 404) {
        throw new Error("Cross-user session access was not denied");
    }

    const inactive = await timed(() => sessions.create(users[0]!.public_id, {
        clientSessionId: randomUUID(),
        routeVariantPublicId: variants.find((variant) => !variant.is_active)!.public_id,
        snapshotRevision: TEST_PREFIX,
        startedAt: new Date(),
    }));
    if (!(inactive.error instanceof SurveySessionsError) || inactive.error.code !== "INVALID_ROUTE_VARIANT") {
        throw new Error("Inactive route variant was not rejected");
    }

    await prisma.$executeRawUnsafe(`
        UPDATE app_auth.auth_users
        SET is_active = false, account_status = 'disabled'
        WHERE id = ${users[0]!.id}
    `);
    const disabledUser = await timed(() => sessions.create(users[0]!.public_id, {
        clientSessionId: randomUUID(),
        routeVariantPublicId: activeVariants[0]!.public_id,
        snapshotRevision: TEST_PREFIX,
        startedAt: new Date(),
    }));
    if (!(disabledUser.error instanceof SurveySessionsError) || disabledUser.error.code !== "UNAUTHORIZED") {
        throw new Error("Disabled surveyor account was not rejected");
    }
    await prisma.$executeRawUnsafe(`
        UPDATE app_auth.auth_users
        SET is_active = true, account_status = 'active'
        WHERE id = ${users[0]!.id}
    `);

    const endings = await Promise.all(sessionInputs.map((input, index) => timed(() => index < 5
        ? sessions.complete(input.user.public_id, input.clientSessionId, { endedAt: new Date() })
        : sessions.abandon(input.user.public_id, input.clientSessionId, { endedAt: new Date() })
    )));
    if (endings.some((result) => result.error)) throw endings.find((result) => result.error)!.error;

    const databaseFailures = [...writes, ...duplicateWrites, ...reportWrites, ...duplicateReportWrites, ...reads, ...endings]
        .filter((result) => result.error).length;
    const allDurations = [...writes, ...duplicateWrites, ...reportWrites, ...duplicateReportWrites, ...endings]
        .map((result) => result.durationMs);
    const unexpectedErrors = databaseFailures;
    const operationCount = writes.length + duplicateWrites.length + reportWrites.length
        + duplicateReportWrites.length + reads.length + endings.length;

    console.log(JSON.stringify({
        surveyors: SURVEYOR_COUNT,
        operationCount,
        errorRate: unexpectedErrors / operationCount,
        duplicateCount,
        expectedDuplicateCount: duplicateWrites.length,
        reportDuplicateCount,
        expectedReportDuplicateCount: 1,
        writeLatency: latency(allDurations),
        readLatency: latency(reads.map((result) => result.durationMs)),
        slowQueriesOver250Ms: [...writes, ...duplicateWrites, ...reportWrites, ...duplicateReportWrites, ...reads, ...endings]
            .filter((result) => result.durationMs > 250).length,
        connectionDatabaseFailures: databaseFailures,
        d0Sessions: sessionInputs.filter((input) => input.variant.direction_id === 0).length,
        d1Sessions: sessionInputs.filter((input) => input.variant.direction_id === 1).length,
        crossUserDenied: true,
        inactiveVariantRejected: true,
        disabledSurveyorRejected: true,
        reportCountsDerived: true,
        zeroReportHistory: true,
        cursorPagination: true,
        d0D1ReportsSeparate: true,
    }, null, 2));
}

try {
    await main();
} finally {
    await cleanup();
    await prisma.$disconnect();
}
