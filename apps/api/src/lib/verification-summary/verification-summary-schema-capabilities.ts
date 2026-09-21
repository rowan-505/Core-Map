import { type PrismaClient } from "@prisma/client";

import type { VerificationSummaryCaps } from "./verification-summary.types.js";

type ColumnRow = { column_name: string };

function splitQualifiedTable(qualifiedTable: string): { schema: string; table: string } {
    const [schema, table] = qualifiedTable.includes(".")
        ? qualifiedTable.split(".", 2)
        : ["public", qualifiedTable];
    return { schema: schema!, table: table! };
}

/**
 * Cached information_schema lookups for verification-summary (core.* tables).
 * Replaces the former Import Review schema-capability registry for this path only.
 */
export class VerificationSummarySchemaCapabilityRegistry {
    private readonly columnCache = new Map<string, ColumnRow[]>();

    constructor(private readonly prisma: PrismaClient) {}

    async getTargetColumnCapabilities(targetTable: string): Promise<VerificationSummaryCaps> {
        const { schema, table } = splitQualifiedTable(targetTable);
        const key = `${schema}.${table}`;
        let rows = this.columnCache.get(key);
        if (!rows) {
            rows = await this.prisma.$queryRaw<ColumnRow[]>`
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = ${schema}
                  AND table_name = ${table}
                ORDER BY ordinal_position
            `;
            this.columnCache.set(key, rows);
        }

        const columns = new Set(rows.map((row) => row.column_name));
        const hasColumn = (column: string) => columns.has(column);

        return {
            columns,
            hasColumn,
            hasVerificationStatus: hasColumn("verification_status"),
            hasIsVerified: hasColumn("is_verified"),
            hasDeletedAt: hasColumn("deleted_at"),
        };
    }
}
