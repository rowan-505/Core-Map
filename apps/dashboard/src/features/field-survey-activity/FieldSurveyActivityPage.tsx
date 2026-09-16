"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { listUsers } from "@/src/features/user-management/api";

import {
    getSurveySessionTimeline,
    listSurveyRouteCoverage,
    listSurveyWorkHistory,
} from "./api";
import {
    completionStatusLabel,
    formatActiveDuration,
    formatDateTime,
    presenceStatusLabel,
    workStatusLabel,
} from "./fieldSurveyActivityStatus";
import type {
    SurveyCompletionStatus,
    SurveyCoverageWorkStatus,
    SurveyPresenceStatus,
    SurveyRouteCoverageFilters,
    SurveyWorkHistoryFilters,
    SurveyWorkHistoryItem,
} from "./types";

const SELECT_CLASS =
    "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const SECONDARY_BTN =
    "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const TAB_BTN =
    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors";

type TabKey = "history" | "coverage";

function defaultHistoryRange(): { from: string; to: string } {
    const to = new Date();
    const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - 29));
    return {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
    };
}

const EMPTY_HISTORY: SurveyWorkHistoryFilters = {
    ...defaultHistoryRange(),
    routeSearch: "",
    sessionStatus: "",
    page: 1,
    pageSize: 50,
    includeShortSessions: false,
};

const EMPTY_COVERAGE: SurveyRouteCoverageFilters = {
    workStatus: "",
    routeSearch: "",
};

function isOfflineError(error: unknown): boolean {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
    if (!(error instanceof Error)) return false;
    return /failed to fetch|networkerror|offline/i.test(error.message);
}

function SummaryCard({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
        </div>
    );
}

