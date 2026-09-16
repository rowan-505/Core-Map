import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

import {
    ReportDetailComparisonCard,
    ReportDetailEmptyState,
    ReportDetailErrorState,
    ReportDetailFieldActionPanel,
    ReportDetailKeyFactsCard,
    ReportDetailLoadingState,
    ReportDetailSurveyorNoteCard,
} from "./ReportDetailPanels.js";
import {
    NO_DIRECT_ACTION_MESSAGE,
    buildReportDetailActionModel,
    buildReportDetailComparison,
    buildReportDetailKeyFacts,
} from "./reportDetailView.js";
import type {
    AdminReportDetail,
    ReportReview,
    ReportReviewActionCode,
    ReportReviewKind,
} from "./types.js";

const stopId = "33333333-3333-4333-8333-333333333333";
const routeId = "11111111-1111-4111-8111-111111111111";

function allowed(
    action: ReportReviewActionCode,
    enabled = true,
    disabledReason: string | null = null
) {
    return { action, enabled, disabledReason };
}

function review(partial: Partial<ReportReview> & { kind: ReportReviewKind }): ReportReview {
    return {
        report_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        report_type: "wrong_location",
        status: "in_review",
        timestamp: "2026-09-04T01:00:00.000Z",
        route_code: "YBS-13",
        variant_code: "D0",
        target_stop: { public_id: stopId, name: "First", sequence: 2 },
        proposed_change: "Move stop",
        current_canonical_revision: "rev-live",
        field_snapshot_revision: "rev-snap",
        coordinates: {
            current: { latitude: 16.8, longitude: 96.15 },
            proposed: { latitude: 16.9, longitude: 96.2 },
            observed: { latitude: 16.801, longitude: 96.151 },
        },
        previous_stop: null,
        next_stop: null,
        affected_route_count: 2,
        map_context: null,
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
        author: { public_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", display_name: "Ada", email: "a@x" },
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
            previous_stop_public_id: null,
            previous_stop_sequence: null,
            next_stop_public_id: null,
            proposed_stop_name: null,
            location_source: null,
            snapshot_revision: "rev-snap",
            snapshot_stale: false,
            current_snapshot_revision: "rev-live",
            survey_session_public_id: "66666666-6666-4666-8666-666666666666",
            survey_session_status: "completed",
            canonical_snapshot: null,
            observed_location: { latitude: 16.801, longitude: 96.151, accuracy_m: 6 },
            proposed_location: { latitude: 16.9, longitude: 96.2 },
        },
        canonical_target: { latitude: 16.8, longitude: 96.15 },
        distance_m: 120,
        media_count: 0,
        review: review({ kind: "STOP_MOVED" }),
        status_events: [],
        followups: [],
        media: [],
        ...partial,
    };
}

