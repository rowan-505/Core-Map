import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";

import { TransportRepository } from "../transport/transport.repo.js";

function sqlText(value: unknown): string {
    if (value && typeof value === "object") {
        const record = value as { strings?: readonly string[] };
        if (record.strings) {
            return record.strings.join("?");
        }
    }
    return String(value);
}

test("report transport context uses two bounded active-only geography reads", async () => {
    const statements: string[] = [];
    const prisma = {
        $queryRaw: async (query: unknown) => {
            statements.push(sqlText(query));
            return [];
        },
    } as unknown as PrismaClient;

    const result = await new TransportRepository(prisma).getReportReviewContext({
        stopPublicId: "33333333-3333-4333-8333-333333333333",
        routePublicId: "11111111-1111-4111-8111-111111111111",
        variantPublicId: "22222222-2222-4222-8222-222222222222",
        observer: { latitude: 16.8, longitude: 96.15 },
        proposed: { latitude: 16.9, longitude: 96.2 },
    });

    assert.equal(statements.length, 2);
    const sql = statements.join("\n");
    assert.match(sql, /is_active IS TRUE/);
    assert.match(sql, /deleted_at IS NULL/);
    assert.match(sql, /ST_Distance/);
    assert.match(sql, /::geography/);
    assert.match(
        sql,
        /ORDER BY\s+lower\(r\.route_code\) ASC,\s+lower\(v\.variant_code\) ASC,\s+rs\.stop_sequence ASC/
    );
    assert.equal(result.stop, null);
    assert.deepEqual(result.affectedRoutes, []);
});
