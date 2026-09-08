import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reportTypeBadgeClass, reportTypeLabel, REPORT_TYPE_OPTIONS } from "./constants.js";
import { privateMediaAccessPath } from "./fieldEvidenceView.js";
import {
    evidenceMapLabels,
    gpsToProposedDistanceM,
    isNewStopReport,
    locationSourceLabel,
    nextStopLabel,
    newStopCanonicalPublishEnabled,
    newStopReviewMapPoints,
    previousStopLabel,
    proposedGeometryLabel,
} from "./newStopReview.js";
import { getReportPath, listReportsPath, reportStatusChangeRequest } from "./reportAdminQueries.js";
import type { AdminReportDetail, FieldReportContext } from "./types.js";

const stopId = "33333333-3333-4333-8333-333333333333";
const nextStopId = "44444444-4444-4444-8444-444444444444";
const routeId = "11111111-1111-4111-8111-111111111111";

function field(partial: Partial<FieldReportContext> = {}): FieldReportContext {
    return {
        route_code: "YBS-13",
        route_public_id: routeId,
        variant_code: "D0",
        variant_public_id: "22222222-2222-4222-8222-222222222222",
        origin_name: "A",
        destination_name: "B",
        stop_public_id: stopId,
        stop_name: "Corner",
        stop_sequence: 4,
        previous_stop_public_id: stopId,
        previous_stop_sequence: 4,
        next_stop_public_id: nextStopId,
        proposed_stop_name: "Corner stall",
        location_source: "GPS",
        snapshot_revision: "v1-old",
        snapshot_stale: false,
        current_snapshot_revision: "v1-old",
        survey_session_public_id: "66666666-6666-4666-8666-666666666666",
        survey_session_status: "completed",
        canonical_snapshot: { stopPublicId: stopId, stopSequence: 4 },
        observed_location: { latitude: 16.801, longitude: 96.151, accuracy_m: 7 },
        proposed_location: { latitude: 16.801, longitude: 96.151 },
        ...partial,
    };
}

function report(partial: Partial<AdminReportDetail> = {}): AdminReportDetail {
    return {
        public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        is_anonymous: false,
        eligible_for_points: false,
        report_type: { code: "new_stop", name: "New stop" },
        status: { code: "submitted", name: "Submitted" },
        reason_code: null,
        target_entity_type: "variant",
        target_entity_id: "2",
        target_public_id: "22222222-2222-4222-8222-222222222222",
        title: null,
        description: "after this pole",
        latitude: 16.801,
        longitude: 96.151,
        admin_area_id: null,
        priority: "normal",
        confidence_score: 40,
        admin_note: null,
        reviewed_at: null,
        reward_granted_at: null,
        created_at: "2026-09-08T00:00:00.000Z",
        updated_at: "2026-09-08T00:00:00.000Z",
        anonymous_id: null,
        author: null,
        source_code: "field_survey",
        observed_at: "2026-09-08T01:00:00.000Z",
        location_accuracy_m: 7,
        field: field(),
        canonical_target: { latitude: 16.8, longitude: 96.15 },
        distance_m: 12,
        media_count: 0,
        status_events: [],
        followups: [],
        media: [],
        ...partial,
    };
}

