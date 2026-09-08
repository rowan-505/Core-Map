import assert from "node:assert/strict";
import test from "node:test";

import { toFieldContext } from "./field-report-evidence.js";
import type { ReportRow } from "./reports.repo.js";

const stopId = "33333333-3333-4333-8333-333333333333";
const routeId = "11111111-1111-4111-8111-111111111111";
const variantId = "22222222-2222-4222-8222-222222222222";
const sessionId = "66666666-6666-4666-8666-666666666666";

function row(overrides: Partial<ReportRow> = {}): ReportRow {
    return {
        id: 1n,
        public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        created_by: 9n,
        anonymous_id: null,
        is_anonymous: false,
        eligible_for_points: false,
        report_type_code: "wrong_info",
        report_type_name: "Wrong information",
        status_code: "submitted",
        status_name: "Submitted",
        reason_code: null,
        target_entity_type: "stop",
        target_entity_id: 1n,
        target_public_id: stopId,
        title: null,
        description: "Sign is wrong",
        latitude: 16.81,
        longitude: 96.16,
        admin_area_id: null,
        priority: "normal",
        confidence_score: 50,
        reviewed_by: null,
        reviewed_at: null,
        admin_note: null,
        reward_ledger_id: null,
        reward_granted_at: null,
        created_at: new Date("2026-09-04T00:00:00.000Z"),
        updated_at: new Date("2026-09-04T00:00:00.000Z"),
        author_public_id: "user-1",
        author_display_name: "Surveyor",
        author_email: "s@example.com",
        source_code: "field_survey",
        observed_at: new Date("2026-09-04T01:00:00.000Z"),
        location_accuracy_m: 8,
        report_data: {},
        field_route_code: "YBS-13",
        field_stop_name: "First",
        field_origin_name: "Sule",
        field_destination_name: "Kyauktan",
        survey_session_public_id: sessionId,
        survey_session_status: "completed",
        media_count: 0,
        ...overrides,
    };
}

test("stop-level field report keeps route, D0/D1, sequence, and session", () => {
    const field = toFieldContext(
        row({
            report_data: {
                snapshotRevision: "v1-old",
                routePublicId: routeId,
                variantPublicId: variantId,
                variantCode: "D0",
                stopPublicId: stopId,
                stopSequence: 4,
            },
        }),
        "v1-old"
    );
    assert.equal(field?.route_code, "YBS-13");
    assert.equal(field?.route_public_id, routeId);
    assert.equal(field?.variant_code, "D0");
    assert.equal(field?.stop_public_id, stopId);
    assert.equal(field?.stop_sequence, 4);
    assert.equal(field?.origin_name, "Sule");
    assert.equal(field?.destination_name, "Kyauktan");
    assert.equal(field?.survey_session_public_id, sessionId);
    assert.equal(field?.survey_session_status, "completed");
    assert.equal(field?.snapshot_stale, false);
    assert.equal(field?.observed_location?.latitude, 16.81);
    assert.equal(field?.proposed_location, null);
});

test("route-level field report has no stop target", () => {
    const field = toFieldContext(
        row({
            target_entity_type: "route",
            target_public_id: routeId,
            field_stop_name: null,
            report_data: {
                snapshotRevision: "v1-now",
                routePublicId: routeId,
                variantPublicId: variantId,
                variantCode: "D1",
            },
        }),
        "v1-now"
    );
    assert.equal(field?.route_public_id, routeId);
    assert.equal(field?.variant_code, "D1");
    assert.equal(field?.stop_public_id, null);
    assert.equal(field?.stop_sequence, null);
});

test("MOVED geometry splits canonical capture, observer GPS, and proposed point", () => {
    const field = toFieldContext(
        row({
            report_type_code: "wrong_location",
            latitude: 16.9,
            longitude: 96.2,
            location_accuracy_m: 12,
            report_data: {
                snapshotRevision: "v1-old",
                variantCode: "D0",
                stopPublicId: stopId,
                stopSequence: 2,
                canonicalSnapshot: {
                    stopPublicId: stopId,
                    stopSequence: 2,
                    lat: 16.8,
                    lng: 96.15,
                    observerLat: 16.801,
                    observerLng: 96.151,
                    observerAccuracyM: 6,
                    correctedLat: 16.9,
                    correctedLng: 96.2,
                },
            },
        }),
        "v1-new"
    );
    assert.equal(field?.snapshot_stale, true);
    assert.equal(field?.observed_location?.latitude, 16.801);
    assert.equal(field?.observed_location?.longitude, 96.151);
    assert.equal(field?.observed_location?.accuracy_m, 6);
    assert.equal(field?.proposed_location?.latitude, 16.9);
    assert.equal(field?.proposed_location?.longitude, 96.2);
    assert.equal(field?.current_snapshot_revision, "v1-new");
});

