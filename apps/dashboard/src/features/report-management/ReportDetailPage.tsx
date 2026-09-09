"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { reportsPath } from "@/src/lib/dashboardPaths";

import {
    applyReportAction,
    changeReportStatus,
    getReport,
    requestReportInfo,
    rewardReportPoints,
    updateReportAdminNote,
} from "./api";
import {
    REWARD_REASON_OPTIONS,
    formatDateTime,
    reportTypeBadgeClass,
    reportTypeLabel,
    statusBadgeClass,
    statusLabel,
    targetTypeLabel,
} from "./constants";
import { fieldRouteEditorHref } from "./fieldReportLinks";
import { sessionFinalizationLabel } from "./fieldEvidenceView";
import {
    isNewStopReport,
    locationSourceLabel,
    nextStopLabel,
    previousStopLabel,
} from "./newStopReview";
import ReportEvidence from "./ReportEvidence";
import {
    Badge,
    Card,
    CollapsibleCard,
    DANGER_BTN,
    Field,
    INPUT_CLASS,
    PRIMARY_BTN,
    ApplyConfirmationDialog,
    ReportApplyToast,
    ReportDetailComparisonCard,
    ReportDetailEmptyState,
    ReportDetailErrorState,
    ReportDetailFieldActionPanel,
    ReportDetailKeyFactsCard,
    ReportDetailLoadingState,
    SECONDARY_BTN,
    SELECT_CLASS,
} from "./ReportDetailPanels";
import {
    buildReportDetailActionModel,
    buildReportDetailComparison,
    buildReportDetailKeyFacts,
} from "./reportDetailView";
import { buildEvidenceMapModel } from "./evidenceMapModel";
import {
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
    type ApplyFlowState,
} from "./reportApplyFlow";
import type { ReportReviewActionCode, ReportStatusCode, RewardReasonCode } from "./types";

const ReportLocationCompareMap = dynamic(() => import("./ReportLocationCompareMap"), {
    ssr: false,
    loading: () => <p className="text-sm text-gray-500">Loading map…</p>,
});

type Confirmation = {
    title: string;
    description: string;
    confirmLabel: string;
    tone?: "default" | "danger";
    onConfirm: () => void;
};

