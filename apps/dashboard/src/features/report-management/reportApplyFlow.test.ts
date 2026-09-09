import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

import {
    ApplyConfirmationDialog,
    ReportApplyToast,
    ReportDetailFieldActionPanel,
} from "./ReportDetailPanels.js";
import { buildReportDetailActionModel } from "./reportDetailView.js";
import {
    MAP_DATA_CHANGED_MESSAGE,
    beginApplySubmit,
    buildApplyConfirmation,
    buildApplyRequestBody,
    buildApplyResultSummary,
    cancelApplyConfirmation,
    clearApplyToast,
    completeApplyConflict,
    completeApplyFailure,
    completeApplySuccess,
    createApplyFlowState,
    formatReportApplyError,
    isReportApplyConflictError,
    openApplyConfirmation,
} from "./reportApplyFlow.js";
import type { AdminReportDetail, ReportReview, ReportReviewActionCode } from "./types.js";

const stopId = "33333333-3333-4333-8333-333333333333";
const prevId = "22222222-2222-4222-8222-222222222221";

function allowed(action: ReportReviewActionCode, enabled = true, disabledReason: string | null = null) {
    return { action, enabled, disabledReason };
}

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
        next_stop: null,
        map_context: null,
        affected_route_count: 2,
        allowedActions: [
            allowed("MOVE_STOP"),
            allowed("RESOLVE"),
            allowed("REJECT"),
        ],
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
        admin_note: "Keep this note",
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
            next_stop_public_id: null,
            proposed_stop_name: "Corner stall",
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

describe("apply confirmation for every allowed action", () => {
    it("MOVE_STOP", () => {
        const summary = buildApplyConfirmation(report(), "MOVE_STOP");
        assert.ok(summary);
        assert.equal(summary!.action, "MOVE_STOP");
        assert.match(summary!.oldValue, /16\.80000/);
        assert.match(summary!.proposedValue, /16\.80100/);
        assert.match(summary!.changeDetail ?? "", /Distance/);
        assert.equal(summary!.affectedVariantsLabel, "2");
    });

    it("REMOVE_FROM_ROUTE", () => {
        const summary = buildApplyConfirmation(
            report({
                report_type: { code: "missing_item", name: "Missing" },
                review: review({
                    kind: "STOP_MISSING",
                    allowedActions: [
                        allowed("REMOVE_FROM_ROUTE"),
                        allowed("RESOLVE"),
                        allowed("REJECT"),
                    ],
                }),
            }),
            "REMOVE_FROM_ROUTE"
        );
        assert.ok(summary);
        assert.match(summary!.changeDetail ?? "", /Sequence/);
        assert.match(summary!.proposedValue, /Removed/);
    });

    it("CREATE_AND_INSERT_STOP", () => {
        const summary = buildApplyConfirmation(
            report({
                report_type: { code: "new_stop", name: "New stop" },
                review: review({
                    kind: "NEW_STOP",
                    target_stop: null,
                    previous_stop: { public_id: prevId, name: "Prev", sequence: 2 },
                    allowedActions: [
                        allowed("CREATE_AND_INSERT_STOP"),
                        allowed("RESOLVE"),
                        allowed("REJECT"),
                    ],
                }),
            }),
            "CREATE_AND_INSERT_STOP"
        );
        assert.ok(summary);
        assert.equal(summary!.proposedValue, "Corner stall");
        assert.match(summary!.changeDetail ?? "", /Insert after sequence 2/);
    });

    it("UPDATE_STOP_DETAILS", () => {
        const summary = buildApplyConfirmation(
            report({
                report_type: { code: "wrong_info", name: "Wrong info" },
                review: review({
                    kind: "WRONG_DATA",
                    proposed_change: "Rename stop",
                    allowedActions: [
                        allowed("UPDATE_STOP_DETAILS"),
                        allowed("RESOLVE"),
                        allowed("REJECT"),
                    ],
                }),
            }),
            "UPDATE_STOP_DETAILS"
        );
        assert.ok(summary);
        assert.equal(summary!.proposedValue, "Rename stop");
    });

    it("RESOLVE and REJECT", () => {
        const resolve = buildApplyConfirmation(report(), "RESOLVE");
        const reject = buildApplyConfirmation(report(), "REJECT");
        assert.ok(resolve);
        assert.ok(reject);
        assert.equal(reject!.tone, "danger");
        assert.match(resolve!.proposedValue, /no map change/i);
    });
});