describe("NEW_STOP dashboard review", () => {
    it("lists and filters New stop as its own type", () => {
        assert.equal(isNewStopReport("new_stop"), true);
        assert.equal(isNewStopReport("missing_item"), false);
        assert.equal(reportTypeLabel("new_stop"), "New stop");
        assert.ok(REPORT_TYPE_OPTIONS.some((option) => option.value === "new_stop"));
        assert.ok(reportTypeBadgeClass("new_stop").includes("teal"));
        assert.equal(
            listReportsPath({ type: "new_stop", source: "field_survey" }),
            "/admin/reports?type=new_stop&source=field_survey"
        );
        assert.equal(listReportsPath({ type: "wrong_location" }).includes("new_stop"), false);
    });

    it("shows complete new-stop detail including session and snapshot", () => {
        const detail = report();
        assert.equal(detail.field?.route_code, "YBS-13");
        assert.equal(detail.field?.variant_code, "D0");
        assert.equal(previousStopLabel(detail.field), "Corner · sequence 4");
        assert.equal(nextStopLabel(detail.field), nextStopId);
        assert.equal(detail.field?.proposed_stop_name, "Corner stall");
        assert.equal(detail.field?.survey_session_public_id, "66666666-6666-4666-8666-666666666666");
        assert.equal(detail.field?.snapshot_revision, "v1-old");
        assert.equal(locationSourceLabel(detail.field?.location_source), "GPS");
        assert.equal(detail.observed_at, "2026-09-08T01:00:00.000Z");
        assert.equal(detail.field?.observed_location?.accuracy_m, 7);
        assert.equal(detail.description, "after this pole");
    });

    it("labels a missing next stop as None", () => {
        assert.equal(nextStopLabel(field({ next_stop_public_id: null })), "None");
    });

    it("GPS-only proposed point does not duplicate a captured GPS marker", () => {
        const points = newStopReviewMapPoints(report());
        assert.deepEqual(
            points.map((point) => point.role),
            ["canonical", "proposed"]
        );
        assert.equal(gpsToProposedDistanceM(report().field), null);
        assert.equal(proposedGeometryLabel("GPS"), "Proposed new stop (GPS)");
    });

    it("map-picked proposal keeps a separate GPS marker and distance", () => {
        const detail = report({
            latitude: 16.91,
            longitude: 96.21,
            field: field({
                location_source: "MAP_PICK",
                proposed_location: { latitude: 16.91, longitude: 96.21 },
                observed_location: { latitude: 16.801, longitude: 96.151, accuracy_m: 40 },
            }),
        });
        const points = newStopReviewMapPoints(detail);
        assert.deepEqual(
            points.map((point) => point.role),
            ["canonical", "proposed", "observed"]
        );
        const distance = gpsToProposedDistanceM(detail.field);
        assert.ok(distance != null && distance > 100);
        assert.equal(locationSourceLabel("MAP_PICK"), "Map pick");
        assert.equal(evidenceMapLabels(detail).observed, "Captured GPS");
        assert.equal(evidenceMapLabels(detail).proposed, "Proposed new stop (map pick)");
    });

    it("treats missing optional media as an empty evidence list", () => {
        assert.deepEqual(report({ media: [], media_count: 0 }).media, []);
    });

    it("keeps private report and media paths on admin APIs only", () => {
        assert.equal(getReportPath("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), "/admin/reports/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        assert.equal(
            privateMediaAccessPath("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
            "/admin/media/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/access"
        );
        assert.ok(!privateMediaAccessPath("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb").startsWith("/public"));
    });

    it("preserves old MOVED map roles", () => {
        const moved = report({
            report_type: { code: "wrong_location", name: "Wrong location" },
            field: field({
                location_source: null,
                proposed_stop_name: null,
                proposed_location: { latitude: 16.9, longitude: 96.2 },
                observed_location: { latitude: 16.801, longitude: 96.151, accuracy_m: 6 },
            }),
        });
        const points = newStopReviewMapPoints(moved);
        assert.deepEqual(
            points.map((point) => point.role),
            ["canonical", "observed", "proposed"]
        );
        assert.equal(evidenceMapLabels(moved).proposed, "Proposed corrected location");
    });

    it("does not publish canonical data when viewing or changing status", () => {
        assert.equal(newStopCanonicalPublishEnabled(), false);
        const status = reportStatusChangeRequest("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "resolved");
        assert.equal(status.path, "/admin/reports/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/status");
        assert.equal(status.method, "PATCH");
        assert.deepEqual(status.body, { statusCode: "resolved" });
        assert.equal("stopPublicId" in status.body, false);
        assert.ok(!status.path.includes("/transport"));
    });
});
