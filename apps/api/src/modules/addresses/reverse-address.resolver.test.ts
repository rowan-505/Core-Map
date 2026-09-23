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
                return [];
            },
        } as unknown as PrismaClient;

        const repo = new ReverseAddressRepository(prisma);
        await repo.findLandAreaAtPoint({ lat: 16.65997, lng: 96.38362 });

        const sql = queries[0] ?? "";
        assert.match(sql, /lc\.name_en/);
        assert.match(sql, /lc\.name_mm/);
        assert.doesNotMatch(sql, /lc\.name\s+AS\s+class_name/i);
    });
});

describe("reverse address street GiST prefilter", () => {
    it("applies geom && ST_Expand before geography ST_DWithin", async () => {
        const queries: string[] = [];
        const prisma = {
            $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
                // Reconstruct enough SQL text for assertions (Prisma.sql fragments).
                let built = "";
                for (let i = 0; i < strings.length; i += 1) {
                    built += strings[i];
                    if (i < values.length) built += String(values[i] ?? "");
                }
                queries.push(built);
                return [];
            },
        } as unknown as PrismaClient;

        const repo = new ReverseAddressRepository(prisma);
        await repo.findNearbyStreets({ lat: 16.70874, lng: 96.29244 }, 300);

        const sql = queries[0] ?? "";
        assert.match(sql, /s\.geom\s*&&\s*ST_Expand/i);
        assert.match(sql, /ST_DWithin\(\s*s\.geom::geography/i);
        assert.doesNotMatch(sql, /to_regclass/i);
    });
});

describe("reverse layer concurrency helper", () => {
    it("never runs more than the limit concurrently", async () => {
        const { mapWithConcurrencyLimit } = await import("./reverse-address.resolver.js");
        let inFlight = 0;
        let peak = 0;
        const tasks = Array.from({ length: 6 }, (_, i) => async () => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            inFlight -= 1;
            return i;
        });
        const results = await mapWithConcurrencyLimit(tasks, 2);
        assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
        assert.ok(peak <= 2, `peak concurrency was ${peak}`);
    });
});
