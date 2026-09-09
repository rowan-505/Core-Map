import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    SURVEY_OUTSIDE_MAP_MESSAGE,
    buildEvidenceMapModel,
    evidenceMapFitPoints,
    isValidEvidenceCoordinate,
} from "./evidenceMapModel.js";
import type { AdminReportDetail, ReportReview } from "./types.js";

const stopId = "33333333-3333-4333-8333-333333333333";
const prevId = "22222222-2222-4222-8222-222222222221";
const nextId = "22222222-2222-4222-8222-222222222223";

function review(partial: Partial<ReportReview> = {}): ReportReview {
    return {
        report_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        report_type: "wrong_location",
        status: "in_review",
        timestamp: "2026-09-04T01:00:00.000Z",
        kind: "STOP_MOVED",
        route_code: "YBS-13",
        variant_code: "D0",
        target_stop: { public_id: stopId, name: "First", sequence: 3 },
        proposed_change: "Move stop",
        current_canonical_revision: "rev-live",
        field_snapshot_revision: "rev-snap",
        coordinates: {
            current: { latitude: 16.8, longitude: 96.15 },
            proposed: { latitude: 16.801, longitude: 96.151 },
            observed: { latitude: 16.8005, longitude: 96.1505 },
        },
        previous_stop: { public_id: prevId, name: "Prev", sequence: 2 },
        next_stop: { public_id: nextId, name: "Next", sequence: 4 },
        map_context: {
            stops: [
                {
                    public_id: prevId,
                    name: "Prev",
                    sequence: 2,
                    latitude: 16.799,
                    longitude: 96.149,
                    role: "previous",
                },
                {
                    public_id: stopId,
                    name: "First",
                    sequence: 3,
                    latitude: 16.8,
                    longitude: 96.15,
                    role: "target",
                },
                {
                    public_id: nextId,
                    name: "Next",
                    sequence: 4,
                    latitude: 16.801,
                    longitude: 96.151,
                    role: "next",
                },
                {
                    public_id: "44444444-4444-4444-8444-444444444444",
                    name: "Near",
                    sequence: 5,
                    latitude: 16.802,
                    longitude: 96.152,
                    role: "surrounding",
                },
            ],
        },
        affected_route_count: 1,
        allowedActions: [],
        ...partial,
    };
}

function report(partial: Partial<AdminReportDetail> = {}): AdminReportDetail {
    return {
        public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        is_anonymous: false,
        eligible_for_points: false,
        report_type: { code: "wrong_location", name: "Wrong location" },
        status: { code: "in_review", name: "In review" },
        reason_code: null,
        target_entity_type: "stop",
        target_entity_id: "1",
        target_public_id: stopId,
        title: null,
        description: "Moved",
        latitude: 16.801,
        longitude: 96.151,
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
            route_public_id: "11111111-1111-4111-8111-111111111111",
            variant_code: "D0",
            variant_public_id: "22222222-2222-4222-8222-222222222222",
            origin_name: "A",
            destination_name: "B",
            stop_public_id: stopId,
            stop_name: "First",
            stop_sequence: 3,
            previous_stop_public_id: prevId,
            previous_stop_sequence: 2,
            next_stop_public_id: nextId,
            proposed_stop_name: null,
            location_source: null,
            snapshot_revision: "rev-snap",
            snapshot_stale: false,
            current_snapshot_revision: "rev-live",
            survey_session_public_id: null,
            survey_session_status: null,
            canonical_snapshot: null,
            observed_location: { latitude: 16.8005, longitude: 96.1505, accuracy_m: 6 },
            proposed_location: { latitude: 16.801, longitude: 96.151 },
        },
        canonical_target: { latitude: 16.8, longitude: 96.15 },
        distance_m: 120,
        media_count: 0,
        review: review(),
        status_events: [],
        followups: [],
        media: [],
        ...partial,
    };
}

describe("evidence map coordinate validation", () => {
    it("rejects null, NaN, and out-of-range coordinates", () => {
        assert.equal(isValidEvidenceCoordinate(null), false);
        assert.equal(isValidEvidenceCoordinate({ latitude: NaN, longitude: 96 }), false);
        assert.equal(isValidEvidenceCoordinate({ latitude: 16, longitude: 200 }), false);
        assert.equal(isValidEvidenceCoordinate({ latitude: 16.8, longitude: 96.15 }), true);
    });
});