test("old snapshot is stale when the live field revision differs", () => {
    const field = toFieldContext(
        row({
            report_data: { snapshotRevision: "v1-capture", variantCode: "D0" },
        }),
        "v1-live"
    );
    assert.equal(field?.snapshot_stale, true);
    assert.equal(field?.snapshot_revision, "v1-capture");
});

test("new_stop evidence keeps previous stop, proposed name, and location source", () => {
    const field = toFieldContext(
        row({
            report_type_code: "new_stop",
            target_entity_type: "variant",
            target_public_id: variantId,
            latitude: 16.781,
            longitude: 96.151,
            report_data: {
                snapshotRevision: "v1-old",
                routePublicId: routeId,
                variantPublicId: variantId,
                variantCode: "D0",
                previousStopPublicId: stopId,
                previousStopSequence: 4,
                nextStopPublicId: "44444444-4444-4444-8444-444444444444",
                proposedStopName: "Corner stall",
                locationSource: "GPS",
                stopPublicId: stopId,
                stopSequence: 4,
            },
        }),
        "v1-old"
    );
    assert.equal(field?.previous_stop_public_id, stopId);
    assert.equal(field?.previous_stop_sequence, 4);
    assert.equal(field?.next_stop_public_id, "44444444-4444-4444-8444-444444444444");
    assert.equal(field?.proposed_stop_name, "Corner stall");
    assert.equal(field?.location_source, "GPS");
    assert.equal(field?.stop_public_id, stopId);
    assert.equal(field?.proposed_location?.latitude, 16.781);
    assert.equal(field?.observed_location?.latitude, 16.781);
});

test("new_stop GPS-only has proposed geometry even without a corrected snapshot point", () => {
    const field = toFieldContext(
        row({
            report_type_code: "new_stop",
            target_entity_type: "variant",
            target_public_id: variantId,
            latitude: 16.801,
            longitude: 96.151,
            location_accuracy_m: 7,
            report_data: {
                snapshotRevision: "v1-old",
                variantCode: "D0",
                previousStopPublicId: stopId,
                previousStopSequence: 4,
                proposedStopName: "Corner stall",
                locationSource: "GPS",
                stopPublicId: stopId,
                stopSequence: 4,
            },
        }),
        "v1-old"
    );
    assert.equal(field?.next_stop_public_id, null);
    assert.equal(field?.location_source, "GPS");
    assert.equal(field?.proposed_location?.latitude, 16.801);
    assert.equal(field?.observed_location?.latitude, 16.801);
    assert.equal(field?.observed_location?.accuracy_m, 7);
});

test("new_stop map pick keeps observer GPS separate from the proposed point", () => {
    const field = toFieldContext(
        row({
            report_type_code: "new_stop",
            target_entity_type: "variant",
            target_public_id: variantId,
            latitude: 16.91,
            longitude: 96.21,
            location_accuracy_m: null,
            report_data: {
                snapshotRevision: "v1-old",
                variantCode: "D1",
                previousStopPublicId: stopId,
                previousStopSequence: 4,
                proposedStopName: "Corner stall",
                locationSource: "MAP_PICK",
                stopPublicId: stopId,
                stopSequence: 4,
                canonicalSnapshot: {
                    observerLat: 16.801,
                    observerLng: 96.151,
                    observerAccuracyM: 40,
                    observerEpochMs: 1_700_000_000_000,
                    correctedLat: 16.91,
                    correctedLng: 96.21,
                    lat: 16.8,
                    lng: 96.15,
                },
            },
        }),
        "v1-old"
    );
    assert.equal(field?.location_source, "MAP_PICK");
    assert.equal(field?.proposed_location?.latitude, 16.91);
    assert.equal(field?.observed_location?.latitude, 16.801);
    assert.equal(field?.observed_location?.accuracy_m, 40);
});

test("wrong_info field reports still omit a proposed point", () => {
    const field = toFieldContext(
        row({
            report_type_code: "wrong_info",
            report_data: {
                snapshotRevision: "v1-old",
                variantCode: "D0",
                stopPublicId: stopId,
                stopSequence: 4,
            },
        }),
        "v1-old"
    );
    assert.equal(field?.proposed_location, null);
    assert.equal(field?.observed_location?.latitude, 16.81);
});