describe("report detail action model by type", () => {
    it("STOP_MOVED / wrong_location → Apply stop move primary", () => {
        const model = buildReportDetailActionModel(report());
        assert.equal(model.primary?.action, "MOVE_STOP");
        assert.equal(model.primary?.label, "Apply stop move");
        assert.equal(model.primary?.enabled, true);
        assert.equal(model.resolve?.enabled, true);
        assert.equal(model.reject?.enabled, true);
    });

    it("STOP_MISSING / missing_item → Remove from route", () => {
        const model = buildReportDetailActionModel(
            report({
                report_type: { code: "missing_item", name: "Missing" },
                review: review({
                    kind: "STOP_MISSING",
                    proposed_change: "Remove stop from variant",
                    allowedActions: [
                        allowed("REMOVE_FROM_ROUTE"),
                        allowed("RESOLVE"),
                        allowed("REJECT"),
                    ],
                }),
            })
        );
        assert.equal(model.primary?.action, "REMOVE_FROM_ROUTE");
        assert.equal(model.primary?.label, "Remove from route");
    });

    it("NEW_STOP → Create and insert stop", () => {
        const model = buildReportDetailActionModel(
            report({
                report_type: { code: "new_stop", name: "New stop" },
                review: review({
                    kind: "NEW_STOP",
                    proposed_change: "Create stop after First",
                    target_stop: null,
                    previous_stop: { public_id: stopId, name: "First", sequence: 2 },
                    allowedActions: [
                        allowed("CREATE_AND_INSERT_STOP"),
                        allowed("RESOLVE"),
                        allowed("REJECT"),
                    ],
                }),
            })
        );
        assert.equal(model.primary?.action, "CREATE_AND_INSERT_STOP");
    });

    it("WRONG_DATA with structured update → Update stop details", () => {
        const model = buildReportDetailActionModel(
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
            })
        );
        assert.equal(model.primary?.action, "UPDATE_STOP_DETAILS");
        assert.equal(model.primary?.mode, "apply");
    });

    it("WRONG_DATA without structured fields → Open route editor", () => {
        const model = buildReportDetailActionModel(
            report({
                report_type: { code: "wrong_info", name: "Wrong info" },
                review: review({
                    kind: "WRONG_DATA",
                    proposed_change: null,
                    allowedActions: [
                        allowed("UPDATE_STOP_DETAILS", false, "No structured proposed stop details"),
                        allowed("RESOLVE"),
                        allowed("REJECT"),
                    ],
                }),
            })
        );
        assert.equal(model.primary?.action, "OPEN_ROUTE_EDITOR");
        assert.equal(model.primary?.mode, "navigate");
    });

    it("ROUTE_ISSUE → Open route editor only", () => {
        const model = buildReportDetailActionModel(
            report({
                report_type: { code: "transport_issue", name: "Transport issue" },
                review: review({
                    kind: "ROUTE_ISSUE",
                    proposed_change: "Open route editor",
                    target_stop: null,
                    allowedActions: [
                        allowed("OPEN_ROUTE_EDITOR"),
                        allowed("RESOLVE"),
                        allowed("REJECT"),
                    ],
                }),
            })
        );
        assert.equal(model.primary?.action, "OPEN_ROUTE_EDITOR");
        assert.equal(model.primary?.mode, "navigate");
    });

    it("OTHER without route → no primary and manual editing message", () => {
        const base = report({
            report_type: { code: "other_map_issue", name: "Other" },
            field: {
                ...report().field!,
                route_public_id: null,
            },
            review: review({
                kind: "OTHER",
                proposed_change: null,
                allowedActions: [allowed("RESOLVE"), allowed("REJECT")],
            }),
        });
        const model = buildReportDetailActionModel(base);
        assert.equal(model.primary, null);
        assert.equal(model.noDirectActionMessage, NO_DIRECT_ACTION_MESSAGE);
    });

    it("stale snapshot keeps apply enabled but requires acknowledgment", () => {
        const model = buildReportDetailActionModel(
            report({
                field: { ...report().field!, snapshot_stale: true },
            })
        );
        assert.equal(model.stale, true);
        assert.equal(model.requiresStaleAck, true);
        assert.equal(model.primary?.enabled, true);
        assert.equal(model.primary?.disabledReason, null);
        assert.equal(model.manualEditor?.label, "Open stop editor");
    });
});

describe("report detail key facts and comparison", () => {
    it("builds compact key facts", () => {
        const facts = buildReportDetailKeyFacts(report(), () => "Sep 4, 2026");
        assert.equal(facts.routeVariant, "YBS-13 · D0");
        assert.equal(facts.targetStop, "First (#2)");
        assert.equal(facts.reportTime, "Sep 4, 2026");
        assert.equal(facts.proposedChange, "Move stop");
    });

    it("builds before/after for STOP_MOVED without empty state", () => {
        const comparison = buildReportDetailComparison(report());
        assert.ok(comparison);
        assert.equal(comparison.empty, false);
        assert.match(comparison.before.value, /16\.80000/);
        assert.match(comparison.after.value, /16\.90000/);
    });
});