describe("apply flow interactions", () => {
    it("rejects unavailable actions", () => {
        const summary = buildApplyConfirmation(
            report({
                review: review({
                    allowedActions: [
                        allowed("MOVE_STOP", false, "Missing geometry"),
                        allowed("RESOLVE"),
                        allowed("REJECT"),
                    ],
                }),
            }),
            "MOVE_STOP"
        );
        assert.equal(summary, null);
        const state = openApplyConfirmation(createApplyFlowState(), summary);
        assert.equal(state.phase, "idle");
        assert.match(state.error ?? "", /not available/);
    });

    it("cancels confirmation without submitting", () => {
        const summary = buildApplyConfirmation(report(), "MOVE_STOP");
        const confirming = openApplyConfirmation(createApplyFlowState(), summary);
        assert.equal(confirming.phase, "confirming");
        const cancelled = cancelApplyConfirmation(confirming);
        assert.equal(cancelled.phase, "idle");
        assert.equal(cancelled.confirmation, null);
    });

    it("prevents duplicate submit clicks", () => {
        const summary = buildApplyConfirmation(report(), "MOVE_STOP");
        const confirming = openApplyConfirmation(createApplyFlowState(), summary);
        const first = beginApplySubmit(confirming);
        assert.ok(first);
        assert.equal(first!.phase, "submitting");
        const second = beginApplySubmit(first!);
        assert.equal(second, null);
    });

    it("handles 409 conflict with refresh message and cleared confirmation", () => {
        const summary = buildApplyConfirmation(report(), "MOVE_STOP");
        const confirming = openApplyConfirmation(createApplyFlowState(), summary)!;
        const submitting = beginApplySubmit(confirming)!;
        const conflicted = completeApplyConflict(submitting);
        assert.equal(conflicted.phase, "idle");
        assert.equal(conflicted.confirmation, null);
        assert.equal(conflicted.conflictNotice, MAP_DATA_CHANGED_MESSAGE);
        assert.equal(conflicted.result, null);
        assert.equal(isReportApplyConflictError(new Error("Request failed with status 409")), true);
        assert.equal(isReportApplyConflictError(new Error("Canonical revision mismatch")), true);
    });

    it("keeps failure inline without success state", () => {
        const summary = buildApplyConfirmation(report(), "MOVE_STOP");
        const confirming = openApplyConfirmation(createApplyFlowState(), summary)!;
        const submitting = beginApplySubmit(confirming)!;
        const failed = completeApplyFailure(submitting, "Network failed");
        assert.equal(failed.phase, "confirming");
        assert.equal(failed.error, "Network failed");
        assert.equal(failed.result, null);
        assert.equal(failed.toast, null);
        assert.equal(formatReportApplyError(new Error("boom")), "boom");
    });

    it("successful apply builds toast and result summary", () => {
        const summary = buildApplyConfirmation(report(), "MOVE_STOP");
        const confirming = openApplyConfirmation(createApplyFlowState(), summary)!;
        const submitting = beginApplySubmit(confirming)!;
        const result = buildApplyResultSummary("MOVE_STOP", {
            message: "Stop moved",
            idempotent: false,
            comparison: {
                before: null,
                after: null,
                affected_variant_count: 2,
                affected_route_count: 1,
            },
        });
        let state = completeApplySuccess(submitting, result);
        assert.equal(state.phase, "succeeded");
        assert.equal(state.result?.statusLabel, "Resolved");
        assert.equal(state.toast, "Apply stop move applied");
        assert.match(state.result?.detail ?? "", /2 variant/);
        state = clearApplyToast(state);
        assert.equal(state.toast, null);
    });

    it("apply request body sends action and revision only", () => {
        const body = buildApplyRequestBody("MOVE_STOP", "rev-live");
        assert.deepEqual(body, {
            action: "MOVE_STOP",
            expectedCanonicalRevision: "rev-live",
        });
        assert.equal("latitude" in body, false);
        assert.equal("proposed_stop_name" in body, false);
    });
});

describe("apply confirmation dialog and result UI", () => {
    it("renders confirmation fields", () => {
        const summary = buildApplyConfirmation(report(), "MOVE_STOP")!;
        const markup = renderToStaticMarkup(
            createElement(ApplyConfirmationDialog, {
                summary,
                busy: false,
                onConfirm() {},
                onCancel() {},
            })
        );
        assert.match(markup, /Action/);
        assert.match(markup, /Target/);
        assert.match(markup, /Old value/);
        assert.match(markup, /Proposed value/);
        assert.match(markup, /Affected variants/);
        assert.match(markup, /Confirm apply stop move/i);
    });

    it("disables confirm while submitting", () => {
        const summary = buildApplyConfirmation(report(), "REJECT")!;
        const markup = renderToStaticMarkup(
            createElement(ApplyConfirmationDialog, {
                summary,
                busy: true,
                onConfirm() {},
                onCancel() {},
            })
        );
        assert.match(markup, /Working…/);
        assert.match(markup, /disabled/);
    });

    it("replaces actions with result summary and shows toast", () => {
        const model = buildReportDetailActionModel(report());
        const result = buildApplyResultSummary("MOVE_STOP", {
            message: null,
            idempotent: false,
            comparison: {
                before: null,
                after: null,
                affected_variant_count: 1,
                affected_route_count: 1,
            },
        });
        const panel = renderToStaticMarkup(
            createElement(ReportDetailFieldActionPanel, {
                model,
                busy: false,
                result,
                onPrimary() {},
                onResolve() {},
                onReject() {},
            })
        );
        assert.match(panel, /Resolved/);
        assert.match(panel, /Result/);
        assert.doesNotMatch(panel, /Resolve without change/);
        assert.doesNotMatch(panel, /aria-label="Apply stop move"/);
        const toast = renderToStaticMarkup(
            createElement(ReportApplyToast, { message: result.toastMessage })
        );
        assert.match(toast, /Apply stop move applied/);
    });

    it("shows conflict notice on action panel after 409", () => {
        const model = buildReportDetailActionModel(report());
        const markup = renderToStaticMarkup(
            createElement(ReportDetailFieldActionPanel, {
                model,
                busy: false,
                conflictNotice: MAP_DATA_CHANGED_MESSAGE,
                onPrimary() {},
                onResolve() {},
                onReject() {},
            })
        );
        assert.match(markup, /Map data changed\. Review the updated comparison\./);
    });
});
