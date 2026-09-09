import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reportTypeLabel, statusLabel } from "./constants";

describe("report management labels", () => {
    it("formats current and legacy report type codes for operators", () => {
        assert.equal(reportTypeLabel("wrong_location"), "Wrong location");
        assert.equal(reportTypeLabel("duplicate_place"), "Duplicate place");
        assert.equal(reportTypeLabel("future_report_code"), "future report code");
    });

    it("formats current and legacy status codes for operators", () => {
        assert.equal(statusLabel("in_review"), "In review");
        assert.equal(statusLabel("under_review"), "Under review");
        assert.equal(statusLabel("future_status"), "future status");
    });
});
