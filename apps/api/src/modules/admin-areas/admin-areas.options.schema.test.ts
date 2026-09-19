import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { adminAreaOptionsQuerySchema } from "./admin-areas.schema.js";

describe("adminAreaOptionsQuerySchema", () => {
    it("accepts state_region level and region ancestor filter", () => {
        const parsed = adminAreaOptionsQuerySchema.parse({
            limit: "50",
            admin_level_code: "state_region",
        });
        assert.equal(parsed.admin_level_code, "state_region");
        assert.equal(parsed.limit, 50);

        const township = adminAreaOptionsQuerySchema.parse({
            admin_level_code: "township",
            region_admin_area_id: "12",
        });
        assert.equal(township.admin_level_code, "township");
        assert.equal(township.region_admin_area_id, "12");
    });

    it("rejects non-numeric region_admin_area_id", () => {
        assert.throws(() =>
            adminAreaOptionsQuerySchema.parse({
                admin_level_code: "township",
                region_admin_area_id: "abc",
            })
        );
    });
});
