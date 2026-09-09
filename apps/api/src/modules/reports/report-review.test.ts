import assert from "node:assert/strict";
import test from "node:test";

import type { FieldReportAdminContext } from "./field-report-evidence.js";
import {
    buildAllowedActions,
    labelReviewMapStops,
    proposedChangeSummary,
    reviewKindForReportType,
    structuredProposedStopDetailsFromField,
    toReportReview,
} from "./report-review.js";
import { adminApplyBodySchema } from "./reports.schema.js";

const stopId = "33333333-3333-4333-8333-333333333333";
const routeId = "11111111-1111-4111-8111-111111111111";

function field(overrides: Partial<FieldReportAdminContext> = {}): FieldReportAdminContext {
    return {
        route_code: "YBS-13",
        route_public_id: routeId,
        variant_code: "D0",
        variant_public_id: "22222222-2222-4222-8222-222222222222",
        origin_name: "A",
        destination_name: "B",
        stop_public_id: stopId,
        stop_name: "First",
        stop_sequence: 3,
        previous_stop_public_id: null,
        previous_stop_sequence: null,
        next_stop_public_id: null,
        proposed_stop_name: null,
        location_source: null,
        snapshot_revision: "v1-capture",
        snapshot_stale: true,
        current_snapshot_revision: "v1-live",
        survey_session_public_id: null,
        survey_session_status: null,
        canonical_snapshot: null,
        observed_location: { latitude: 16.801, longitude: 96.151, accuracy_m: 5 },
        proposed_location: null,
        ...overrides,
    };
}

test("maps report types to review kinds", () => {
    assert.equal(reviewKindForReportType("wrong_location"), "STOP_MOVED");
    assert.equal(reviewKindForReportType("missing_item"), "STOP_MISSING");
    assert.equal(reviewKindForReportType("new_stop"), "NEW_STOP");
    assert.equal(reviewKindForReportType("wrong_info"), "WRONG_DATA");
    assert.equal(reviewKindForReportType("transport_issue"), "ROUTE_ISSUE");
    assert.equal(reviewKindForReportType("other_map_issue"), "OTHER");
    assert.equal(reviewKindForReportType("community_info"), null);
});

test("apply schema accepts action + revision only and rejects target payloads", () => {
    const ok = adminApplyBodySchema.safeParse({
        action: "MOVE_STOP",
        expectedCanonicalRevision: "v1-live",
    });
    assert.equal(ok.success, true);

    const withCoords = adminApplyBodySchema.safeParse({
        action: "MOVE_STOP",
        expectedCanonicalRevision: "v1-live",
        latitude: 16.9,
        longitude: 96.2,
    });
    assert.equal(withCoords.success, false);

    const withStop = adminApplyBodySchema.safeParse({
        action: "UPDATE_STOP_DETAILS",
        expectedCanonicalRevision: "v1-live",
        stopPublicId: stopId,
        name: "Hack",
    });
    assert.equal(withStop.success, false);
});

test("STOP_MOVED proposed change and actions use structured coordinates only", () => {
    const moved = field({
        proposed_location: { latitude: 16.9, longitude: 96.2 },
    });
    const summary = proposedChangeSummary({
        kind: "STOP_MOVED",
        field: moved,
        structuredDetails: null,
    });
    assert.equal(summary, "Move stop to 16.900000, 96.200000");

    const actions = buildAllowedActions({
        kind: "STOP_MOVED",
        statusCode: "in_review",
        sourceCode: "field_survey",
        field: moved,
        structuredDetails: null,
        proposedChange: summary,
    });
    const move = actions.find((a) => a.action === "MOVE_STOP");
    assert.equal(move?.enabled, true);
    assert.equal(move?.disabledReason, null);
    assert.equal(actions.find((a) => a.action === "RESOLVE")?.enabled, true);
    assert.equal(actions.find((a) => a.action === "REJECT")?.enabled, true);
});

test("WRONG_DATA stays disabled without structured proposed fields", () => {
    const details = structuredProposedStopDetailsFromField(field());
    assert.equal(details, null);
    const summary = proposedChangeSummary({
        kind: "WRONG_DATA",
        field: field(),
        structuredDetails: null,
    });
    assert.equal(summary, null);
    const actions = buildAllowedActions({
        kind: "WRONG_DATA",
        statusCode: "in_review",
        sourceCode: "field_survey",
        field: field(),
        structuredDetails: null,
        proposedChange: null,
    });
    const update = actions.find((a) => a.action === "UPDATE_STOP_DETAILS");
    assert.equal(update?.enabled, false);
    assert.match(update?.disabledReason ?? "", /structured proposed stop details/i);
});

