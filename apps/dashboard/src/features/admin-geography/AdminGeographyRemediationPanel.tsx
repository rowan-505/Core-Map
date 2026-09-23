"use client";

import { useMemo, useState } from "react";

import { patchAdminGeographyRemediation } from "./api";
import type {
    AdminGeographyDetail,
    RemediationEvidence,
    RemediationEvidenceItem,
} from "./types";

const INPUT =
    "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900";

const EVIDENCE_TYPES = [
    "survey_report",
    "field_photo",
    "government_doc",
    "map_reference",
    "interview_note",
    "other",
] as const;

function emptyItem(): RemediationEvidenceItem {
    return {
        type: "survey_report",
        value: "",
        label: "",
        note: "",
        captured_at: new Date().toISOString(),
        storage_path: "",
        sha256: "",
    };
}

function asPolygonGeometry(raw: unknown): {
    type: "Polygon" | "MultiPolygon";
    coordinates: unknown;
} | null {
    if (!raw || typeof raw !== "object") return null;
    const g = raw as { type?: string; coordinates?: unknown };
    if ((g.type === "Polygon" || g.type === "MultiPolygon") && g.coordinates != null) {
        return { type: g.type, coordinates: g.coordinates };
    }
    return null;
}

export type AdminGeographyRemediationPanelProps = {
    detail: AdminGeographyDetail;
    draftGeometry: {
        type: "Polygon" | "MultiPolygon";
        coordinates: unknown;
    } | null;
    onResetDraft: () => void;
    onSaved: () => void;
};

