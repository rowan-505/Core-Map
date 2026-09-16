import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    canPermanentlyDeleteReport,
    classifyReportPermanentDeleteError,
    removeReportFromList,
    reportDeleteDialogSummary,
} from "./reportPermanentDelete";
import type { AdminReport, AdminReportList } from "./types";

function report(overrides: Partial<AdminReport> = {}): AdminReport {
    return {
        public_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        is_anonymous: false,
        eligible_for_points: false,
        report_type: { code: "wrong_location", name: "Wrong location" },
        status: { code: "rejected", name: "Rejected" },
        reason_code: null,
        target_entity_type: "stop",
        target_entity_id: "1",
        target_public_id: "11111111-1111-4111-8111-111111111111",
        title: null,
        description: "test",
        latitude: null,
        longitude: null,
        admin_area_id: null,
        priority: "normal",
        confidence_score: 50,
        admin_note: null,
        reviewed_at: null,
        reward_granted_at: null,
        created_at: "2026-09-01T12:00:00.000Z",
        updated_at: "2026-09-01T12:00:00.000Z",
        anonymous_id: null,
        author: null,
        source_code: "field_survey",
        observed_at: "2026-09-01T11:00:00.000Z",
        location_accuracy_m: 8,
        field: {
            route_code: "YBS-1",
            variant_code: "D0",
            stop_name: "Sule",
            stop_public_id: "11111111-1111-4111-8111-111111111111",
            origin_name: null,
            destination_name: null,
            survey_session_public_id: null,
            survey_session_status: null,
        },
        canonical_target: null,
        distance_m: null,
        media_count: 0,
        review: null,
        ...overrides,
    } as AdminReport;
}

describe("report permanent delete helpers", () => {
    it("allows delete only for rejected status", () => {
        assert.equal(canPermanentlyDeleteReport("rejected"), true);
        assert.equal(canPermanentlyDeleteReport("submitted"), false);
        assert.equal(canPermanentlyDeleteReport("resolved"), false);
        assert.equal(canPermanentlyDeleteReport("REJECTED"), false);
    });

    it("removes only the matching row from list cache", () => {
        const keep = report({ public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
        const remove = report();
        const list: AdminReportList = {
            items: [keep, remove],
            total: 2,
            page: 1,
            pageSize: 25,
        };
        const next = removeReportFromList(list, remove.public_id);
        assert.equal(next?.items.length, 1);
        assert.equal(next?.items[0]?.public_id, keep.public_id);
        assert.equal(next?.total, 1);
    });

    it("builds dialog summary from type, route/stop, and timestamp", () => {
        const summary = reportDeleteDialogSummary(report());
        assert.equal(summary.reportType, "Wrong location");
        assert.match(summary.related, /YBS-1/);
        assert.match(summary.related, /Sule/);
        assert.equal(summary.timestamp, "2026-09-01T11:00:00.000Z");
    });

    it("classifies delete errors for UI", () => {
        assert.equal(
            classifyReportPermanentDeleteError(new Error("Report not found")).kind,
            "not_found"
        );
        assert.equal(
            classifyReportPermanentDeleteError(new Error("Insufficient role")).kind,
            "forbidden"
        );
        assert.equal(
            classifyReportPermanentDeleteError(
                new Error("Report cannot be permanently deleted unless its status is rejected (current: 'resolved')")
            ).kind,
            "conflict"
        );
        assert.equal(
            classifyReportPermanentDeleteError(new Error("Failed to fetch")).kind,
            "network"
        );
    });
});
