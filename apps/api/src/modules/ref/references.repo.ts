import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import {
    ALLOWED_REF_TABLES,
    getReferenceConfig,
    type ReferenceTableConfig,
} from "./references.registry.js";
import type { ReferenceTypeKey } from "./references.types.js";

function assertAllowlistedTable(table: string): string {
    if (!ALLOWED_REF_TABLES.has(table)) {
        throw new Error(`Reference table is not allowlisted: ${table}`);
    }
    return table;
}

function tableSql(table: string): Prisma.Sql {
    return Prisma.raw(`ref.${assertAllowlistedTable(table)}`);
}

function columnSql(column: string, allowed: ReadonlySet<string>): Prisma.Sql {
    if (!allowed.has(column)) {
        throw new Error(`Column is not allowlisted: ${column}`);
    }
    return Prisma.raw(column);
}

function orderBySql(orderBy: readonly string[]): Prisma.Sql {
    // Fragments are static strings from the server registry only.
    return Prisma.raw(orderBy.join(", "));
}

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
        if (typeof value === "bigint") {
            out[key] = value.toString();
        } else if (value instanceof Date) {
            out[key] = value.toISOString();
        } else if (
            value !== null &&
            typeof value === "object" &&
            "toNumber" in value &&
            typeof (value as { toNumber: () => number }).toNumber === "function"
        ) {
            out[key] = Number(value);
        } else {
            out[key] = value;
        }
    }
    return out;
}

function readErrorCodes(error: unknown): string[] {
    if (!error || typeof error !== "object") {
        return [];
    }
    const codes: string[] = [];
    const top = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
    if (typeof top.code === "string") {
        codes.push(top.code);
    }
    if (typeof top.meta?.code === "string") {
        codes.push(top.meta.code);
    }
    if (typeof top.message === "string") {
        if (top.message.includes("23505")) codes.push("23505");
        if (top.message.includes("23503")) codes.push("23503");
    }
    return codes;
}

export function isUniqueViolation(error: unknown): boolean {
    const codes = readErrorCodes(error);
    return codes.includes("23505") || codes.includes("P2002");
}

export function isForeignKeyViolation(error: unknown): boolean {
    const codes = readErrorCodes(error);
    return codes.includes("23503") || codes.includes("P2003");
}

