import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { placeContactBodySchema, updatePlaceBodySchema } from "./places.schema.js";

describe("updatePlaceBodySchema integrity", () => {
    it("rejects popularityScore on PATCH (derived field)", () => {
        const parsed = updatePlaceBodySchema.safeParse({
            importanceScore: 70,
            popularityScore: 40,
        });
        assert.equal(parsed.success, false);
    });

    it("rejects importance outside 0..100", () => {
        const parsed = updatePlaceBodySchema.safeParse({ importanceScore: 140 });
        assert.equal(parsed.success, false);
    });

    it("accepts verification_note and importance", () => {
        const parsed = updatePlaceBodySchema.safeParse({
            importanceScore: 80,
            verification_note: "Checked on site",
            verification_status: "verified",
        });
        assert.equal(parsed.success, true);
    });

    it("rejects client verified_by / verified_at", () => {
        const parsed = updatePlaceBodySchema.safeParse({
            englishName: "A",
            verified_by: 1,
            verified_at: "2026-01-01T00:00:00Z",
        });
        assert.equal(parsed.success, false);
    });
});

describe("placeContactBodySchema", () => {
    it("rejects invalid website URL", () => {
        const parsed = placeContactBodySchema.safeParse({ website: "not-a-url" });
        assert.equal(parsed.success, false);
    });

    it("accepts http contact fields", () => {
        const parsed = placeContactBodySchema.safeParse({
            phone: "+95 1 234",
            website: "https://example.com",
            facebookUrl: "https://facebook.com/example",
            email: "a@b.com",
            openingHours: "09:00-17:00",
        });
        assert.equal(parsed.success, true);
    });
});