function WorkStatusCell({ status }: { status: SurveyCoverageWorkStatus }) {
    const className =
        status === "finished"
            ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
            : status === "partial"
              ? "bg-amber-50 text-amber-800 ring-amber-200"
              : "bg-gray-100 text-gray-700 ring-gray-200";
    return (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${className}`}>
            {workStatusLabel(status)}
        </span>
    );
}

function PresenceCell({ status }: { status: SurveyPresenceStatus }) {
    if (status === "live") {
        return <span className="font-medium text-emerald-700">{presenceStatusLabel(status)}</span>;
    }
    return <span className="text-gray-600">{presenceStatusLabel(status)}</span>;
}

function CompletionCell({ status }: { status: SurveyCompletionStatus }) {
    return <span className="text-gray-700">{completionStatusLabel(status)}</span>;
}

function TimelineDrawer({
    sessionPublicId,
    onClose,
}: {
    sessionPublicId: string;
    onClose: () => void;
}) {
    const query = useQuery({
        queryKey: ["field-survey", "timeline", sessionPublicId],
        queryFn: ({ signal }) => getSurveySessionTimeline(sessionPublicId, { signal }),
    });

    return (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
            <button type="button" className="flex-1 cursor-default" aria-label="Close" onClick={onClose} />
            <aside className="flex h-full w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                    <h2 className="text-sm font-semibold text-gray-900">Session timeline</h2>
                    <button type="button" className={SECONDARY_BTN} onClick={onClose}>
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 text-sm">
                    {query.isLoading ? <p className="text-gray-600">Loading timeline…</p> : null}
                    {query.isError ? (
                        <p className="text-red-700">
                            {query.error instanceof Error
                                ? query.error.message
                                : "Could not load timeline."}
                        </p>
                    ) : null}
                    {query.isSuccess ? (
                        <div className="space-y-4">
                            <div>
                                <div className="font-medium text-gray-900">
                                    {query.data.session.route.code} · {query.data.session.variantCode}
                                </div>
                                <div className="mt-1 text-xs text-gray-500">
                                    {query.data.session.surveyor.displayName ||
                                        query.data.session.surveyor.email}
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-700">
                                    <div>Session: {query.data.session.sessionStatus}</div>
                                    <div>
                                        Presence:{" "}
                                        <PresenceCell status={query.data.session.presenceStatus} />
                                    </div>
                                    <div>
                                        Current completion:{" "}
                                        {completionStatusLabel(
                                            query.data.session.currentCompletionStatus
                                        )}
                                    </div>
                                    <div>
                                        {query.data.session.reportCountLabel ??
                                            (query.data.session.reportCount > 0
                                                ? `${query.data.session.reportCount} reports`
                                                : "No reports")}
                                    </div>
                                    <div>
                                        Checked:{" "}
                                        {query.data.session.checkedLabel ??
                                            `${query.data.session.checkedStopCount} / ${query.data.session.totalStopCount || "—"}`}
                                    </div>
                                    <div>
                                        Active:{" "}
                                        {formatActiveDuration(
                                            query.data.session.activeDurationSeconds
                                        )}
                                    </div>
                                    <div>Started: {formatDateTime(query.data.session.startedAt)}</div>
                                    <div>Ended: {formatDateTime(query.data.session.endedAt)}</div>
                                    <div className="col-span-2">
                                        Position:{" "}
                                        {query.data.session.lastPosition
                                            ? `${query.data.session.lastPosition.lat.toFixed(5)}, ${query.data.session.lastPosition.lng.toFixed(5)}${
                                                  query.data.session.lastPosition.accuracyM != null
                                                      ? ` (±${Math.round(query.data.session.lastPosition.accuracyM)}m)`
                                                      : ""
                                              }`
                                            : "—"}
                                    </div>
                                </div>
                            </div>
                            <div>
                                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Events
                                </h3>
                                {query.data.events.length === 0 ? (
                                    <p className="text-gray-600">No lifecycle events.</p>
                                ) : (
                                    <ul className="space-y-2">
                                        {query.data.events.map((event, index) => (
                                            <li
                                                key={`${event.eventType}-${event.occurredAt}-${index}`}
                                                className="rounded-md border border-gray-200 px-3 py-2"
                                            >
                                                <div className="font-medium text-gray-900">
                                                    {event.eventType}
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    {formatDateTime(event.occurredAt)}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    ) : null}
                </div>
            </aside>
        </div>
    );
}

export default function FieldSurveyActivityPage() {
    const [tab, setTab] = useState<TabKey>("coverage");
    const [surveyorPublicId, setSurveyorPublicId] = useState("");
    const [historyDraft, setHistoryDraft] = useState<SurveyWorkHistoryFilters>(EMPTY_HISTORY);
    const [historyApplied, setHistoryApplied] = useState<SurveyWorkHistoryFilters>(EMPTY_HISTORY);
    const [coverageDraft, setCoverageDraft] = useState<SurveyRouteCoverageFilters>(EMPTY_COVERAGE);
    const [coverageApplied, setCoverageApplied] =
        useState<SurveyRouteCoverageFilters>(EMPTY_COVERAGE);
    const [timelineSessionId, setTimelineSessionId] = useState<string | null>(null);

    const surveyorsQuery = useQuery({
        queryKey: ["field-survey", "surveyors"],
        queryFn: ({ signal }) =>
            listUsers(
                { role: "surveyor", accountStatus: "active", page: 1, pageSize: 100 },
                { signal }
            ),
    });

    const surveyorOptions = useMemo(
        () =>
            (surveyorsQuery.data?.items ?? []).map((user) => ({
                publicId: user.public_id,
                label: user.display_name || user.email,
            })),
        [surveyorsQuery.data?.items]
    );

    useEffect(() => {
        if (surveyorPublicId) return;
        if (surveyorOptions.length === 1) {
            setSurveyorPublicId(surveyorOptions[0]!.publicId);
        }
    }, [surveyorOptions, surveyorPublicId]);

    const selectionRequired = surveyorOptions.length > 1 && !surveyorPublicId;
    const noSurveyors = surveyorsQuery.isSuccess && surveyorOptions.length === 0;

    const historyQuery = useQuery({
        queryKey: ["field-survey", "work-history", surveyorPublicId, historyApplied],
        queryFn: ({ signal }) =>
            listSurveyWorkHistory(
                { ...historyApplied, surveyorPublicId: surveyorPublicId || undefined },
                { signal }
            ),
        enabled: Boolean(surveyorPublicId) && tab === "history",
        placeholderData: keepPreviousData,
        refetchInterval: 30_000,
    });

    const coverageQuery = useQuery({
        queryKey: ["field-survey", "route-coverage", surveyorPublicId, coverageApplied],
        queryFn: ({ signal }) =>
            listSurveyRouteCoverage(
                { ...coverageApplied, surveyorPublicId: surveyorPublicId || undefined },
                { signal }
            ),
        enabled: Boolean(surveyorPublicId) && tab === "coverage",
        placeholderData: keepPreviousData,
        refetchInterval: 30_000,
    });

    const activeQuery = tab === "history" ? historyQuery : coverageQuery;
    const offline = isOfflineError(activeQuery.error);

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-semibold text-gray-900">Field Survey</h1>
                        <p className="mt-1 text-sm text-gray-600">
                            Work history and route coverage for the field surveyor. Active now needs
                            a fresh session heartbeat (2 minutes). Assignments are not required.
                        </p>
                    </div>
                    <button
                        type="button"
                        className={SECONDARY_BTN}
                        onClick={() => void activeQuery.refetch()}
                        disabled={!surveyorPublicId || activeQuery.isFetching}
                    >
                        <span className="inline-flex items-center gap-2">
                            <RefreshCw
                                className={`h-4 w-4 ${activeQuery.isFetching ? "animate-spin" : ""}`}
                            />
                            Refresh
                        </span>
                    </button>
                </div>

                <section className="rounded-lg border border-gray-200 bg-white p-4">
                    <label className="block text-sm text-gray-700">
                        <span className="mb-1 block font-medium">Surveyor</span>
                        <select
                            className={`${SELECT_CLASS} w-full max-w-md`}
                            value={surveyorPublicId}
                            onChange={(event) => setSurveyorPublicId(event.target.value)}
                            disabled={surveyorsQuery.isLoading}
                        >
                            <option value="">
                                {surveyorOptions.length > 1
                                    ? "Select a surveyor"
                                    : surveyorOptions.length === 0
                                      ? "No active surveyor"
                                      : "Loading…"}
                            </option>
                            {surveyorOptions.map((option) => (
                                <option key={option.publicId} value={option.publicId}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    {selectionRequired ? (
                        <p className="mt-2 text-sm text-amber-800">
                            Multiple active surveyors exist. Select one to load coverage and history.
                        </p>
                    ) : null}
                    {noSurveyors ? (
                        <p className="mt-2 text-sm text-gray-600">
                            No active user with the surveyor role.
                        </p>
                    ) : null}
                </section>

                <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                        <button
                            type="button"
                            className={`${TAB_BTN} ${
                                tab === "coverage"
                                    ? "bg-gray-900 text-white"
                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                            onClick={() => setTab("coverage")}
                        >
                            Route Coverage
                        </button>
                        <button
                            type="button"
                            className={`${TAB_BTN} ${
                                tab === "history"
                                    ? "bg-gray-900 text-white"
                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                            onClick={() => setTab("history")}
                        >
                            Work History
                        </button>
                    </div>
                    <p className="text-sm text-gray-600">
                        Finished on Route Coverage means the surveyor tapped Finish on the phone for
                        that D0/D1 variant. Stop alone only ends the GPS session (Partial).
                    </p>
                </div>

                {tab === "history" ? (
                    <>
                        <section className="rounded-lg border border-gray-200 bg-white p-4">
                            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                                <label className="text-sm text-gray-700">
                                    <span className="mb-1 block font-medium">From</span>
                                    <input
                                        type="date"
                                        className={`${SELECT_CLASS} w-full`}
                                        value={historyDraft.from ?? ""}
                                        onChange={(event) =>
                                            setHistoryDraft((prev) => ({
                                                ...prev,
                                                from: event.target.value,
                                            }))
                                        }
                                    />
                                </label>
                                <label className="text-sm text-gray-700">
                                    <span className="mb-1 block font-medium">To</span>
                                    <input
                                        type="date"
                                        className={`${SELECT_CLASS} w-full`}
                                        value={historyDraft.to ?? ""}
                                        onChange={(event) =>
                                            setHistoryDraft((prev) => ({
                                                ...prev,
                                                to: event.target.value,
                                            }))
                                        }
                                    />
                                </label>
                                <label className="text-sm text-gray-700">
                                    <span className="mb-1 block font-medium">Session status</span>
                                    <select
                                        className={`${SELECT_CLASS} w-full`}
                                        value={historyDraft.sessionStatus ?? ""}
                                        onChange={(event) =>
                                            setHistoryDraft((prev) => ({
                                                ...prev,
                                                sessionStatus: event.target.value as
                                                    | ""
                                                    | "active"
                                                    | "completed"
                                                    | "abandoned",
                                            }))
                                        }
                                    >
                                        <option value="">All</option>
                                        <option value="active">Active</option>
                                        <option value="completed">Completed</option>
                                        <option value="abandoned">Abandoned</option>
                                    </select>
                                </label>
                                <label className="text-sm text-gray-700">
                                    <span className="mb-1 block font-medium">Route search</span>
                                    <input
                                        type="search"
                                        placeholder="YBS-13"
                                        className={`${SELECT_CLASS} w-full`}
                                        value={historyDraft.routeSearch ?? ""}
                                        onChange={(event) =>
                                            setHistoryDraft((prev) => ({
                                                ...prev,
                                                routeSearch: event.target.value,
                                            }))
                                        }
                                    />
                                </label>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-3">
                                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                    <input
                                        type="checkbox"
                                        className="rounded border-gray-300"
                                        checked={historyDraft.includeShortSessions === true}
                                        onChange={(event) =>
                                            setHistoryDraft((prev) => ({
                                                ...prev,
                                                includeShortSessions: event.target.checked,
                                            }))
                                        }
                                    />
                                    <span>
                                        Show short sessions
                                        {historyQuery.isSuccess
                                            ? ` (${historyQuery.data.shortEmptySessionCount})`
                                            : ""}
                                    </span>
                                </label>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
                                    onClick={() =>
                                        setHistoryApplied({ ...historyDraft, page: 1, pageSize: 50 })
                                    }
                                >
                                    Apply filters
                                </button>
                                <button
                                    type="button"
                                    className={SECONDARY_BTN}
                                    onClick={() => {
                                        setHistoryDraft(EMPTY_HISTORY);
                                        setHistoryApplied(EMPTY_HISTORY);
                                    }}
                                >
                                    Clear
                                </button>
                            </div>
                        </section>

                        {!surveyorPublicId ? (
                            <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">
                                Select a surveyor to load work history.
                            </div>
                        ) : null}

                        {surveyorPublicId && historyQuery.isLoading ? (
                            <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">
                                Loading work history…
                            </div>
                        ) : null}

                        {surveyorPublicId && historyQuery.isError ? (
                            <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
                                {offline
                                    ? "You appear offline. Reconnect, then refresh."
                                    : historyQuery.error instanceof Error
                                      ? historyQuery.error.message
                                      : "Could not load work history."}
                            </div>
                        ) : null}

                        {surveyorPublicId &&
                        historyQuery.isSuccess &&
                        historyQuery.data.items.length === 0 ? (
                            <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">
                                No survey sessions in this date range.
                            </div>
                        ) : null}

                        {surveyorPublicId &&
                        historyQuery.isSuccess &&
                        historyQuery.data.items.length > 0 ? (
                            <>
                                <div className="text-sm text-gray-600">
                                    Showing {historyQuery.data.items.length} of{" "}
                                    {historyQuery.data.total} sessions (
                                    {historyQuery.data.range.from} → {historyQuery.data.range.to})
                                </div>
                                <WorkHistoryTable
                                    items={historyQuery.data.items}
                                    onOpenTimeline={setTimelineSessionId}
                                />
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        className={SECONDARY_BTN}
                                        disabled={historyApplied.page === 1}
                                        onClick={() =>
                                            setHistoryApplied((prev) => ({
                                                ...prev,
                                                page: Math.max(1, (prev.page ?? 1) - 1),
                                            }))
                                        }
                                    >
                                        Previous
                                    </button>
                                    <button
                                        type="button"
                                        className={SECONDARY_BTN}
                                        disabled={
                                            (historyApplied.page ?? 1) * (historyApplied.pageSize ?? 50) >=
                                            historyQuery.data.total
                                        }
                                        onClick={() =>
                                            setHistoryApplied((prev) => ({
                                                ...prev,
                                                page: (prev.page ?? 1) + 1,
                                            }))
                                        }
                                    >
                                        Next
                                    </button>
                                </div>
                            </>
                        ) : null}
                    </>
                ) : null}

                {tab === "coverage" ? (
                    <>
                        {coverageQuery.isSuccess ? (
                            <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                                <SummaryCard
                                    label="Active variants"
                                    value={coverageQuery.data.summary.totalActiveVariants}
                                />
                                <SummaryCard
                                    label="Not started"
                                    value={coverageQuery.data.summary.notStarted}
                                />
                                <SummaryCard
                                    label="Partial"
                                    value={coverageQuery.data.summary.partial}
                                />
                                <SummaryCard
                                    label="Finished"
                                    value={coverageQuery.data.summary.finished}
                                />
                                <SummaryCard
                                    label="Remaining"
                                    value={coverageQuery.data.summary.remaining}
                                />
                                <SummaryCard
                                    label="Active now"
                                    value={coverageQuery.data.summary.activeNow}
                                />
                            </section>
                        ) : null}

                        <section className="rounded-lg border border-gray-200 bg-white p-4">
                            <div className="grid gap-3 md:grid-cols-2">
                                <label className="text-sm text-gray-700">
                                    <span className="mb-1 block font-medium">Work status</span>
                                    <select
                                        className={`${SELECT_CLASS} w-full`}
                                        value={coverageDraft.workStatus ?? ""}
                                        onChange={(event) =>
                                            setCoverageDraft((prev) => ({
                                                ...prev,
                                                workStatus: event.target
                                                    .value as SurveyCoverageWorkStatus | "",
                                            }))
                                        }
                                    >
                                        <option value="">All statuses</option>
                                        <option value="not_started">Not started</option>
                                        <option value="partial">Partial</option>
                                        <option value="finished">Finished</option>
                                    </select>
                                </label>
                                <label className="text-sm text-gray-700">
                                    <span className="mb-1 block font-medium">Route search</span>
                                    <input
                                        type="search"
                                        placeholder="YBS-13"
                                        className={`${SELECT_CLASS} w-full`}
                                        value={coverageDraft.routeSearch ?? ""}
                                        onChange={(event) =>
                                            setCoverageDraft((prev) => ({
                                                ...prev,
                                                routeSearch: event.target.value,
                                            }))
                                        }
                                    />
                                </label>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
                                    onClick={() => setCoverageApplied({ ...coverageDraft })}
                                >
                                    Apply filters
                                </button>
                                <button
                                    type="button"
                                    className={SECONDARY_BTN}
                                    onClick={() => {
                                        setCoverageDraft(EMPTY_COVERAGE);
                                        setCoverageApplied(EMPTY_COVERAGE);
                                    }}
                                >
                                    Clear
                                </button>
                            </div>
                        </section>

                        {!surveyorPublicId ? (
                            <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">
                                Select a surveyor to load route coverage.
                            </div>
                        ) : null}

                        {surveyorPublicId && coverageQuery.isLoading ? (
                            <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">
                                Loading route coverage…
                            </div>
                        ) : null}

                        {surveyorPublicId && coverageQuery.isError ? (
                            <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
                                {offline
                                    ? "You appear offline. Reconnect, then refresh."
                                    : coverageQuery.error instanceof Error
                                      ? coverageQuery.error.message
                                      : "Could not load route coverage."}
                            </div>
                        ) : null}

                        {surveyorPublicId &&
                        coverageQuery.isSuccess &&
                        coverageQuery.data.items.length === 0 ? (
                            <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">
                                No active YBS variants match these filters.
                            </div>
                        ) : null}

                        {surveyorPublicId &&
                        coverageQuery.isSuccess &&
                        coverageQuery.data.items.length > 0 ? (
                            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                                <table className="min-w-full divide-y divide-gray-200 text-sm">
                                    <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        <tr>
                                            <th className="px-3 py-2">Route</th>
                                            <th className="px-3 py-2">Work status</th>
                                            <th className="px-3 py-2">Presence</th>
                                            <th className="px-3 py-2">Completion</th>
                                            <th className="px-3 py-2">Checked</th>
                                            <th className="px-3 py-2">Reports</th>
                                            <th className="px-3 py-2">Last surveyed</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {coverageQuery.data.items.map((item) => (
                                            <tr
                                                key={item.routeVariantPublicId}
                                                className="align-top"
                                            >
                                                <td className="px-3 py-2 text-gray-800">
                                                    {item.route.code} · {item.variantCode}
                                                </td>
                                                <td className="px-3 py-2">
                                                    <WorkStatusCell status={item.workStatus} />
                                                </td>
                                                <td className="px-3 py-2">
                                                    <PresenceCell status={item.presenceStatus} />
                                                </td>
                                                <td className="px-3 py-2">
                                                    <CompletionCell
                                                        status={item.completionStatus}
                                                    />
                                                </td>
                                                <td className="px-3 py-2 text-gray-700">
                                                    {item.checkedLabel}
                                                </td>
                                                <td className="px-3 py-2 text-gray-700">
                                                    {item.variantReportCount === 0
                                                        ? "No reports"
                                                        : item.variantReportCount === 1
                                                          ? "1 report"
                                                          : `${item.variantReportCount} reports`}
                                                </td>
                                                <td className="px-3 py-2 text-gray-700">
                                                    {formatDateTime(item.lastSurveyedAt)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : null}
                    </>
                ) : null}
            </div>

            {timelineSessionId ? (
                <TimelineDrawer
                    sessionPublicId={timelineSessionId}
                    onClose={() => setTimelineSessionId(null)}
                />
            ) : null}
        </main>
    );
}

function WorkHistoryTable({
    items,
    onOpenTimeline,
}: {
    items: SurveyWorkHistoryItem[];
    onOpenTimeline: (sessionPublicId: string) => void;
}) {
    return (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                        <th className="px-3 py-2">Route</th>
                        <th className="px-3 py-2">Started–ended</th>
                        <th className="px-3 py-2">Active</th>
                        <th className="px-3 py-2">Checked</th>
                        <th className="px-3 py-2">Reports</th>
                        <th className="px-3 py-2">Session</th>
                        <th className="px-3 py-2">Presence</th>
                        <th className="px-3 py-2">Details</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {items.map((item) => (
                        <tr key={item.sessionPublicId} className="align-top">
                            <td className="px-3 py-2 text-gray-800">
                                {item.route.code} · {item.variantCode}
                            </td>
                            <td className="px-3 py-2 text-gray-700">
                                <div>{formatDateTime(item.startedAt)}</div>
                                <div className="text-xs text-gray-500">
                                    → {formatDateTime(item.endedAt)}
                                </div>
                            </td>
                            <td className="px-3 py-2 text-gray-700">
                                {formatActiveDuration(item.activeDurationSeconds)}
                            </td>
                            <td className="px-3 py-2 text-gray-700">{item.checkedLabel}</td>
                            <td className="px-3 py-2 text-gray-700">{item.reportCountLabel}</td>
                            <td className="px-3 py-2 text-gray-700">{item.sessionStatus}</td>
                            <td className="px-3 py-2">
                                <PresenceCell status={item.presenceStatus} />
                            </td>
                            <td className="px-3 py-2">
                                <button
                                    type="button"
                                    className="text-sm font-medium text-gray-900 underline-offset-2 hover:underline"
                                    onClick={() => onOpenTimeline(item.sessionPublicId)}
                                >
                                    Details
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