describe("evidence map model transforms", () => {
    it("STOP_MOVED fits current, proposed, and adjacent stops with one distance", () => {
        const model = buildEvidenceMapModel(report());
        assert.equal(model.empty, false);
        assert.ok(model.markers.some((m) => m.role === "canonical"));
        assert.ok(model.markers.some((m) => m.role === "proposed"));
        assert.ok(model.markers.some((m) => m.role === "previous"));
        assert.ok(model.markers.some((m) => m.role === "next"));
        assert.ok(model.markers.some((m) => m.role === "surrounding"));
        assert.equal(model.distance?.label, "Current → proposed");
        assert.ok((model.distance?.meters ?? 0) > 0);
        assert.ok(model.lines.some((line) => line.kind === "before"));
    });

    it("keeps distant observed GPS out of default fit", () => {
        const model = buildEvidenceMapModel(
            report({
                review: review({
                    coordinates: {
                        current: { latitude: 16.8, longitude: 96.15 },
                        proposed: { latitude: 16.801, longitude: 96.151 },
                        observed: { latitude: 21.0, longitude: 96.1 },
                    },
                }),
            })
        );
        assert.equal(model.observedIsOutlier, true);
        assert.equal(
            evidenceMapFitPoints(model, false).some(
                (point) => Math.abs(point.latitude - 21) < 0.01
            ),
            false
        );
        assert.equal(
            evidenceMapFitPoints(model, true).some(
                (point) => Math.abs(point.latitude - 21) < 0.01
            ),
            true
        );
        assert.equal(SURVEY_OUTSIDE_MAP_MESSAGE.includes("outside"), true);
    });

    it("STOP_MISSING marks target red and previews after-removal link", () => {
        const model = buildEvidenceMapModel(
            report({
                report_type: { code: "missing_item", name: "Missing" },
                review: review({
                    kind: "STOP_MISSING",
                    proposed_change: "Remove from variant",
                    coordinates: {
                        current: { latitude: 16.8, longitude: 96.15 },
                        proposed: null,
                        observed: { latitude: 16.8005, longitude: 96.1505 },
                    },
                }),
            })
        );
        assert.ok(model.markers.some((m) => m.role === "removal"));
        assert.equal(model.markers.some((m) => m.role === "canonical"), false);
        assert.ok(model.lines.some((line) => line.kind === "before" && line.coordinates.length >= 2));
        assert.ok(model.lines.some((line) => line.kind === "after" && line.coordinates.length === 2));
    });

    it("NEW_STOP places proposed between previous and next", () => {
        const model = buildEvidenceMapModel(
            report({
                report_type: { code: "new_stop", name: "New stop" },
                review: review({
                    kind: "NEW_STOP",
                    target_stop: null,
                    proposed_change: "Create stop",
                    coordinates: {
                        current: { latitude: 16.8, longitude: 96.15 },
                        proposed: { latitude: 16.8004, longitude: 96.1504 },
                        observed: { latitude: 16.8005, longitude: 96.1505 },
                    },
                    map_context: {
                        stops: [
                            {
                                public_id: prevId,
                                name: "Prev",
                                sequence: 2,
                                latitude: 16.799,
                                longitude: 96.149,
                                role: "previous",
                            },
                            {
                                public_id: nextId,
                                name: "Next",
                                sequence: 4,
                                latitude: 16.801,
                                longitude: 96.151,
                                role: "next",
                            },
                        ],
                    },
                }),
            })
        );
        const insert = model.lines.find((line) => line.kind === "insert");
        assert.ok(insert);
        assert.equal(insert!.coordinates.length, 3);
        assert.ok(model.markers.some((m) => m.role === "proposed"));
        assert.equal(model.distance?.label, "Observed → proposed");
    });

    it("returns empty model for invalid-only coordinates", () => {
        const model = buildEvidenceMapModel(
            report({
                canonical_target: null,
                field: {
                    ...report().field!,
                    observed_location: { latitude: Number.NaN, longitude: 96, accuracy_m: null },
                    proposed_location: null,
                },
                review: review({
                    coordinates: {
                        current: { latitude: 91, longitude: 96 },
                        proposed: null,
                        observed: { latitude: Number.NaN, longitude: 96 },
                    },
                    map_context: {
                        stops: [
                            {
                                public_id: stopId,
                                name: "Bad",
                                sequence: 1,
                                latitude: Number.NaN,
                                longitude: 96,
                                role: "target",
                            },
                        ],
                    },
                }),
            })
        );
        assert.equal(model.empty, true);
        assert.equal(model.markers.length, 0);
    });

    it("ignores public reports", () => {
        const model = buildEvidenceMapModel(report({ source_code: "public", review: null }));
        assert.equal(model.empty, true);
    });
});
