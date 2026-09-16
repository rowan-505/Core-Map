import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { PrismaClient } from "@prisma/client";

import {
    ReportDeleteNotRejectedError,
    ReportsRepository,
} from "./reports.repo.js";

const REPORT_PUBLIC_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_REPORT_PUBLIC_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type RawHandler = (arg: unknown, ...rest: unknown[]) => Promise<unknown>;

function extractSql(arg: unknown): string {
    if (Array.isArray(arg)) {
        return arg.join("?");
    }
    if (arg && typeof arg === "object") {
        const obj = arg as Record<string, unknown>;
        if (typeof obj.sql === "string") return obj.sql;
        if (typeof obj.text === "string") return obj.text;
        if (Array.isArray(obj.strings)) return (obj.strings as string[]).join("?");
    }
    return String(arg);
}

type Scenario = {
    lockRows: Array<Record<string, unknown>>;
    linkedAssets: Array<{ asset_id: bigint; object_key: string; storage_scope: string }>;
    deletedAssets: Array<{ object_key: string; storage_scope: string }>;
    executed: string[];
    secondLockEmpty?: boolean;
    lockCalls: number;
};

function createMockPrisma(scenario: Scenario): PrismaClient {
    const queryRaw: RawHandler = async (arg) => {
        const sql = extractSql(arg);
        if (sql.includes("FOR UPDATE")) {
            scenario.lockCalls += 1;
            if (scenario.secondLockEmpty && scenario.lockCalls > 1) {
                return [];
            }
            return scenario.lockRows;
        }
        // Prefer DELETE ... RETURNING before the linked-assets SELECT — the delete
        // SQL also mentions feedback.report_media in NOT EXISTS subqueries.
        if (sql.includes("DELETE FROM media.assets") || sql.includes("RETURNING a.object_key")) {
            return scenario.deletedAssets;
        }
        if (sql.includes("FROM feedback.report_media rm") && sql.includes("media.assets")) {
            return scenario.linkedAssets;
        }
        return [];
    };

    const executeRaw: RawHandler = async (arg) => {
        scenario.executed.push(extractSql(arg));
        return 1;
    };

    const client = {
        $queryRaw: mock.fn(queryRaw),
        $executeRaw: mock.fn(executeRaw),
        $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(client),
    };
    return client as unknown as PrismaClient;
}

function rejectedLockRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 42n,
        public_id: REPORT_PUBLIC_ID,
        status_code: "rejected",
        report_type_code: "wrong_location",
        created_by: 7n,
        survey_session_id: 9n,
        target_entity_type: "stop",
        target_public_id: "11111111-1111-4111-8111-111111111111",
        created_at: new Date("2026-09-01T12:00:00.000Z"),
        ...overrides,
    };
}

describe("ReportsRepository permanent delete", () => {
    it("deletes a rejected report and only owned child rows", async () => {
        const scenario: Scenario = {
            lockRows: [rejectedLockRow()],
            linkedAssets: [
                {
                    asset_id: 100n,
                    object_key: "private/report-42/a.jpg",
                    storage_scope: "private",
                },
            ],
            deletedAssets: [{ object_key: "private/report-42/a.jpg", storage_scope: "private" }],
            executed: [],
            lockCalls: 0,
        };
        const repo = new ReportsRepository(createMockPrisma(scenario));
        const result = await repo.permanentDeleteRejected(REPORT_PUBLIC_ID, {
            actorUserId: 1n,
            ipAddress: "127.0.0.1",
            userAgent: "test",
        });

        assert.deepEqual(result, {
            publicId: REPORT_PUBLIC_ID,
            reportTypeCode: "wrong_location",
            storageObjects: [{ objectKey: "private/report-42/a.jpg", storageScope: "private" }],
        });

        const joined = scenario.executed.join("\n");
        assert.match(joined, /DELETE FROM feedback\.report_followups/);
        assert.match(joined, /DELETE FROM feedback\.report_status_events/);
        assert.match(joined, /DELETE FROM feedback\.report_media/);
        assert.match(joined, /DELETE FROM feedback\.user_reports/);
        assert.match(joined, /INSERT INTO system\.audit_logs/);
        assert.doesNotMatch(joined, /DELETE FROM transport\.(stops|routes|route_stops)/);
        assert.doesNotMatch(joined, /DELETE FROM app_auth\.auth_users/);
        assert.doesNotMatch(joined, /DELETE FROM feedback\.survey_sessions|survey_sessions/);
    });

    it("refuses open and resolved reports with conflict", async () => {
        for (const status_code of ["submitted", "in_review", "resolved"]) {
            const scenario: Scenario = {
                lockRows: [rejectedLockRow({ status_code })],
                linkedAssets: [],
                deletedAssets: [],
                executed: [],
                lockCalls: 0,
            };
            const repo = new ReportsRepository(createMockPrisma(scenario));
            await assert.rejects(
                () =>
                    repo.permanentDeleteRejected(REPORT_PUBLIC_ID, {
                        actorUserId: 1n,
                        ipAddress: null,
                        userAgent: null,
                    }),
                (error: unknown) =>
                    error instanceof ReportDeleteNotRejectedError &&
                    error.currentStatus === status_code
            );
            assert.equal(scenario.executed.length, 0);
        }
    });

    it("returns null when the report is already gone (retry / concurrent)", async () => {
        const scenario: Scenario = {
            lockRows: [],
            linkedAssets: [],
            deletedAssets: [],
            executed: [],
            lockCalls: 0,
        };
        const repo = new ReportsRepository(createMockPrisma(scenario));
        const result = await repo.permanentDeleteRejected(REPORT_PUBLIC_ID, {
            actorUserId: 1n,
            ipAddress: null,
            userAgent: null,
        });
        assert.equal(result, null);
        assert.equal(scenario.executed.length, 0);
    });

    it("keeps storage keys only for assets actually deleted from media.assets", async () => {
        const scenario: Scenario = {
            lockRows: [rejectedLockRow()],
            linkedAssets: [
                {
                    asset_id: 100n,
                    object_key: "private/owned.jpg",
                    storage_scope: "private",
                },
                {
                    asset_id: 101n,
                    object_key: "private/published-source.jpg",
                    storage_scope: "private",
                },
            ],
            // Only the orphaned asset is returned by DELETE ... RETURNING
            deletedAssets: [{ object_key: "private/owned.jpg", storage_scope: "private" }],
            executed: [],
            lockCalls: 0,
        };
        const repo = new ReportsRepository(createMockPrisma(scenario));
        const result = await repo.permanentDeleteRejected(REPORT_PUBLIC_ID, {
            actorUserId: 1n,
            ipAddress: null,
            userAgent: null,
        });
        assert.deepEqual(result?.storageObjects, [
            { objectKey: "private/owned.jpg", storageScope: "private" },
        ]);
        assert.ok(!result?.storageObjects.some((o) => o.objectKey.includes("published")));
        void OTHER_REPORT_PUBLIC_ID;
    });
});