export class ReferencesRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async countRows(config: ReferenceTableConfig): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS n FROM ${tableSql(config.table)}
        `);
        return Number(rows[0]?.n ?? 0n);
    }

    async list(config: ReferenceTableConfig): Promise<Record<string, unknown>[]> {
        const allowed = new Set(config.columns);
        const selectParts = config.columns.map((col) => {
            if (col === "id" || col === "parent_id") {
                return Prisma.sql`${columnSql(col, allowed)}::text AS ${Prisma.raw(col)}`;
            }
            return Prisma.sql`${columnSql(col, allowed)}`;
        });

        const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT ${Prisma.join(selectParts, ", ")}
            FROM ${tableSql(config.table)}
            ORDER BY ${orderBySql(config.orderBy)}
        `);

        const items = rows.map(serializeRow);

        if (!config.usageSql) {
            return items.map((item) => ({ ...item, usage_count: null }));
        }

        const withUsage: Record<string, unknown>[] = [];
        for (const item of items) {
            const usage = await this.countUsage(config, String(item.id), String(item.code));
            withUsage.push({ ...item, usage_count: usage });
        }
        return withUsage;
    }

    async countUsage(config: ReferenceTableConfig, id: string, code: string): Promise<number> {
        if (!config.usageSql) {
            return 0;
        }
        // usageSql is a static registry string with $1/$2 placeholders only.
        const rows = await this.prisma.$queryRawUnsafe<{ n: bigint }[]>(config.usageSql, id, code);
        return Number(rows[0]?.n ?? 0n);
    }

    async findById(
        config: ReferenceTableConfig,
        id: string,
    ): Promise<Record<string, unknown> | null> {
        const allowed = new Set(config.columns);
        const selectParts = config.columns.map((col) => {
            if (col === "id" || col === "parent_id") {
                return Prisma.sql`${columnSql(col, allowed)}::text AS ${Prisma.raw(col)}`;
            }
            return Prisma.sql`${columnSql(col, allowed)}`;
        });

        const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT ${Prisma.join(selectParts, ", ")}
            FROM ${tableSql(config.table)}
            WHERE id = ${id}::bigint
            LIMIT 1
        `);
        const row = rows[0];
        return row ? serializeRow(row) : null;
    }

    async existsId(config: ReferenceTableConfig, id: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>(Prisma.sql`
            SELECT EXISTS(
                SELECT 1 FROM ${tableSql(config.table)} WHERE id = ${id}::bigint
            ) AS ok
        `);
        return Boolean(rows[0]?.ok);
    }

    async wouldCreateHierarchyCycle(
        config: ReferenceTableConfig,
        rowId: string,
        newParentId: string,
    ): Promise<boolean> {
        if (rowId === newParentId) {
            return true;
        }
        const rows = await this.prisma.$queryRaw<{ cycle: boolean }[]>(Prisma.sql`
            WITH RECURSIVE descendants AS (
                SELECT id
                FROM ${tableSql(config.table)}
                WHERE parent_id = ${rowId}::bigint
                UNION ALL
                SELECT t.id
                FROM ${tableSql(config.table)} AS t
                INNER JOIN descendants AS d ON t.parent_id = d.id
            )
            SELECT EXISTS(
                SELECT 1 FROM descendants WHERE id = ${newParentId}::bigint
            ) AS cycle
        `);
        return Boolean(rows[0]?.cycle);
    }

    async create(
        config: ReferenceTableConfig,
        data: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        const keys = Object.keys(data);
        const allowed = new Set(config.columns.filter((c) => c !== "id" && c !== "created_at" && c !== "updated_at"));
        for (const key of keys) {
            if (!allowed.has(key)) {
                throw new Error(`Column is not allowlisted for insert: ${key}`);
            }
        }

        const colSqls = keys.map((k) => columnSql(k, allowed));
        const values = keys.map((k) => {
            const value = data[k];
            if (k === "parent_id") {
                if (value === null || value === undefined) {
                    return Prisma.sql`NULL`;
                }
                return Prisma.sql`${String(value)}::bigint`;
            }
            return Prisma.sql`${value as string | number | boolean | null}`;
        });

        const returning = config.columns.map((col) => {
            if (col === "id" || col === "parent_id") {
                return Prisma.sql`${Prisma.raw(col)}::text AS ${Prisma.raw(col)}`;
            }
            return Prisma.sql`${Prisma.raw(col)}`;
        });

        const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            INSERT INTO ${tableSql(config.table)} (${Prisma.join(colSqls, ", ")})
            VALUES (${Prisma.join(values, ", ")})
            RETURNING ${Prisma.join(returning, ", ")}
        `);
        return serializeRow(rows[0]!);
    }

    async update(
        config: ReferenceTableConfig,
        id: string,
        data: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
        const keys = Object.keys(data);
        const allowed = new Set(
            config.columns.filter((c) => c !== "id" && c !== "code" && c !== "created_at" && c !== "updated_at"),
        );
        for (const key of keys) {
            if (!allowed.has(key)) {
                throw new Error(`Column is not allowlisted for update: ${key}`);
            }
        }

        const sets = keys.map((k) => {
            const value = data[k];
            if (k === "parent_id") {
                if (value === null || value === undefined) {
                    return Prisma.sql`${columnSql(k, allowed)} = NULL`;
                }
                return Prisma.sql`${columnSql(k, allowed)} = ${String(value)}::bigint`;
            }
            return Prisma.sql`${columnSql(k, allowed)} = ${value as string | number | boolean | null}`;
        });

        if (config.hasUpdatedAt) {
            sets.push(Prisma.sql`updated_at = now()`);
        }

        const returning = config.columns.map((col) => {
            if (col === "id" || col === "parent_id") {
                return Prisma.sql`${Prisma.raw(col)}::text AS ${Prisma.raw(col)}`;
            }
            return Prisma.sql`${Prisma.raw(col)}`;
        });

        const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            UPDATE ${tableSql(config.table)}
            SET ${Prisma.join(sets, ", ")}
            WHERE id = ${id}::bigint
            RETURNING ${Prisma.join(returning, ", ")}
        `);
        if (!rows[0]) {
            throw new Error("Reference row not found after update");
        }
        return serializeRow(rows[0]);
    }
}

export function configForType(type: ReferenceTypeKey): ReferenceTableConfig {
    return getReferenceConfig(type);
}
