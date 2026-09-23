"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";
import {
    TerraDraw,
    TerraDrawPolygonMode,
    TerraDrawSelectMode,
    ValidateNotSelfIntersecting,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";

import { patchAdminGeographyGeometry } from "./api";
import type { AdminGeographyDetail } from "./types";

type PolygonLike = {
    type: "Polygon" | "MultiPolygon";
    coordinates: unknown;
};

type PolygonCoords = number[][][];

/** Split Polygon / MultiPolygon into individual Polygon rings for Terra Draw. */
function toEditableParts(geometry: unknown): PolygonCoords[] {
    if (!geometry || typeof geometry !== "object") return [];
    const g = geometry as { type?: string; coordinates?: unknown };
    if (g.type === "Polygon" && Array.isArray(g.coordinates)) {
        return [g.coordinates as PolygonCoords];
    }
    if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
        return (g.coordinates as PolygonCoords[]).filter(
            (part) => Array.isArray(part) && part.length > 0,
        );
    }
    return [];
}

function snapshotPolygon(draw: TerraDraw): PolygonLike | null {
    const features = draw.getSnapshot().filter((f) => f.geometry.type === "Polygon");
    if (features.length === 0) return null;
    if (features.length === 1) {
        return {
            type: "Polygon",
            coordinates: features[0]!.geometry.coordinates,
        };
    }
    return {
        type: "MultiPolygon",
        coordinates: features.map((f) => f.geometry.coordinates),
    };
}

export type AdminGeographyGeometryEditorProps = {
    detail: AdminGeographyDetail;
    map: MaplibreMap | null;
    onCancel: () => void;
    /** When set, Keep draft only updates local draft — does not PATCH the API. */
    onKeepDraft?: (geometry: PolygonLike) => void;
    /** Used when onKeepDraft is not provided (immediate API save). */
    onSaved?: () => void;
};

