import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    accuracyCircleCoordinates,
    evidenceMapPoints,
    fieldTransportEditorHref,
    privateMediaAccessPath,
    sessionFinalizationLabel,
} from "./fieldEvidenceView.js";
import type { AdminReportDetail } from "./types.js";

const stopId = "33333333-3333-4333-8333-333333333333";
const routeId = "11111111-1111-4111-8111-111111111111";

function report(partial: Partial<AdminReportDetail> = {}): AdminReportDetail {
    return {
        public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        is_anonymous: false,
        eligible_for_points: false,
        report_type: { code: "wrong_location", name: "Wrong location" },
        status: { code: "submitted", name: "Submitted" },
        reason_code: null,
        target_entity_type: "stop",
        target_entity_id: "1",
        target_public_id: stopId,
        title: null,
        description: "Moved",
        latitude: 16.9,
        longitude: 96.2,
        admin_area_id: null,
        priority: "normal",
        confidence_score: 40,
        admin_note: null,
        reviewed_at: null,
        reward_granted_at: null,
        created_at: "2026-09-04T00:00:00.000Z",
        updated_at: "2026-09-04T00:00:00.000Z",
        anonymous_id: null,
        author: null,
        source_code: "field_survey",
        observed_at: "2026-09-04T01:00:00.000Z",
        location_accuracy_m: 8,
        field: {
            route_code: "YBS-13",
            route_public_id: routeId,
            variant_code: "D0",
            variant_public_id: "22222222-2222-4222-8222-222222222222",
            origin_name: "A",
            destination_name: "B",
            stop_public_id: stopId,
            stop_name: "First",
            stop_sequence: 2,
            snapshot_revision: "v1-old",
            snapshot_stale: true,
            current_snapshot_revision: "v1-new",
            survey_session_public_id: "66666666-6666-4666-8666-666666666666",
            survey_session_status: "completed",
            canonical_snapshot: null,
            observed_location: { latitude: 16.801, longitude: 96.151, accuracy_m: 6 },
            proposed_location: { latitude: 16.9, longitude: 96.2 },
        },
        canonical_target: { latitude: 16.8, longitude: 96.15 },
        distance_m: 120,
        media_count: 0,
        status_events: [],
        followups: [],
        media: [],
        ...partial,
    };
}

describe("field evidence review helpers", () => {
    it("links a stop-level report to the stop editor", () => {
        assert.equal(
            fieldTransportEditorHref(report().field),
            `/dashboard/transport/stops?stop=${stopId}`
        );
    });

    it("links a route-level report to the route editor", () => {
        const field = report().field!;
        assert.equal(
            fieldTransportEditorHref({ ...field, stop_public_id: null }),
            `/dashboard/transport/routes?route=${routeId}`
        );
    });

    it("labels survey session finalization", () => {
        assert.equal(sessionFinalizationLabel("completed"), "Survey session completed");
        assert.equal(sessionFinalizationLabel(null), "No survey session linked");
    });

    it("MOVED map points keep canonical, observed, and proposed distinct", () => {
        const points = evidenceMapPoints(report());
        assert.deepEqual(
            points.map((point) => point.role),
            ["canonical", "observed", "proposed"]
        );
        assert.equal(points[0]?.latitude, 16.8);
        assert.equal(points[1]?.latitude, 16.801);
        assert.equal(points[2]?.latitude, 16.9);
        assert.equal(points[1]?.accuracyM, 6);
    });

    it("treats missing media as an empty evidence list", () => {
        assert.deepEqual(report({ media: [] }).media, []);
    });

    it("builds a closed accuracy ring in meters", () => {
        const ring = accuracyCircleCoordinates(96.15, 16.8, 25);
        assert.equal(ring[0]![0], ring[ring.length - 1]![0]);
        assert.equal(ring[0]![1], ring[ring.length - 1]![1]);
        assert.ok(ring.length > 8);
    });

    it("uses the signed private admin media access path", () => {
        assert.equal(
            privateMediaAccessPath("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
            "/admin/media/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/access"
        );
    });
});
