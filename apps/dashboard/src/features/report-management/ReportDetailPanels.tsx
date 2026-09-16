"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import {
    NO_DIRECT_ACTION_MESSAGE,
    RESOLVE_WITHOUT_CHANGE_HINT,
    STALE_APPLY_ACK_LABEL,
    STALE_SNAPSHOT_WARNING,
    type ComparisonSide,
    type ReportDetailActionModel,
    type ReportDetailKeyFacts,
} from "./reportDetailView";
import type { ApplyConfirmationSummary, ApplyResultSummary } from "./reportApplyFlow";
import { MAP_DATA_CHANGED_MESSAGE } from "./reportApplyFlow";
import { FIELD_EDITOR_LINK_PROPS } from "./fieldReportLinks";

export const PRIMARY_BTN =
    "rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 disabled:cursor-not-allowed disabled:opacity-50";
export const SECONDARY_BTN =
    "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 disabled:cursor-not-allowed disabled:opacity-50";
export const DANGER_BTN =
    "rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-50";
export const INPUT_CLASS =
    "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
export const SELECT_CLASS =
    "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
            {children}
        </section>
    );
}

export function CollapsibleCard({
    title,
    description,
    defaultOpen = false,
    children,
}: {
    title: string;
    description?: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="flex w-full items-center justify-between gap-4 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
                aria-expanded={open}
            >
                <span>
                    <span className="block text-sm font-semibold text-gray-900">{title}</span>
                    {description ? <span className="mt-0.5 block text-xs text-gray-500">{description}</span> : null}
                </span>
                <ChevronDown
                    className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
                    aria-hidden
                />
            </button>
            {open ? <div className="border-t border-gray-100 p-4">{children}</div> : null}
        </section>
    );
}

export function Field({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</span>
            <span className="text-sm text-gray-900">{value}</span>
        </div>
    );
}