export default function AdminGeographyGeometryEditor({
    detail,
    map,
    onCancel,
    onKeepDraft,
    onSaved,
}: AdminGeographyGeometryEditorProps) {
    const drawRef = useRef<TerraDraw | null>(null);
    const polygonModeNameRef = useRef("polygon");
    const selectModeNameRef = useRef("select");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [issues, setIssues] = useState<string[]>([]);
    const [partCount, setPartCount] = useState(0);
    const [geometrySource, setGeometrySource] = useState<"coremap_manual" | "government" | "osm">(
        "coremap_manual",
    );
    const draftOnly = typeof onKeepDraft === "function";
    const isPlaceholder = detail.geometry_source === "mimu_placeholder";

    function refreshPartCount(draw: TerraDraw) {
        const count = draw.getSnapshot().filter((f) => f.geometry.type === "Polygon").length;
        setPartCount(count);
    }

    useEffect(() => {
        if (!map) return;

        const polygonMode = new TerraDrawPolygonMode({
            validation: (feature, { updateType }) => {
                if (updateType === "finish" || updateType === "commit") {
                    return ValidateNotSelfIntersecting(feature);
                }
                return { valid: true };
            },
        });
        const selectMode = new TerraDrawSelectMode({
            flags: {
                [polygonMode.mode]: {
                    feature: {
                        draggable: false,
                        coordinates: {
                            midpoints: true,
                            draggable: true,
                            deletable: true,
                        },
                    },
                },
            },
        });

        polygonModeNameRef.current = polygonMode.mode;
        selectModeNameRef.current = selectMode.mode;

        const draw = new TerraDraw({
            adapter: new TerraDrawMapLibreGLAdapter({ map }),
            modes: [selectMode, polygonMode],
        });
        draw.start();
        drawRef.current = draw;

        const onChange = () => refreshPartCount(draw);
        const onFinish = () => refreshPartCount(draw);
        draw.on("change", onChange);
        draw.on("finish", onFinish);

        const parts = toEditableParts(detail.geometry);
        if (parts.length > 0) {
            const results = draw.addFeatures(
                parts.map((coordinates) => ({
                    type: "Feature" as const,
                    properties: { mode: polygonMode.mode },
                    geometry: {
                        type: "Polygon" as const,
                        coordinates,
                    },
                })),
            );
            draw.setMode(selectMode.mode);
            const firstValid = results.find((r) => r.valid && r.id != null);
            if (firstValid?.id != null) {
                try {
                    draw.selectFeature(firstValid.id);
                } catch {
                    // Selection is best-effort.
                }
            }
            const invalid = results.filter((r) => !r.valid).length;
            if (invalid > 0) {
                setError(
                    `${invalid} part(s) failed to load. Draw replacements, then keep draft.`,
                );
            } else {
                setError(null);
            }
            refreshPartCount(draw);
        } else {
            draw.setMode(polygonMode.mode);
            setPartCount(0);
            setError("No polygon loaded — draw one or more parts, then keep draft.");
        }

        return () => {
            try {
                draw.off("change", onChange);
                draw.off("finish", onFinish);
                draw.stop();
            } catch {
                // ignore
            }
            drawRef.current = null;
        };
    }, [map, detail.id, detail.geometry]);

    function startAddPart() {
        const draw = drawRef.current;
        if (!draw) return;
        draw.setMode(polygonModeNameRef.current);
        setError(null);
        setIssues(["Draw the next polygon part. Click the first vertex again to finish."]);
    }

    function startSelectParts() {
        const draw = drawRef.current;
        if (!draw) return;
        draw.setMode(selectModeNameRef.current);
        setIssues([]);
    }

    async function onSave() {
        const draw = drawRef.current;
        if (!draw) return;
        setBusy(true);
        setError(null);
        setIssues([]);
        try {
            const geometry = snapshotPolygon(draw);
            if (!geometry) {
                setError("Draw or keep at least one polygon part before continuing.");
                return;
            }
            if (draftOnly) {
                onKeepDraft(geometry);
                return;
            }
            await patchAdminGeographyGeometry(detail.id, {
                geometry: {
                    type: geometry.type,
                    coordinates: geometry.coordinates,
                },
                expected_updated_at: detail.updated_at,
                geometry_source: geometrySource,
            });
            onSaved?.();
        } catch (err) {
            const message = err instanceof Error ? err.message : "Save failed";
            setError(message);
            if (/403|forbidden|read-only/i.test(message)) {
                setError("You do not have permission to edit geometry.");
            }
            if (/409|modified by another/i.test(message)) {
                setError("This area changed elsewhere. Cancel, reload, and try again.");
            }
            setIssues([message]);
        } finally {
            setBusy(false);
        }
    }

    function onValidateLocal() {
        const draw = drawRef.current;
        if (!draw) return;
        const geometry = snapshotPolygon(draw);
        if (!geometry) {
            setError("No polygon to validate.");
            setIssues(["Draw at least one closed polygon first."]);
            return;
        }
        setError(null);
        const parts =
            geometry.type === "MultiPolygon"
                ? (geometry.coordinates as unknown[]).length
                : 1;
        setIssues([
            `Local check: ${parts} part(s) as ${geometry.type}. Server will run ST_IsValid on apply.`,
        ]);
    }

    return (
        <div className="space-y-3 rounded-md border border-sky-200 bg-sky-50 p-3">
            <div>
                <h3 className="text-sm font-semibold text-sky-950">Edit geometry</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-sky-900">
                    Polygon or MultiPolygon. Drag vertices to move; midpoints add points; delete a
                    vertex to remove it. Use Add part for extra islands.
                    {draftOnly ? " Keep draft, then apply as owned below." : ""}
                </p>
                <p className="mt-1 text-[11px] text-sky-800">
                    Parts loaded: <span className="font-semibold tabular-nums">{partCount}</span>
                    {partCount > 1 ? " (MultiPolygon)" : partCount === 1 ? " (Polygon)" : ""}
                </p>
            </div>

            {!draftOnly && isPlaceholder ? (
                <label className="block text-xs font-medium text-sky-950">
                    Replacement source
                    <select
                        className="mt-1 w-full rounded-md border border-sky-300 bg-white px-2 py-1.5 text-sm"
                        value={geometrySource}
                        onChange={(e) =>
                            setGeometrySource(e.target.value as typeof geometrySource)
                        }
                    >
                        <option value="coremap_manual">coremap_manual</option>
                        <option value="government">government</option>
                        <option value="osm">osm</option>
                    </select>
                    <span className="mt-1 block text-[11px] font-normal text-sky-800">
                        Saves as needs_fix and removes MIMU placeholder status.
                    </span>
                </label>
            ) : null}

            {error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
                    {error}
                </div>
            ) : null}
            {issues.length > 0 && !error ? (
                <ul className="list-disc pl-4 text-xs text-sky-900">
                    {issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                    ))}
                </ul>
            ) : null}

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    className="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-sky-950 hover:bg-sky-100"
                    onClick={startAddPart}
                    disabled={busy}
                >
                    Add part
                </button>
                <button
                    type="button"
                    className="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-sky-950 hover:bg-sky-100"
                    onClick={startSelectParts}
                    disabled={busy}
                >
                    Select / edit
                </button>
                <button
                    type="button"
                    className="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-sky-950 hover:bg-sky-100"
                    onClick={onValidateLocal}
                    disabled={busy}
                >
                    Validate
                </button>
                <button
                    type="button"
                    className="rounded-md bg-sky-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-800 disabled:opacity-50"
                    onClick={() => void onSave()}
                    disabled={busy}
                >
                    {busy ? "Saving…" : draftOnly ? "Keep draft" : "Save"}
                </button>
                <button
                    type="button"
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    onClick={onCancel}
                    disabled={busy}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