export default function AdminGeographyRemediationPanel({
    detail,
    draftGeometry,
    onResetDraft,
    onSaved,
}: AdminGeographyRemediationPanelProps) {
    const [geometrySource, setGeometrySource] = useState<"coremap_manual" | "government" | "osm">(
        "coremap_manual",
    );
    const [approximate, setApproximate] = useState(false);
    const [note, setNote] = useState(detail.verification_note ?? "");
    const [items, setItems] = useState<RemediationEvidenceItem[]>(() => {
        const existing = detail.evidence?.items;
        return existing && existing.length > 0 ? existing.map((item) => ({ ...item })) : [];
    });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const geometryForApply = draftGeometry ?? asPolygonGeometry(detail.geometry);

    const evidencePayload: RemediationEvidence = useMemo(() => {
        const cleaned = items
            .map((item) => ({
                type: item.type.trim(),
                value: item.value.trim(),
                label: item.label.trim(),
                note: item.note?.trim() ? item.note.trim() : null,
                captured_at: item.captured_at,
                storage_path: item.storage_path?.trim() ? item.storage_path.trim() : null,
                sha256: item.sha256?.trim() ? item.sha256.trim() : null,
            }))
            .filter((item) => item.type && item.value && item.label);
        return { items: cleaned };
    }, [items]);

    async function applyAsOwned() {
        if (!geometryForApply) {
            setError("Edit or keep a polygon first, then apply.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await patchAdminGeographyRemediation(detail.id, {
                expected_updated_at: detail.updated_at,
                decision: approximate ? "approximate" : "replace_source",
                geometry: geometryForApply,
                geometry_source: geometrySource,
                evidence: evidencePayload,
                verification_note: note.trim() ? note.trim() : null,
            });
            onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Apply failed");
        } finally {
            setBusy(false);
        }
    }

    async function rejectArea() {
        const ok = window.confirm(
            `Reject “${detail.canonical_name}”? This deactivates the area and keeps it non-public.`,
        );
        if (!ok) return;
        setBusy(true);
        setError(null);
        try {
            await patchAdminGeographyRemediation(detail.id, {
                expected_updated_at: detail.updated_at,
                decision: "reject",
                evidence: evidencePayload,
                verification_note: note.trim() ? note.trim() : null,
            });
            onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Reject failed");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-4 rounded-md border border-amber-200 bg-amber-50 p-3">
            <div>
                <h3 className="text-sm font-semibold text-amber-950">Make owned</h3>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs leading-relaxed text-amber-900">
                    <li>Edit geometry (or keep the current polygon).</li>
                    <li>Add evidence if you have it (optional).</li>
                    <li>Click Apply as owned.</li>
                </ol>
                <p className="mt-1.5 text-[11px] text-amber-800">
                    This removes MIMU placeholder status. The area stays non-public until a later
                    production approval.
                </p>
            </div>

            <div className="rounded-md border border-amber-200 bg-white p-2.5 text-xs text-slate-700">
                <div className="font-medium text-slate-900">Geometry</div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    {draftGeometry
                        ? `Draft ready (${draftGeometry.type}).`
                        : geometryForApply
                          ? `Using current polygon (${geometryForApply.type}). Edit above if you need changes.`
                          : "No polygon yet — edit geometry first."}
                </p>
                {draftGeometry ? (
                    <button
                        type="button"
                        className="mt-2 rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        onClick={onResetDraft}
                        disabled={busy}
                    >
                        Reset draft to saved shape
                    </button>
                ) : null}
            </div>

            <label className="block text-xs font-medium text-amber-950">
                Owned source
                <select
                    className={`${INPUT} mt-1`}
                    value={geometrySource}
                    onChange={(e) => setGeometrySource(e.target.value as typeof geometrySource)}
                    disabled={busy}
                >
                    <option value="coremap_manual">coremap_manual</option>
                    <option value="government">government</option>
                    <option value="osm">osm</option>
                </select>
            </label>

            <label className="flex cursor-pointer items-start gap-2 text-xs text-amber-950">
                <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={approximate}
                    onChange={(e) => setApproximate(e.target.checked)}
                    disabled={busy}
                />
                <span>
                    <span className="font-medium">Boundary is approximate</span>
                    <span className="mt-0.5 block text-[11px] text-amber-800">
                        Optional. Marks the owned boundary as approximate.
                    </span>
                </span>
            </label>

            <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                        Evidence (optional)
                    </div>
                    <button
                        type="button"
                        className="shrink-0 text-[11px] font-medium text-sky-800 hover:underline"
                        onClick={() => setItems((prev) => [...prev, emptyItem()])}
                        disabled={busy}
                    >
                        Add item
                    </button>
                </div>
                <p className="text-[11px] leading-relaxed text-amber-900">
                    Add item → type, label, value. Optional note / private storage_path / sha256.
                </p>
                {items.length === 0 ? (
                    <p className="rounded-md border border-dashed border-amber-300 bg-white px-2.5 py-3 text-xs text-slate-500">
                        No evidence yet — skip if you do not have proof.
                    </p>
                ) : (
                    <ul className="space-y-2.5">
                        {items.map((item, index) => (
                            <li
                                key={`${item.captured_at}-${index}`}
                                className="space-y-2 rounded-md border border-slate-200 bg-white p-2.5"
                            >
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <label className="block text-[11px] font-medium text-slate-600">
                                        Type
                                        <select
                                            className={`${INPUT} mt-0.5`}
                                            value={item.type}
                                            onChange={(e) =>
                                                setItems((prev) =>
                                                    prev.map((row, i) =>
                                                        i === index
                                                            ? { ...row, type: e.target.value }
                                                            : row,
                                                    ),
                                                )
                                            }
                                        >
                                            {EVIDENCE_TYPES.map((t) => (
                                                <option key={t} value={t}>
                                                    {t}
                                                </option>
                                            ))}
                                            {!EVIDENCE_TYPES.includes(
                                                item.type as (typeof EVIDENCE_TYPES)[number],
                                            ) ? (
                                                <option value={item.type}>{item.type}</option>
                                            ) : null}
                                        </select>
                                    </label>
                                    <label className="block text-[11px] font-medium text-slate-600">
                                        Label
                                        <input
                                            className={`${INPUT} mt-0.5`}
                                            placeholder="e.g. Kyauktan field check"
                                            value={item.label}
                                            onChange={(e) =>
                                                setItems((prev) =>
                                                    prev.map((row, i) =>
                                                        i === index
                                                            ? { ...row, label: e.target.value }
                                                            : row,
                                                    ),
                                                )
                                            }
                                        />
                                    </label>
                                </div>
                                <label className="block text-[11px] font-medium text-slate-600">
                                    Value
                                    <input
                                        className={`${INPUT} mt-0.5`}
                                        placeholder="Report id, URL, or file reference"
                                        value={item.value}
                                        onChange={(e) =>
                                            setItems((prev) =>
                                                prev.map((row, i) =>
                                                    i === index
                                                        ? { ...row, value: e.target.value }
                                                        : row,
                                                ),
                                            )
                                        }
                                    />
                                </label>
                                <label className="block text-[11px] font-medium text-slate-600">
                                    Note (optional)
                                    <input
                                        className={`${INPUT} mt-0.5`}
                                        value={item.note ?? ""}
                                        onChange={(e) =>
                                            setItems((prev) =>
                                                prev.map((row, i) =>
                                                    i === index
                                                        ? { ...row, note: e.target.value }
                                                        : row,
                                                ),
                                            )
                                        }
                                    />
                                </label>
                                <label className="block text-[11px] font-medium text-slate-600">
                                    Private storage_path (optional)
                                    <input
                                        className={`${INPUT} mt-0.5`}
                                        value={item.storage_path ?? ""}
                                        onChange={(e) =>
                                            setItems((prev) =>
                                                prev.map((row, i) =>
                                                    i === index
                                                        ? { ...row, storage_path: e.target.value }
                                                        : row,
                                                ),
                                            )
                                        }
                                    />
                                </label>
                                <label className="block text-[11px] font-medium text-slate-600">
                                    Sha256 (optional)
                                    <input
                                        className={`${INPUT} mt-0.5`}
                                        value={item.sha256 ?? ""}
                                        onChange={(e) =>
                                            setItems((prev) =>
                                                prev.map((row, i) =>
                                                    i === index
                                                        ? { ...row, sha256: e.target.value }
                                                        : row,
                                                ),
                                            )
                                        }
                                    />
                                </label>
                                <button
                                    type="button"
                                    className="text-[11px] text-red-700 hover:underline"
                                    onClick={() =>
                                        setItems((prev) => prev.filter((_, i) => i !== index))
                                    }
                                >
                                    Remove
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <label className="block text-xs font-medium text-amber-950">
                Note (optional)
                <textarea
                    className={`${INPUT} mt-1 min-h-[3.5rem]`}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Short reason or context"
                />
            </label>

            {error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
                    {error}
                </div>
            ) : null}

            <button
                type="button"
                className="w-full rounded-md bg-amber-900 px-3 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
                onClick={() => void applyAsOwned()}
                disabled={busy || !geometryForApply}
            >
                {busy ? "Saving…" : "Apply as owned"}
            </button>

            <button
                type="button"
                className="w-full text-center text-[11px] text-red-700 hover:underline disabled:opacity-50"
                onClick={() => void rejectArea()}
                disabled={busy}
            >
                Reject this area instead
            </button>
        </div>
    );
}
