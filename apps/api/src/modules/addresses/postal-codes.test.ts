import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { PostalCodesRepository } from "./postal-codes.repo.js";
import { postalCodeParamSchema } from "./postal-codes.schema.js";

function sqlText(query: unknown): string {
    if (typeof query === "string") {
        return query;
    }
    if (query && typeof query === "object" && typeof (query as { length?: unknown }).length === "number") {
        return Array.from(query as ArrayLike<string>).join("?");
    }
    if (query && typeof query === "object" && "strings" in query) {
        const strings = (query as { strings: readonly string[] }).strings;
        return Array.isArray(strings) ? strings.join("?") : String(query);
    }
    return String(query);
}

describe("postalCodeParamSchema", () => {
    it("accepts seven-digit codes", () => {
        assert.equal(postalCodeParamSchema.parse({ postalCode: "0101001" }).postalCode, "0101001");
    });

    it("rejects malformed codes", () => {
        assert.throws(() => postalCodeParamSchema.parse({ postalCode: "114560" }));
        assert.throws(() => postalCodeParamSchema.parse({ postalCode: "abc" }));
    });
});

describe("PostalCodesRepository.search", () => {
    it("uses postal_code prefix match for numeric q", async () => {
        const queries: string[] = [];
        const prisma = {
            $queryRaw: async (query: unknown) => {
                queries.push(sqlText(query));
                if (/count\(\*\)/i.test(sqlText(query))) {
                    return [{ count: 1n }];
                }
                return [
                    {
                        postal_code: "0101001",
                        region_name_en: "Kachin",
                        region_name_my: null,
                        township_name_en: "Myitkyina",
                        township_name_my: null,
                        locality_name_en: null,
                        locality_name_my: null,
                        locality_type: null,
                        township_admin_area_id: 1n,
                        local_admin_area_id: null,
                        match_status: "linked_township_only",
                        match_method: "exact",
                        source_name: "Myanmar Post",
                        source_version: "V1.0",
                    },
                ];
            },
        } as unknown as PrismaClient;

        const repo = new PostalCodesRepository(prisma);
        const result = await repo.search({ limit: 10, offset: 0, q: "0101" });
        assert.equal(result.total, 1);
        assert.equal(result.rows[0]?.postal_code, "0101001");
        assert.ok(queries.length >= 2);
        assert.ok(queries.some((q) => /ref_postal_codes/i.test(q)));
    });
});