describe("report detail panel components", () => {
    it("loading state markup", () => {
        const markup = renderToStaticMarkup(createElement(ReportDetailLoadingState));
        assert.match(markup, /Loading report/);
        assert.match(markup, /animate-pulse/);
    });

    it("error state markup", () => {
        const markup = renderToStaticMarkup(
            createElement(ReportDetailErrorState, {
                message: "Network failed",
                onRetry() {},
                backHref: "/dashboard/reports",
            })
        );
        assert.match(markup, /Network failed/);
        assert.match(markup, /Try again/);
        assert.match(markup, /Back to reports/);
    });

    it("empty state markup", () => {
        const markup = renderToStaticMarkup(
            createElement(ReportDetailEmptyState, { backHref: "/dashboard/reports" })
        );
        assert.match(markup, /No report found/);
    });

    it("key facts card shows route, stop, time, proposed change", () => {
        const markup = renderToStaticMarkup(
            createElement(ReportDetailKeyFactsCard, {
                facts: {
                    routeVariant: "YBS-13 · D0",
                    targetStop: "First (#2)",
                    reportTime: "Sep 4",
                    proposedChange: "Move stop",
                },
            })
        );
        assert.match(markup, /YBS-13 · D0/);
        assert.match(markup, /First \(#2\)/);
        assert.match(markup, /Move stop/);
        assert.match(markup, /Key facts/);
    });

    it("surveyor note card shows note or empty state", () => {
        const withNote = renderToStaticMarkup(
            createElement(ReportDetailSurveyorNoteCard, { note: "8မိုင်" })
        );
        assert.match(withNote, /Surveyor note/);
        assert.match(withNote, /8မိုင်/);
        const empty = renderToStaticMarkup(createElement(ReportDetailSurveyorNoteCard, { note: "  " }));
        assert.match(empty, /No note was sent/);
    });

    it("comparison card renders before and after", () => {
        const markup = renderToStaticMarkup(
            createElement(ReportDetailComparisonCard, {
                before: { label: "Current", value: "16.8, 96.1" },
                after: { label: "Proposed", value: "16.9, 96.2" },
                empty: false,
            })
        );
        assert.match(markup, /Before \/ after/);
        assert.match(markup, /16\.8, 96\.1/);
        assert.match(markup, /16\.9, 96\.2/);
    });

    it("action panel shows one primary, resolve hint, and reject", () => {
        const model = buildReportDetailActionModel(report());
        const markup = renderToStaticMarkup(
            createElement(ReportDetailFieldActionPanel, {
                model,
                busy: false,
                onPrimary() {},
                onResolve() {},
                onReject() {},
            })
        );
        assert.match(markup, /Apply stop move/);
        assert.match(markup, /Resolve without change/);
        assert.match(markup, /Reject/);
        assert.match(markup, /Closes the report without changing map data/);
        assert.match(markup, /Open stop editor/);
        assert.match(markup, /target="_blank"/);
        assert.doesNotMatch(markup, /Open transport editor/);
    });

    it("action panel shows stale warning copy", () => {
        const model = buildReportDetailActionModel(
            report({ field: { ...report().field!, snapshot_stale: true } })
        );
        const markup = renderToStaticMarkup(
            createElement(ReportDetailFieldActionPanel, {
                model,
                busy: false,
                onPrimary() {},
                onResolve() {},
                onReject() {},
            })
        );
        assert.match(markup, /Map data changed after this survey/);
        assert.match(markup, /I reviewed the current map and still want to apply/);
        assert.match(markup, /Check the warning box above to enable apply/);
    });

    it("action panel shows manual editing message when no primary", () => {
        const model = buildReportDetailActionModel(
            report({
                field: { ...report().field!, route_public_id: null },
                review: review({
                    kind: "OTHER",
                    allowedActions: [allowed("RESOLVE"), allowed("REJECT")],
                }),
            })
        );
        const markup = renderToStaticMarkup(
            createElement(ReportDetailFieldActionPanel, {
                model,
                busy: false,
                onPrimary() {},
                onResolve() {},
                onReject() {},
            })
        );
        assert.match(markup, /This report needs manual editing/);
        assert.doesNotMatch(markup, /Apply stop move/);
    });

    it("result panel keeps open editor after resolve", () => {
        const model = buildReportDetailActionModel(report());
        const markup = renderToStaticMarkup(
            createElement(ReportDetailFieldActionPanel, {
                model,
                busy: false,
                result: {
                    action: "MOVE_STOP",
                    actionLabel: "Apply stop move",
                    statusLabel: "Resolved",
                    detail: "Apply stop move · 12 variant(s) affected",
                    toastMessage: "",
                },
                onPrimary() {},
                onResolve() {},
                onReject() {},
            })
        );
        assert.match(markup, /Resolved/);
        assert.match(markup, /Open stop editor/);
        assert.doesNotMatch(markup, /aria-label="Apply stop move"/);
        assert.doesNotMatch(markup, />Reject</);
    });
});
