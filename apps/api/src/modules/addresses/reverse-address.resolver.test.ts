import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { isLocalityHintAdmin, isOfficialAdmin } from "./reverse-address.constants.js";
import { ReverseAddressRepository } from "./reverse-address.repo.js";

describe("reverse address admin boundary rules", () => {
    it("treats settlement_extent + locality_hint as locality only", () => {
        assert.equal(isLocalityHintAdmin("settlement_extent", "locality_hint"), true);
        assert.equal(isOfficialAdmin("settlement_extent", "locality_hint"), false);
    });

    it("treats official boundary + official usage as official", () => {
        assert.equal(isOfficialAdmin("official", "official"), true);
        assert.equal(isLocalityHintAdmin("official", "official"), false);
    });

    it("does not treat approximate boundary as official even when usage is official", () => {
        assert.equal(isOfficialAdmin("approximate", "official"), false);
    });
});

describe("reverse address land-area lookup", () => {
    it("uses the current bilingual land-area class columns", async () => {
        const queries: string[] = [];
        const prisma = {
            $queryRaw: async (strings: TemplateStringsArray) => {
                queries.push(strings.join(""));
                return queries.length === 1 ? [{ ok: true }] : [];
            },
        } as unknown as PrismaClient;

        const repo = new ReverseAddressRepository(prisma);
        await repo.findLandAreaAtPoint({ lat: 16.65997, lng: 96.38362 });

        const sql = queries[1] ?? "";
        assert.match(sql, /lc\.name_en/);
        assert.match(sql, /lc\.name_mm/);
        assert.doesNotMatch(sql, /lc\.name\s+AS\s+class_name/i);
    });
});
