"use client";

import type { BoundaryCheckRow, BoundaryCheckSeverity } from "./types";

function severityClass(severity: BoundaryCheckSeverity): string {
    if (severity === "fail") {
        return "border-red-200 bg-red-50 text-red-900";
    }
    if (severity === "warning") {
        return "border-amber-200 bg-amber-50 text-amber-950";
    }
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
}

function severityLabel(severity: BoundaryCheckSeverity): string {
    if (severity === "fail") return "Fail";
    if (severity === "warning") return "Warning";
    return "Pass";
}

export type BoundaryCheckPanelProps = {
    checks: BoundaryCheckRow[] | null;
    busy?: boolean;
    error?: string | null;
    onHighlightIssues?: () => void;
    highlightActive?: boolean;
};

export default function BoundaryCheckPanel({
    checks,
    busy = false,
    error = null,
    onHighlightIssues,
    highlightActive = false,
}: BoundaryCheckPanelProps) {
    if (busy) {
        return (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Running boundary check…
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {error}
            </div>
        );
    }

    if (!checks || checks.length === 0) {
        return (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Boundary check — run Check geometry to validate the draft without saving.
            </div>
        );
    }

    return (
        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Boundary check
                </h4>
                {onHighlightIssues ? (
                    <button
                        type="button"
                        onClick={onHighlightIssues}
                        className={`rounded border px-2 py-0.5 text-[10px] font-medium ${
                            highlightActive
                                ? "border-red-300 bg-red-50 text-red-900"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                    >
                        {highlightActive ? "Hide issues" : "Highlight issues"}
                    </button>
                ) : null}
            </div>
            <ul className="space-y-1.5">
                {checks.map((row) => (
                    <li
                        key={row.id}
                        className={`rounded border px-2 py-1.5 text-xs ${severityClass(row.severity)}`}
                    >
                        <span className="font-semibold">{severityLabel(row.severity)}</span>
                        <span className="mx-1 text-slate-400">·</span>
                        <span>{row.message}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