function ConfirmationDialog({ value, busy, onClose }: { value: Confirmation; busy: boolean; onClose: () => void }) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/35 p-4"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget && !busy) onClose();
            }}
        >
            <div
                className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="report-confirm-title"
            >
                <h2 id="report-confirm-title" className="text-lg font-semibold text-gray-900">
                    {value.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-gray-600">{value.description}</p>
                <div className="mt-5 flex justify-end gap-2">
                    <button type="button" disabled={busy} onClick={onClose} className={SECONDARY_BTN}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={value.onConfirm}
                        className={value.tone === "danger" ? DANGER_BTN : PRIMARY_BTN}
                    >
                        {busy ? "Working…" : value.confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function ReportDetailPage({ id }: { id: string }) {
    const [actionLoading, setActionLoading] = useState(false);
    const [actionError, setActionError] = useState("");
    const [actionMsg, setActionMsg] = useState("");

    const [requestInfoText, setRequestInfoText] = useState("");
    const [noteText, setNoteText] = useState("");
    const [rewardPoints, setRewardPoints] = useState("10");
    const [rewardReason, setRewardReason] = useState<RewardReasonCode>("valid_report");
    const [rewardNote, setRewardNote] = useState("");
    const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
    const [applyFlow, setApplyFlow] = useState<ApplyFlowState>(() => createApplyFlowState());
    const applyInFlightRef = useRef(false);

    const reportQuery = useQuery({
        queryKey: ["reports", "detail", id],
        queryFn: ({ signal }) => getReport(id, { signal }),
        staleTime: 30_000,
    });
    const report = reportQuery.data;

    useEffect(() => {
        if (report) setNoteText(report.admin_note ?? "");
    }, [report]);

    useEffect(() => {
        if (!applyFlow.toast) return;
        const timer = window.setTimeout(() => {
            setApplyFlow((prev) => clearApplyToast(prev));
        }, 2800);
        return () => window.clearTimeout(timer);
    }, [applyFlow.toast]);

    const runAction = useCallback(
        async (fn: () => Promise<unknown>, successMsg: string) => {
            setActionLoading(true);
            setActionError("");
            setActionMsg("");
            try {
                await fn();
                setConfirmation(null);
                setActionMsg(successMsg);
                await reportQuery.refetch();
            } catch (err) {
                setActionError(err instanceof Error ? err.message : "Action failed.");
            } finally {
                setActionLoading(false);
            }
        },
        [reportQuery]
    );

    if (reportQuery.isPending) {
        return <ReportDetailLoadingState />;
    }

    if (reportQuery.error) {
        const error =
            reportQuery.error instanceof Error ? reportQuery.error.message : "Unable to load this report.";
        return (
            <ReportDetailErrorState
                message={error}
                onRetry={() => void reportQuery.refetch()}
                backHref={reportsPath()}
            />
        );
    }

    if (!report) {
        return <ReportDetailEmptyState backHref={reportsPath()} />;
    }

    const detail = report;
    const status = detail.status.code;
    const isField = detail.source_code === "field_survey";
    const canMarkInReview = status === "submitted";
    const canAccept = !isField && status === "in_review";
    const canRejectPublic = !isField && status === "in_review";
    const canMarkDuplicate = !isField && (status === "submitted" || status === "in_review");
    const canRequestInfo = !isField && (status === "submitted" || status === "in_review");
    const canReward =
        !isField &&
        status === "accepted" &&
        detail.eligible_for_points &&
        detail.reward_granted_at === null;

    const changeStatus = (next: ReportStatusCode, msg: string) =>
        runAction(() => changeReportStatus(detail.public_id, next), msg);

    const hasGeom = detail.latitude !== null && detail.longitude !== null;
    const osmUrl = hasGeom
        ? `https://www.openstreetmap.org/?mlat=${detail.latitude}&mlon=${detail.longitude}#map=17/${detail.latitude}/${detail.longitude}`
        : null;
    const field = detail.field;
    const isNewStop = isNewStopReport(detail.report_type.code);
    const snapshotJson =
        field?.canonical_snapshot != null ? JSON.stringify(field.canonical_snapshot, null, 2) : null;

    const keyFacts = buildReportDetailKeyFacts(detail, formatDateTime);
    const comparison = buildReportDetailComparison(detail);
    const actionModel = buildReportDetailActionModel(detail);
    const evidenceMapModel = buildEvidenceMapModel(detail);
    const reportId = detail.public_id;
    const applyBusy = applyFlow.phase === "submitting" || actionLoading;
    const applyResult =
        applyFlow.result ??
        (isField && (status === "resolved" || status === "rejected")
            ? {
                  action: (status === "rejected" ? "REJECT" : "RESOLVE") as ReportReviewActionCode,
                  actionLabel: status === "rejected" ? "Reject" : "Resolve without change",
                  statusLabel: statusLabel(status),
                  detail: "Report closed.",
                  toastMessage: "",
              }
            : null);

    function formatPoint(point: { latitude: number; longitude: number } | null | undefined): string {
        if (!point) return "—";
        return `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;
    }

    function requestApplyConfirm(action: ReportReviewActionCode) {
        const summary = buildApplyConfirmation(detail, action);
        setApplyFlow((prev) => openApplyConfirmation(prev, summary));
        if (!summary) {
            setActionError("That action is not available for this report.");
        } else {
            setActionError("");
        }
    }

    async function submitConfirmedApply() {
        if (applyInFlightRef.current) {
            return;
        }
        const pending = applyFlow.confirmation;
        if (!pending || applyFlow.phase === "submitting") {
            return;
        }

        const started = beginApplySubmit(applyFlow);
        if (!started) {
            return;
        }
        setApplyFlow(started);

        const action = pending.action;
        const revision = actionModel.expectedCanonicalRevision;
        if (!revision) {
            setApplyFlow((prev) =>
                completeApplyFailure(prev, "Canonical revision is missing; refresh and try again.")
            );
            setActionError("Canonical revision is missing; refresh and try again.");
            return;
        }

        applyInFlightRef.current = true;
        setActionError("");
        setActionMsg("");
        try {
            // Wait for server commit — no optimistic canonical UI.
            const applyResponse = await applyReportAction(
                reportId,
                buildApplyRequestBody(action, revision)
            );
            await reportQuery.refetch();
            const summary = buildApplyResultSummary(action, applyResponse);
            setApplyFlow((prev) => completeApplySuccess(prev, summary));
        } catch (err) {
            if (isReportApplyConflictError(err)) {
                await reportQuery.refetch();
                setApplyFlow((prev) => completeApplyConflict(prev));
                setActionError("");
            } else {
                const message = formatReportApplyError(err);
                setApplyFlow((prev) => completeApplyFailure(prev, message));
                setActionError(message);
            }
        } finally {
            applyInFlightRef.current = false;
        }
    }

    function handlePrimary() {
        const primary = actionModel.primary;
        if (!primary) return;
        if (primary.mode === "navigate") {
            const routeId = field?.route_public_id;
            if (!routeId) {
                setActionError("Route is missing from report evidence.");
                return;
            }
            window.location.assign(fieldRouteEditorHref(routeId));
            return;
        }
        requestApplyConfirm(primary.action);
    }

    const fieldActionPanel = (
        <ReportDetailFieldActionPanel
            model={actionModel}
            busy={applyBusy}
            result={applyResult}
            conflictNotice={applyFlow.conflictNotice}
            onPrimary={handlePrimary}
            onResolve={() => requestApplyConfirm("RESOLVE")}
            onReject={() => requestApplyConfirm("REJECT")}
        />
    );

    return (
        <main className="p-6">
            <div className="mx-auto max-w-6xl space-y-5">
                <div>
                    <Link
                        href={reportsPath()}
                        className="text-sm text-gray-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
                    >
                        ← Back to reports
                    </Link>
                </div>

                <header className="flex flex-wrap items-center gap-2 border-b border-gray-200 pb-4">
                    <h1 className="sr-only">{reportTypeLabel(report.report_type.code)}</h1>
                    <Badge className={reportTypeBadgeClass(report.report_type.code)}>
                        {reportTypeLabel(report.report_type.code)}
                    </Badge>
                    <Badge className={statusBadgeClass(status)}>{statusLabel(status)}</Badge>
                    {isField ? (
                        <Badge className="bg-violet-50 text-violet-800 ring-violet-100">Field survey</Badge>
                    ) : (
                        <Badge className="bg-gray-100 text-gray-700 ring-gray-200">Public</Badge>
                    )}
                    {report.is_anonymous ? (
                        <Badge className="bg-gray-100 text-gray-600 ring-gray-200">Anonymous</Badge>
                    ) : null}
                </header>

                {reportQuery.isFetching ? (
                    <div className="flex items-center gap-2 text-xs text-gray-500" role="status">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        Refreshing report…
                    </div>
                ) : null}

                {actionError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                        {actionError}
                    </div>
                ) : null}
                {actionMsg ? (
                    <div
                        className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
                        role="status"
                    >
                        {actionMsg}
                    </div>
                ) : null}

                <div className="grid gap-5 lg:grid-cols-3">
                    <div className="space-y-5 lg:col-span-2">
                        {isField ? <ReportDetailKeyFactsCard facts={keyFacts} /> : null}

                        {!isField ? (
                            <Card title="Report">
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <Field label="Priority" value={<span className="capitalize">{report.priority}</span>} />
                                    <Field label="Created" value={formatDateTime(report.created_at)} />
                                </div>
                                <div className="mt-4">
                                    <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                                        Description
                                    </span>
                                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">{report.description}</p>
                                </div>
                            </Card>
                        ) : null}

                        {comparison ? (
                            <ReportDetailComparisonCard
                                before={comparison.before}
                                after={comparison.after}
                                empty={comparison.empty}
                            />
                        ) : null}

                        {isField ? (
                            <Card title="Evidence map">
                                <ReportLocationCompareMap
                                    key={`${report.public_id}:${report.review?.field_snapshot_revision ?? ""}:${report.review?.current_canonical_revision ?? ""}`}
                                    model={evidenceMapModel}
                                />
                            </Card>
                        ) : null}

                        {isField ? (
                            <ReportEvidence
                                items={report.media ?? []}
                                stopPublicId={
                                    report.field?.stop_public_id ??
                                    (report.target_entity_type === "stop" ? report.target_public_id : null)
                                }
                            />
                        ) : null}

                        <div className="space-y-5 lg:hidden">
                            {isField ? (
                                fieldActionPanel
                            ) : (
                                <Card title="Actions">
                                    <div className="flex flex-col gap-2">
                                        <button
                                            type="button"
                                            disabled={actionLoading || !canMarkInReview}
                                            onClick={() => changeStatus("in_review", "Marked as in review.")}
                                            className={SECONDARY_BTN}
                                        >
                                            Mark in review
                                        </button>
                                        <button
                                            type="button"
                                            disabled={actionLoading || !canAccept}
                                            onClick={() => changeStatus("accepted", "Report accepted.")}
                                            className={PRIMARY_BTN}
                                        >
                                            Accept
                                        </button>
                                        <button
                                            type="button"
                                            disabled={actionLoading || !canRejectPublic}
                                            onClick={() =>
                                                setConfirmation({
                                                    title: "Reject this report?",
                                                    description:
                                                        "The report will be closed as rejected. This status change is recorded in the audit history.",
                                                    confirmLabel: "Reject report",
                                                    tone: "danger",
                                                    onConfirm: () => changeStatus("rejected", "Report rejected."),
                                                })
                                            }
                                            className={DANGER_BTN}
                                        >
                                            Reject
                                        </button>
                                    </div>
                                </Card>
                            )}
                        </div>

                        <CollapsibleCard title="Reporter identity" description="Author or anonymous identity">
                            {report.is_anonymous ? (
                                <div className="space-y-2">
                                    <Badge className="bg-gray-100 text-gray-600 ring-gray-200">Anonymous</Badge>
                                    <Field label="Anonymous ID" value={report.anonymous_id ?? "—"} />
                                    <p className="text-xs text-gray-500">
                                        Anonymous reports cannot receive points or follow-ups.
                                    </p>
                                </div>
                            ) : report.author ? (
                                <div className="space-y-3">
                                    <Field label="Name" value={report.author.display_name ?? "—"} />
                                    <Field label="Email" value={report.author.email} />
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500">Reporter not available.</p>
                            )}
                        </CollapsibleCard>

                        <CollapsibleCard title="Identifiers" description="Report and entity UUIDs">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field label="Report ID" value={<span className="font-mono text-xs">{report.public_id}</span>} />
                                <Field label="Author ID" value={<span className="font-mono text-xs">{report.author?.public_id ?? "—"}</span>} />
                                <Field label="Entity type" value={targetTypeLabel(report.target_entity_type)} />
                                <Field label="Entity ID" value={report.target_entity_id ?? "—"} />
                                <Field label="Target public ID" value={report.target_public_id ?? "—"} />
                                <Field label="Admin area" value={report.admin_area_name ?? report.admin_area_id ?? "—"} />
                            </div>
                        </CollapsibleCard>

                        <CollapsibleCard title="Exact coordinates" description="Technical lat/lng values">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field label="Report point" value={hasGeom ? formatPoint({ latitude: report.latitude!, longitude: report.longitude! }) : "—"} />
                                <Field label="Canonical target" value={formatPoint(report.canonical_target)} />
                                <Field label="Observed GPS" value={formatPoint(field?.observed_location)} />
                                <Field label="Proposed point" value={formatPoint(field?.proposed_location)} />
                            </div>
                            {osmUrl ? (
                                <a
                                    href={osmUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-3 inline-block text-sm font-medium text-gray-900 underline-offset-2 hover:underline"
                                >
                                    Open report point in OSM ↗
                                </a>
                            ) : (
                                <p className="mt-3 text-sm text-gray-500">No report coordinates attached.</p>
                            )}
                        </CollapsibleCard>

                        <CollapsibleCard title="Advanced report metadata" description="Confidence, reason code, description and timestamps">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Field label="Priority" value={<span className="capitalize">{report.priority}</span>} />
                                <Field label="Confidence" value={`${report.confidence_score}/100`} />
                                <Field label="Reason code" value={report.reason_code ?? "—"} />
                                <Field label="Created" value={formatDateTime(report.created_at)} />
                                <Field label="Last updated" value={formatDateTime(report.updated_at)} />
                                <Field label="Reviewed" value={formatDateTime(report.reviewed_at)} />
                            </div>
                            {isField ? (
                                <div className="mt-4">
                                    <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                                        Description
                                    </span>
                                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">{report.description}</p>
                                </div>
                            ) : null}
                        </CollapsibleCard>

                        {isField && field ? (
                            <CollapsibleCard
                                title="Advanced field metadata"
                                description="Survey linkage, stop sequence and snapshot revisions"
                            >
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                    <Field label="Survey session" value={field.survey_session_public_id ?? "—"} />
                                    <Field
                                        label="Sync / finalization"
                                        value={sessionFinalizationLabel(field.survey_session_status)}
                                    />
                                    <Field label="Origin" value={field.origin_name ?? "—"} />
                                    <Field label="Destination" value={field.destination_name ?? "—"} />
                                    <Field
                                        label="Stop sequence"
                                        value={field.stop_sequence ?? field.previous_stop_sequence ?? "—"}
                                    />
                                    <Field
                                        label="Previous canonical stop"
                                        value={isNewStop ? previousStopLabel(field) : field.previous_stop_public_id ?? "—"}
                                    />
                                    <Field
                                        label="Next canonical stop"
                                        value={isNewStop ? nextStopLabel(field) : field.next_stop_public_id ?? "—"}
                                    />
                                    <Field label="Location source" value={locationSourceLabel(field.location_source)} />
                                    <Field label="Snapshot revision" value={field.snapshot_revision ?? "—"} />
                                    <Field label="Current revision" value={field.current_snapshot_revision ?? "—"} />
                                    <Field
                                        label="Affected routes"
                                        value={report.review?.affected_route_count ?? "—"}
                                    />
                                </div>
                            </CollapsibleCard>
                        ) : null}

                        {isField && snapshotJson ? (
                            <CollapsibleCard
                                title="Raw canonical snapshot"
                                description="Technical JSON captured when the survey started"
                            >
                                <pre className="max-h-72 overflow-auto rounded-md bg-gray-50 p-3 text-xs text-gray-800">
                                    {snapshotJson}
                                </pre>
                            </CollapsibleCard>
                        ) : null}

                        <CollapsibleCard
                            title="Status history"
                            description={`${report.status_events.length} lifecycle event${report.status_events.length === 1 ? "" : "s"}`}
                        >
                            {report.status_events.length === 0 ? (
                                <p className="text-sm text-gray-500">No status changes yet.</p>
                            ) : (
                                <ol className="space-y-2">
                                    {report.status_events.map((ev, i) => (
                                        <li
                                            key={`${ev.created_at}-${i}`}
                                            className="flex flex-wrap items-center gap-2 text-sm"
                                        >
                                            <span className="text-gray-400">{formatDateTime(ev.created_at)}</span>
                                            <span className="text-gray-700">
                                                {ev.old_status_code
                                                    ? `${statusLabel(ev.old_status_code)} → ${statusLabel(ev.new_status_code)}`
                                                    : statusLabel(ev.new_status_code)}
                                            </span>
                                            {ev.actor_display_name ? (
                                                <span className="text-gray-500">by {ev.actor_display_name}</span>
                                            ) : null}
                                            {ev.note ? <span className="text-gray-500">— {ev.note}</span> : null}
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </CollapsibleCard>

                        <CollapsibleCard
                            title="Follow-up messages"
                            description={`${report.followups.length} message${report.followups.length === 1 ? "" : "s"}`}
                        >
                            {report.followups.length === 0 ? (
                                <p className="text-sm text-gray-500">No follow-up messages.</p>
                            ) : (
                                <ul className="space-y-3">
                                    {report.followups.map((f, i) => (
                                        <li
                                            key={`${f.created_at}-${i}`}
                                            className="rounded-md border border-gray-200 p-3"
                                        >
                                            <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
                                                <span className="font-medium capitalize text-gray-700">{f.actor_type}</span>
                                                {f.actor_display_name ? <span>· {f.actor_display_name}</span> : null}
                                                <span>· {formatDateTime(f.created_at)}</span>
                                            </div>
                                            <p className="whitespace-pre-wrap text-sm text-gray-900">{f.message}</p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CollapsibleCard>

                        <CollapsibleCard title="Admin note" description="Internal only — not shown to the reporter">
                            <textarea
                                rows={4}
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                                placeholder="Internal note (not shown to the reporter)…"
                                className={INPUT_CLASS}
                            />
                            <button
                                type="button"
                                disabled={actionLoading}
                                onClick={() =>
                                    runAction(
                                        () =>
                                            updateReportAdminNote(
                                                report.public_id,
                                                noteText.trim() === "" ? null : noteText
                                            ),
                                        "Admin note saved."
                                    )
                                }
                                className={`mt-2 ${SECONDARY_BTN}`}
                            >
                                Save note
                            </button>
                        </CollapsibleCard>
                    </div>

                    <div className="hidden space-y-5 lg:sticky lg:top-5 lg:block lg:self-start">
                        {isField ? (
                            fieldActionPanel
                        ) : (
                            <>
                                <Card title="Actions">
                                    <div className="flex flex-col gap-2">
                                        <button
                                            type="button"
                                            disabled={actionLoading || !canMarkInReview}
                                            onClick={() => changeStatus("in_review", "Marked as in review.")}
                                            className={SECONDARY_BTN}
                                        >
                                            Mark in review
                                        </button>
                                        <button
                                            type="button"
                                            disabled={actionLoading || !canAccept}
                                            onClick={() => changeStatus("accepted", "Report accepted.")}
                                            className={PRIMARY_BTN}
                                        >
                                            Accept
                                        </button>
                                        <button
                                            type="button"
                                            disabled={actionLoading || !canRejectPublic}
                                            onClick={() =>
                                                setConfirmation({
                                                    title: "Reject this report?",
                                                    description:
                                                        "The report will be closed as rejected. This status change is recorded in the audit history.",
                                                    confirmLabel: "Reject report",
                                                    tone: "danger",
                                                    onConfirm: () => changeStatus("rejected", "Report rejected."),
                                                })
                                            }
                                            className={DANGER_BTN}
                                        >
                                            Reject
                                        </button>
                                        <button
                                            type="button"
                                            disabled={actionLoading || !canMarkDuplicate}
                                            onClick={() =>
                                                setConfirmation({
                                                    title: "Mark as duplicate?",
                                                    description:
                                                        "The report will be closed as a duplicate and removed from the active review queue.",
                                                    confirmLabel: "Mark duplicate",
                                                    onConfirm: () =>
                                                        changeStatus("duplicate", "Marked as duplicate."),
                                                })
                                            }
                                            className={SECONDARY_BTN}
                                        >
                                            Mark duplicate
                                        </button>
                                    </div>
                                    {status === "needs_more_info" ? (
                                        <p className="mt-3 text-xs text-gray-500">
                                            Waiting for the reporter to reply. The status returns to “Submitted”
                                            after their follow-up.
                                        </p>
                                    ) : null}
                                </Card>

                                {canRequestInfo ? (
                                    <Card title="Request more info">
                                        <textarea
                                            rows={3}
                                            value={requestInfoText}
                                            onChange={(e) => setRequestInfoText(e.target.value)}
                                            placeholder="Ask the reporter a question…"
                                            className={INPUT_CLASS}
                                        />
                                        <button
                                            type="button"
                                            disabled={actionLoading || requestInfoText.trim().length === 0}
                                            onClick={() =>
                                                runAction(async () => {
                                                    await requestReportInfo(
                                                        report.public_id,
                                                        requestInfoText.trim()
                                                    );
                                                    setRequestInfoText("");
                                                }, "Requested more info. Status set to needs more info.")
                                            }
                                            className={`mt-2 ${PRIMARY_BTN}`}
                                        >
                                            Send request
                                        </button>
                                    </Card>
                                ) : null}

                                <Card title="Reward points">
                                    {report.reward_granted_at ? (
                                        <p className="text-sm text-emerald-700">
                                            Reward already granted on {formatDateTime(report.reward_granted_at)}.
                                        </p>
                                    ) : canReward ? (
                                        <div className="space-y-3">
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                                    Points (negative to deduct)
                                                </span>
                                                <input
                                                    type="number"
                                                    value={rewardPoints}
                                                    onChange={(e) => setRewardPoints(e.target.value)}
                                                    className={INPUT_CLASS}
                                                />
                                            </label>
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                                    Reason
                                                </span>
                                                <select
                                                    value={rewardReason}
                                                    onChange={(e) =>
                                                        setRewardReason(e.target.value as RewardReasonCode)
                                                    }
                                                    className={SELECT_CLASS}
                                                >
                                                    {REWARD_REASON_OPTIONS.map((o) => (
                                                        <option key={o.value} value={o.value}>
                                                            {o.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                            <input
                                                type="text"
                                                value={rewardNote}
                                                onChange={(e) => setRewardNote(e.target.value)}
                                                placeholder="Optional note"
                                                className={INPUT_CLASS}
                                            />
                                            <button
                                                type="button"
                                                disabled={
                                                    actionLoading ||
                                                    !Number.isInteger(Number(rewardPoints)) ||
                                                    Number(rewardPoints) === 0
                                                }
                                                onClick={() =>
                                                    setConfirmation({
                                                        title: "Confirm point adjustment",
                                                        description: `${Number(rewardPoints) > 0 ? "Add" : "Deduct"} ${Math.abs(Number(rewardPoints))} points for “${REWARD_REASON_OPTIONS.find((option) => option.value === rewardReason)?.label ?? rewardReason}”. This creates an immutable ledger entry.`,
                                                        confirmLabel: "Confirm points",
                                                        onConfirm: () =>
                                                            runAction(async () => {
                                                                await rewardReportPoints(report.public_id, {
                                                                    pointsDelta: Number(rewardPoints),
                                                                    reasonCode: rewardReason,
                                                                    note: rewardNote.trim() || undefined,
                                                                });
                                                                setRewardNote("");
                                                            }, "Points updated."),
                                                    })
                                                }
                                                className={PRIMARY_BTN}
                                            >
                                                Reward points
                                            </button>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-gray-500">
                                            {report.is_anonymous
                                                ? "Anonymous reports are not eligible for points."
                                                : !report.eligible_for_points
                                                  ? "This report is not eligible for points."
                                                  : "Points can be rewarded once the report is accepted."}
                                        </p>
                                    )}
                                </Card>
                            </>
                        )}
                    </div>
                </div>
            </div>
            {applyFlow.confirmation ? (
                <ApplyConfirmationDialog
                    summary={applyFlow.confirmation}
                    busy={applyFlow.phase === "submitting"}
                    onCancel={() => setApplyFlow((prev) => cancelApplyConfirmation(prev))}
                    onConfirm={() => void submitConfirmedApply()}
                />
            ) : null}
            {confirmation ? (
                <ConfirmationDialog
                    value={confirmation}
                    busy={actionLoading}
                    onClose={() => setConfirmation(null)}
                />
            ) : null}
            <ReportApplyToast message={applyFlow.toast} />
        </main>
    );
}