export function Badge({
    children,
    className,
}: {
    children: React.ReactNode;
    className: string;
}) {
    return (
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${className}`}>
            {children}
        </span>
    );
}

export function ReportDetailLoadingState() {
    return (
        <main className="p-6" aria-busy="true" aria-label="Loading report">
            <div className="mx-auto max-w-6xl space-y-4 animate-pulse">
                <div className="h-5 w-28 rounded bg-gray-200" />
                <div className="h-10 w-64 rounded bg-gray-200" />
                <div className="grid gap-5 lg:grid-cols-3">
                    <div className="space-y-4 lg:col-span-2">
                        <div className="h-28 rounded-lg bg-gray-200" />
                        <div className="h-24 rounded-lg bg-gray-200" />
                        <div className="h-72 rounded-lg bg-gray-200" />
                    </div>
                    <div className="h-56 rounded-lg bg-gray-200" />
                </div>
            </div>
        </main>
    );
}

export function ReportDetailErrorState({
    message,
    onRetry,
    backHref,
}: {
    message: string;
    onRetry: () => void;
    backHref: string;
}) {
    return (
        <main className="p-6">
            <div className="mx-auto max-w-5xl space-y-4">
                <Link href={backHref} className="text-sm text-gray-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900">
                    ← Back to reports
                </Link>
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <span>{message}</span>
                        <button
                            type="button"
                            onClick={onRetry}
                            className="font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                        >
                            Try again
                        </button>
                    </div>
                </div>
            </div>
        </main>
    );
}

export function ReportDetailEmptyState({ backHref }: { backHref: string }) {
    return (
        <main className="p-6">
            <div className="mx-auto max-w-5xl space-y-4">
                <Link href={backHref} className="text-sm text-gray-600 hover:underline">
                    ← Back to reports
                </Link>
                <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">
                    No report found.
                </div>
            </div>
        </main>
    );
}

export function ReportDetailKeyFactsCard({ facts }: { facts: ReportDetailKeyFacts }) {
    return (
        <Card title="Key facts">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Route / variant" value={facts.routeVariant} />
                <Field label="Target stop" value={facts.targetStop} />
                <Field label="Report time" value={facts.reportTime} />
                <Field label="Proposed change" value={facts.proposedChange} />
            </div>
        </Card>
    );
}

/** Surveyor free-text note from the field app (API `description`). */
export function ReportDetailSurveyorNoteCard({ note }: { note: string | null | undefined }) {
    const trimmed = note?.trim() ?? "";
    return (
        <Card title="Surveyor note">
            {trimmed ? (
                <p className="whitespace-pre-wrap text-sm text-gray-900">{trimmed}</p>
            ) : (
                <p className="text-sm text-gray-500">No note was sent with this report.</p>
            )}
        </Card>
    );
}

export function ReportDetailComparisonCard({
    before,
    after,
    empty,
}: {
    before: ComparisonSide;
    after: ComparisonSide;
    empty: boolean;
}) {
    if (empty) {
        return (
            <Card title="Before / after">
                <p className="text-sm text-gray-500">No structured comparison for this report.</p>
            </Card>
        );
    }
    return (
        <Card title="Before / after">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-md border border-gray-100 bg-gray-50 p-3">
                    <Field label={before.label} value={before.value} />
                </div>
                <div className="rounded-md border border-emerald-100 bg-emerald-50/60 p-3">
                    <Field label={after.label} value={after.value} />
                </div>
            </div>
        </Card>
    );
}

export function ReportDetailFieldActionPanel({
    model,
    busy,
    result,
    conflictNotice,
    onPrimary,
    onResolve,
    onReject,
}: {
    model: ReportDetailActionModel;
    busy: boolean;
    result?: ApplyResultSummary | null;
    conflictNotice?: string | null;
    onPrimary: () => void;
    onResolve: () => void;
    onReject: () => void;
}) {
    const [staleAck, setStaleAck] = useState(false);

    if (result) {
        return (
            <Card title="Result">
                <div className="space-y-3">
                    <div className="space-y-2">
                        <p className="text-sm font-medium text-emerald-800">{result.statusLabel}</p>
                        <p className="text-sm text-gray-700">{result.detail}</p>
                    </div>
                    {model.manualEditor ? (
                        <div className="space-y-1">
                            <Link
                                href={model.manualEditor.href}
                                {...FIELD_EDITOR_LINK_PROPS}
                                className={`inline-flex w-full items-center justify-center ${SECONDARY_BTN}`}
                                aria-label={model.manualEditor.label}
                            >
                                {model.manualEditor.label}
                            </Link>
                            <p className="text-xs text-gray-500">
                                Optional: open the live stop or route editor in a new tab.
                            </p>
                        </div>
                    ) : null}
                </div>
            </Card>
        );
    }

    const primaryBlockedByAck = model.requiresStaleAck && !staleAck;
    const primaryDisabled = busy || !model.primary?.enabled || primaryBlockedByAck;

    return (
        <Card title="Actions">
            <div className="space-y-3">
                {conflictNotice ? (
                    <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950" role="status">
                        {conflictNotice}
                    </p>
                ) : null}

                {model.stale && !conflictNotice ? (
                    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-2" role="status">
                        <p className="text-xs text-amber-900">{STALE_SNAPSHOT_WARNING}</p>
                        {model.requiresStaleAck ? (
                            <label className="flex items-start gap-2 text-xs text-amber-950">
                                <input
                                    type="checkbox"
                                    className="mt-0.5 rounded border-amber-400"
                                    checked={staleAck}
                                    disabled={busy}
                                    onChange={(event) => setStaleAck(event.target.checked)}
                                />
                                <span>{STALE_APPLY_ACK_LABEL}</span>
                            </label>
                        ) : null}
                    </div>
                ) : null}

                {model.noDirectActionMessage ? (
                    <p className="text-sm text-gray-600">{model.noDirectActionMessage}</p>
                ) : null}

                {model.primary ? (
                    <div className="space-y-1">
                        <button
                            type="button"
                            disabled={primaryDisabled}
                            onClick={onPrimary}
                            className={`w-full ${PRIMARY_BTN}`}
                            aria-label={model.primary.label}
                            title={
                                primaryBlockedByAck
                                    ? STALE_APPLY_ACK_LABEL
                                    : (model.primary.disabledReason ?? undefined)
                            }
                        >
                            {model.primary.label}
                        </button>
                        {!model.primary.enabled && model.primary.disabledReason ? (
                            <p className="text-xs text-gray-500">{model.primary.disabledReason}</p>
                        ) : null}
                        {primaryBlockedByAck ? (
                            <p className="text-xs text-gray-500">Check the warning box above to enable apply.</p>
                        ) : null}
                    </div>
                ) : null}

                {model.manualEditor ? (
                    <div className="space-y-1">
                        <Link
                            href={model.manualEditor.href}
                            {...FIELD_EDITOR_LINK_PROPS}
                            className={`inline-flex w-full items-center justify-center ${SECONDARY_BTN}`}
                            aria-label={model.manualEditor.label}
                        >
                            {model.manualEditor.label}
                        </Link>
                        <p className="text-xs text-gray-500">
                            Optional: edit the live stop or route manually (opens in a new tab).
                        </p>
                    </div>
                ) : null}

                <div className="space-y-1">
                    <button
                        type="button"
                        disabled={busy || !model.resolve?.enabled}
                        onClick={onResolve}
                        className={`w-full ${SECONDARY_BTN}`}
                        aria-label="Resolve without change"
                        title={model.resolve?.disabledReason ?? RESOLVE_WITHOUT_CHANGE_HINT}
                    >
                        Resolve without change
                    </button>
                    <p className="text-xs text-gray-500">{RESOLVE_WITHOUT_CHANGE_HINT}</p>
                    {!model.resolve?.enabled && model.resolve?.disabledReason ? (
                        <p className="text-xs text-gray-500">{model.resolve.disabledReason}</p>
                    ) : null}
                </div>

                <div className="space-y-1">
                    <button
                        type="button"
                        disabled={busy || !model.reject?.enabled}
                        onClick={onReject}
                        className={`w-full ${DANGER_BTN}`}
                        aria-label="Reject report"
                        title={model.reject?.disabledReason ?? undefined}
                    >
                        Reject
                    </button>
                    {!model.reject?.enabled && model.reject?.disabledReason ? (
                        <p className="text-xs text-gray-500">{model.reject.disabledReason}</p>
                    ) : null}
                </div>

                {!model.primary && !model.noDirectActionMessage ? (
                    <p className="text-sm text-gray-600">{NO_DIRECT_ACTION_MESSAGE}</p>
                ) : null}
            </div>
        </Card>
    );
}

export function ApplyConfirmationDialog({
    summary,
    busy,
    onConfirm,
    onCancel,
}: {
    summary: ApplyConfirmationSummary;
    busy: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/35 p-4"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget && !busy) onCancel();
            }}
        >
            <div
                className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="apply-confirm-title"
            >
                <h2 id="apply-confirm-title" className="text-lg font-semibold text-gray-900">
                    Confirm {summary.actionLabel.toLowerCase()}?
                </h2>
                {summary.staleWarning ? (
                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
                        {summary.staleWarning}
                    </p>
                ) : null}
                <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Action</dt>
                        <dd className="text-right font-medium text-gray-900">{summary.actionLabel}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Target</dt>
                        <dd className="text-right text-gray-900">{summary.target}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Old value</dt>
                        <dd className="text-right text-gray-900">{summary.oldValue}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Proposed value</dt>
                        <dd className="text-right text-gray-900">{summary.proposedValue}</dd>
                    </div>
                    {summary.changeDetail ? (
                        <div className="flex justify-between gap-3">
                            <dt className="text-gray-500">Change</dt>
                            <dd className="text-right text-gray-900">{summary.changeDetail}</dd>
                        </div>
                    ) : null}
                    <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Affected variants</dt>
                        <dd className="text-right text-gray-900">{summary.affectedVariantsLabel}</dd>
                    </div>
                </dl>
                <div className="mt-5 flex justify-end gap-2">
                    <button type="button" disabled={busy} onClick={onCancel} className={SECONDARY_BTN}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={onConfirm}
                        className={summary.tone === "danger" ? DANGER_BTN : PRIMARY_BTN}
                        aria-label={summary.confirmLabel}
                    >
                        {busy ? "Working…" : summary.confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function ReportApplyToast({ message }: { message: string | null }) {
    if (!message) return null;
    return (
        <div
            className="pointer-events-none fixed bottom-4 left-1/2 z-[60] max-w-[min(92vw,28rem)] -translate-x-1/2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 shadow-sm"
            role="status"
            aria-live="polite"
        >
            {message}
        </div>
    );
}

export { MAP_DATA_CHANGED_MESSAGE };
