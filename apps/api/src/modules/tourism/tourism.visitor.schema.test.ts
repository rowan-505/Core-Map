import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    createTourismAdvisoryBodySchema,
    createTourismFoodBodySchema,
    createTourismFoodPlaceLinkBodySchema,
    createTourismGuideBodySchema,
    listAdminTourismFoodsQuerySchema,
    tourismFoodIdParamSchema,
} from "./tourism.visitor.schema.js";
import { isAdvisoryCurrentlyEffective } from "./tourism.visitor.service.js";

describe("tourism visitor schema validation", () => {
    it("accepts valid food payloads and rejects invalid food_type/labels", () => {
        const ok = createTourismFoodBodySchema.safeParse({
            name: "Mohinga",
            food_type: "dish",
            labels: ["must_try", "street_food"],
            admin_area_id: "1001",
        });
        assert.equal(ok.success, true);

        const badType = createTourismFoodBodySchema.safeParse({
            name: "Mohinga",
            food_type: "meal",
            admin_area_id: "1001",
        });
        assert.equal(badType.success, false);

        const badLabel = createTourismFoodBodySchema.safeParse({
            name: "Mohinga",
            food_type: "dish",
            labels: ["viral"],
            admin_area_id: "1001",
        });
        assert.equal(badLabel.success, false);

        const dupLabels = createTourismFoodBodySchema.safeParse({
            name: "Mohinga",
            food_type: "dish",
            labels: ["must_try", "must_try"],
            admin_area_id: "1001",
        });
        assert.equal(dupLabels.success, false);
    });

    it("rejects mass-assignment fields not in the food schema", () => {
        const result = createTourismFoodBodySchema.safeParse({
            name: "Mohinga",
            food_type: "dish",
            admin_area_id: "1001",
            id: 99,
            popularity_score: 100,
        });
        assert.equal(result.success, false);
    });

    it("parses food list filters", () => {
        const result = listAdminTourismFoodsQuerySchema.safeParse({
            admin_area_id: "42",
            food_type: "snack",
            label: "seasonal",
            is_active: "true",
            is_verified: "0",
            q: "mohinga",
        });
        assert.equal(result.success, true);
        if (result.success) {
            assert.equal(result.data.admin_area_id, "42");
            assert.equal(result.data.is_active, true);
            assert.equal(result.data.is_verified, false);
            assert.equal(result.data.label, "seasonal");
        }
    });

    it("rejects malformed public ids", () => {
        assert.equal(tourismFoodIdParamSchema.safeParse({ id: "not-a-uuid" }).success, false);
        assert.equal(
            createTourismFoodPlaceLinkBodySchema.safeParse({
                place_public_id: "bad",
            }).success,
            false
        );
    });

    it("validates guide and advisory enums and effective range", () => {
        assert.equal(
            createTourismGuideBodySchema.safeParse({
                admin_area_id: "1",
                guide_type: "etiquette",
                title: "Temple tips",
                content: "Remove shoes.",
            }).success,
            true
        );
        assert.equal(
            createTourismGuideBodySchema.safeParse({
                admin_area_id: "1",
                guide_type: "tips",
                title: "x",
                content: "y",
            }).success,
            false
        );

        const badRange = createTourismAdvisoryBodySchema.safeParse({
            admin_area_id: "1",
            advisory_type: "access",
            title: "Bridge closed",
            description: "Detour required.",
            severity: "important",
            effective_from: "2026-06-01T00:00:00.000Z",
            effective_until: "2026-05-01T00:00:00.000Z",
        });
        assert.equal(badRange.success, false);

        const badSeverity = createTourismAdvisoryBodySchema.safeParse({
            admin_area_id: "1",
            advisory_type: "access",
            title: "Bridge closed",
            description: "Detour required.",
            severity: "critical",
        });
        assert.equal(badSeverity.success, false);
    });
});

describe("isAdvisoryCurrentlyEffective", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");

    it("allows advisories with no effective window", () => {
        assert.equal(
            isAdvisoryCurrentlyEffective({ effectiveFrom: null, effectiveUntil: null }, now),
            true
        );
    });

    it("hides advisories before effective_from", () => {
        assert.equal(
            isAdvisoryCurrentlyEffective(
                {
                    effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
                    effectiveUntil: null,
                },
                now
            ),
            false
        );
    });

    it("hides advisories after effective_until", () => {
        assert.equal(
            isAdvisoryCurrentlyEffective(
                {
                    effectiveFrom: null,
                    effectiveUntil: new Date("2026-06-01T00:00:00.000Z"),
                },
                now
            ),
            false
        );
    });

    it("includes advisories inside the window", () => {
        assert.equal(
            isAdvisoryCurrentlyEffective(
                {
                    effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
                    effectiveUntil: new Date("2026-06-30T00:00:00.000Z"),
                },
                now
            ),
            true
        );
    });
});
