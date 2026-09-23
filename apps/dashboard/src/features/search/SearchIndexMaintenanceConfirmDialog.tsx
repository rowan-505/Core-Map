"use client";

import { useEffect, useState } from "react";

import { PRIMARY_BTN, SECONDARY_BTN } from "./ui";

export type SearchIndexRepairProgress = {
    percent: number;
    etaSeconds: number | null;
    currentFamily: string | null;
    finished: string[];
    remaining: string[];
    phase: "confirm" | "health_check" | "rebuilding" | "verification" | "done";
    stageStartedAtMs: number;
    lastDurationMs: number | null;
    rowsRebuiltTotal: number;
};

function formatEta(seconds: number | null): string {
    if (seconds == null || !Number.isFinite(seconds)) return "—";
    if (seconds < 1) return "<1s";
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.ceil(seconds % 60);
    return `${m}m ${s}s`;
}

export default function SearchIndexMaintenanceConfirmDialog({
    title,
    description,
    confirmLabel,
    saving,
    error,
    confirmed,
    onConfirmedChange,
    progress,
    onClose,
    onConfirm,
}: {
    title: string;
    description: string;
    confirmLabel: string;
    saving: boolean;
    error: string;
    confirmed: boolean;
    onConfirmedChange: (value: boolean) => void;
    progress: SearchIndexRepairProgress | null;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
}) {
    const showProgress = saving && progress != null && progress.phase !== "confirm";
    const [nowMs, setNowMs] = useState(() => Date.now());

    useEffect(() => {
        if (!showProgress) return;
        setNowMs(Date.now());
        const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [showProgress, progress?.stageStartedAtMs]);

    const elapsedSeconds = progress
        ? Math.max(0, Math.floor((nowMs - progress.stageStartedAtMs) / 1_000))
        : 0;
    const liveEtaSeconds =
        progress?.etaSeconds == null
            ? null
            : Math.max(0, progress.etaSeconds - elapsedSeconds);

    const stageLabel =
        progress?.phase === "health_check"
            ? "Checking exact index health…"
            : progress?.phase === "verification"
              ? "Verifying repaired index…"
              : progress?.phase === "done"
                ? "Finished"
                : `Rebuilding ${progress?.currentFamily ?? "…"}`;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
            <button
                type="button"
                className="absolute inset-0 cursor-default"
                aria-label="Close dialog"
                onClick={saving ? undefined : onClose}
                disabled={saving}
            />
            <div className="relative z-10 w-full max-w-lg rounded-lg border border-gray-200 bg-white shadow-xl">
                <div className="border-b border-gray-200 px-5 py-4">
                    <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
                    <p className="mt-1 text-sm text-gray-600">{description}</p>
                </div>

                <form
                    className="space-y-4 px-5 py-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (!confirmed || saving) return;
                        void onConfirm();
                    }}
                >
                    {!showProgress ? (
                        <label className="flex items-start gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={confirmed}
                                onChange={(e) => onConfirmedChange(e.target.checked)}
                                className="mt-1"
                                disabled={saving}
                            />
                            <span>
                                I understand this is a heavy search index operation and may take
                                several minutes. Families rebuild one at a time with live progress.
                            </span>
                        </label>
                    ) : null}

                    {showProgress && progress ? (
                        <div className="space-y-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">{stageLabel}</span>
                                <span className="tabular-nums font-semibold">
                                    {progress.percent}%
                                </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-sky-100">
                                <div
                                    className={`h-full rounded-full bg-sky-700 transition-[width] duration-300 ${
                                        progress.phase === "done" ? "" : "animate-pulse"
                                    }`}
                                    style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
                                />
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-sky-900">
                                <span>
                                    Estimated remaining:{" "}
                                    <span className="font-medium tabular-nums">
                                        {formatEta(liveEtaSeconds)}
                                    </span>
                                </span>
                                <span>
                                    Stage elapsed:{" "}
                                    <span className="font-medium tabular-nums">
                                        {formatEta(elapsedSeconds)}
                                    </span>
                                </span>
                                <span>
                                    Rows this run:{" "}
                                    <span className="font-medium tabular-nums">
                                        {progress.rowsRebuiltTotal.toLocaleString()}
                                    </span>
                                </span>
                                {progress.lastDurationMs != null ? (
                                    <span>
                                        Last family:{" "}
                                        <span className="font-medium tabular-nums">
                                            {Math.round(progress.lastDurationMs / 1000)}s
                                        </span>
                                    </span>
                                ) : null}
                            </div>
                            <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
                                <div>
                                    <div className="font-semibold uppercase tracking-wide text-sky-800">
                                        Done ({progress.finished.length})
                                    </div>
                                    <ul className="mt-0.5 max-h-24 space-y-0.5 overflow-y-auto text-sky-900">
                                        {progress.finished.length === 0 ? (
                                            <li className="text-sky-700/70">—</li>
                                        ) : (
                                            progress.finished.map((f) => <li key={f}>{f}</li>)
                                        )}
                                    </ul>
                                </div>
                                <div>
                                    <div className="font-semibold uppercase tracking-wide text-sky-800">
                                        Current
                                    </div>
                                    <p className="mt-0.5 font-medium">
                                        {progress.phase === "health_check"
                                            ? "exact health check"
                                            : progress.phase === "verification"
                                              ? "final verification"
                                            : (progress.currentFamily ?? "—")}
                                    </p>
                                </div>
                                <div>
                                    <div className="font-semibold uppercase tracking-wide text-sky-800">
                                        Remaining ({progress.remaining.length})
                                    </div>
                                    <ul className="mt-0.5 max-h-24 space-y-0.5 overflow-y-auto text-sky-900">
                                        {progress.remaining.length === 0 ? (
                                            <li className="text-sky-700/70">—</li>
                                        ) : (
                                            progress.remaining.map((f) => <li key={f}>{f}</li>)
                                        )}
                                    </ul>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {error ? (
                        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                            {error}
                        </div>
                    ) : null}

                    <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
                        <button
                            type="button"
                            className={SECONDARY_BTN}
                            onClick={onClose}
                            disabled={saving}
                        >
                            {saving ? "Please wait…" : "Cancel"}
                        </button>
                        <button
                            type="submit"
                            className={PRIMARY_BTN}
                            disabled={saving || !confirmed}
                        >
                            {saving
                                ? progress?.phase === "health_check"
                                    ? "Checking health…"
                                    : progress?.phase === "verification"
                                      ? "Verifying…"
                                    : `Running… ${progress?.percent ?? 0}%`
                                : confirmLabel}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