test("NEW_STOP serializes review model without free-text description", () => {
    const ctx = field({
        stop_public_id: stopId,
        previous_stop_public_id: stopId,
        previous_stop_sequence: 4,
        next_stop_public_id: "44444444-4444-4444-8444-444444444444",
        proposed_stop_name: "Corner stall",
        location_source: "MAP_PICK",
        proposed_location: { latitude: 16.91, longitude: 96.21 },
    });
    const review = toReportReview({
        reportId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        reportTypeCode: "new_stop",
        statusCode: "in_review",
        sourceCode: "field_survey",
        timestamp: "2026-09-04T01:00:00.000Z",
        field: ctx,
        currentCanonical: { latitude: 16.8, longitude: 96.15 },
        affectedRouteCount: 2,
        previousStop: { public_id: stopId, name: "First", sequence: 4 },
        nextStop: {
            public_id: "44444444-4444-4444-8444-444444444444",
            name: "Next",
            sequence: 5,
        },
    });
    assert.ok(review);
    assert.equal(review.kind, "NEW_STOP");
    assert.equal(review.proposed_change, 'Create and insert stop "Corner stall" after sequence 4');
    assert.equal(review.affected_route_count, 2);
    assert.equal(review.coordinates.proposed?.latitude, 16.91);
    assert.equal(review.field_snapshot_revision, "v1-capture");
    assert.equal(review.current_canonical_revision, "v1-live");
    assert.equal(review.previous_stop?.sequence, 4);
    assert.equal(review.next_stop?.public_id, "44444444-4444-4444-8444-444444444444");
    const create = review.allowedActions.find((a) => a.action === "CREATE_AND_INSERT_STOP");
    assert.equal(create?.enabled, true);
    assert.equal(create?.disabledReason, null);
    assert.equal("description" in review, false);
    assert.equal("canonical_snapshot" in review, false);
});

test("OTHER allows resolve/reject only for canonical-style actions", () => {
    const actions = buildAllowedActions({
        kind: "OTHER",
        statusCode: "in_review",
        sourceCode: "field_survey",
        field: field({ stop_public_id: null }),
        structuredDetails: null,
        proposedChange: null,
    });
    assert.deepEqual(
        actions.map((a) => a.action),
        ["RESOLVE", "REJECT"]
    );
});

test("ROUTE_ISSUE enables OPEN_ROUTE_EDITOR when route id exists", () => {
    const actions = buildAllowedActions({
        kind: "ROUTE_ISSUE",
        statusCode: "submitted",
        sourceCode: "field_survey",
        field: field({ stop_public_id: null }),
        structuredDetails: null,
        proposedChange: "Open route editor",
    });
    assert.equal(actions.find((a) => a.action === "OPEN_ROUTE_EDITOR")?.enabled, true);
    assert.equal(actions.find((a) => a.action === "RESOLVE")?.enabled, true);
});

test("public reports serialize as null review", () => {
    const review = toReportReview({
        reportId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        reportTypeCode: "wrong_info",
        statusCode: "submitted",
        sourceCode: "public",
        timestamp: "2026-09-04T01:00:00.000Z",
        field: null,
        currentCanonical: null,
        affectedRouteCount: 0,
        previousStop: null,
        nextStop: null,
    });
    assert.equal(review, null);
});

test("labelReviewMapStops assigns previous/target/next roles", () => {
    const labeled = labelReviewMapStops({
        stops: [
            { public_id: "1", name: "A", sequence: 1, latitude: 16.1, longitude: 96.1 },
            { public_id: "2", name: "B", sequence: 2, latitude: 16.2, longitude: 96.2 },
            { public_id: "3", name: "C", sequence: 3, latitude: 16.3, longitude: 96.3 },
        ],
        previousStopPublicId: "1",
        targetStopPublicId: "2",
        nextStopPublicId: "3",
    });
    assert.equal(labeled[0]?.role, "previous");
    assert.equal(labeled[1]?.role, "target");
    assert.equal(labeled[2]?.role, "next");
});
