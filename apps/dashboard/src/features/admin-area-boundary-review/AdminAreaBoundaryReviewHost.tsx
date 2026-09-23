"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Geometry } from "geojson";
import type { Map as MaplibreMap, Popup } from "maplibre-gl";

import { getAdminAreaBoundaryContext, validateAdminAreaGeometry } from "./api";
import BoundaryCheckPanel from "./BoundaryCheckPanel";
import {
    bindNeighbourClickHandler,
    showNeighbourPopup,
    syncBoundaryReviewLayers,
    type BoundaryReviewNeighbourClick,
} from "./mapLayers";
import {
    adminAreaNameWarningMessage,
    DEFAULT_BOUNDARY_REVIEW_TOGGLES,
    type AdminAreaBoundaryContext,
    type AdminAreaValidateGeometryResult,
    type BoundaryReviewToggles,
} from "./types";
import BoundaryReviewControls from "./BoundaryReviewControls";

export type AdminAreaBoundaryReviewHostProps = {
    publicId: string | null;
    map: MaplibreMap | null;
    draftGeometry: Geometry | null;
    /** When true, warn before opening another record. */
    hasUnsavedEdits?: boolean;
    /** Navigate to neighbour — Core Review or Admin Geography. */
    onOpenNeighbour: (args: { publicId: string; numericId: string }) => void;
    /** Optional name for generic-name warning. */
    canonicalName?: string | null;
    /** Render header toggles outside (when false, only panel is shown). */
    showInlineControls?: boolean;
    toggles?: BoundaryReviewToggles;
    onTogglesChange?: (next: BoundaryReviewToggles) => void;
    /** Expose check handler for external Check geometry button. */
    checkGeometryRef?: React.MutableRefObject<(() => void) | null>;
};

export default function AdminAreaBoundaryReviewHost({
    publicId,
    map,
    draftGeometry,
    hasUnsavedEdits = false,
    onOpenNeighbour,
    canonicalName = null,
    showInlineControls = true,
    toggles: togglesProp,
    onTogglesChange,
    checkGeometryRef,
}: AdminAreaBoundaryReviewHostProps) {
    const [internalToggles, setInternalToggles] = useState(DEFAULT_BOUNDARY_REVIEW_TOGGLES);
    const toggles = togglesProp ?? internalToggles;
    const setToggles = onTogglesChange ?? setInternalToggles;

    const [context, setContext] = useState<AdminAreaBoundaryContext | null>(null);
    const [validation, setValidation] = useState<AdminAreaValidateGeometryResult | null>(null);
    const [checkBusy, setCheckBusy] = useState(false);
    const [checkError, setCheckError] = useState<string | null>(null);
    const [highlightIssues, setHighlightIssues] = useState(false);
    const [contextError, setContextError] = useState<string | null>(null);
    const popupRef = useRef<Popup | null>(null);

    useEffect(() => {
        if (!publicId) {
            setContext(null);
            return;
        }
        const controller = new AbortController();
        setContextError(null);
        void getAdminAreaBoundaryContext(publicId, { signal: controller.signal })
            .then((data) => {
                setContext(data);
            })
            .catch((err) => {
                if (controller.signal.aborted) return;
                setContext(null);
                setContextError(err instanceof Error ? err.message : "Failed to load boundary context");
            });
        return () => controller.abort();
    }, [publicId]);

    useEffect(() => {
        setValidation(null);
        setHighlightIssues(false);
        setCheckError(null);
    }, [publicId, draftGeometry]);

    useEffect(() => {
        if (!map) return;
        const run = () =>
            syncBoundaryReviewLayers({
                map,
                context,
                draftGeometry:
                    draftGeometry &&
                    (draftGeometry.type === "Polygon" || draftGeometry.type === "MultiPolygon")
                        ? draftGeometry
                        : null,
                toggles,
                issuesGeoJson: validation?.issues_geojson ?? null,
                highlightIssues,
            });
        if (map.isStyleLoaded()) {
            run();
        } else {
            map.once("load", run);
        }
    }, [map, context, draftGeometry, toggles, validation, highlightIssues]);

    const openNeighbour = useCallback(
        (payload: BoundaryReviewNeighbourClick) => {
            const proceed = () => {
                onOpenNeighbour({
                    publicId: payload.publicId,
                    numericId: payload.id,
                });
            };
            if (hasUnsavedEdits) {
                const ok = window.confirm(
                    "You have unsaved geometry edits. Open this neighbour and discard the draft?",
                );
                if (!ok) return;
            }
            proceed();
        },
        [hasUnsavedEdits, onOpenNeighbour],
    );

    useEffect(() => {
        if (!map) return;
        const unbind = bindNeighbourClickHandler(map, (payload) => {
            popupRef.current?.remove();
            popupRef.current = showNeighbourPopup(map, payload, () => openNeighbour(payload));
        });
        return () => {
            unbind();
            popupRef.current?.remove();
            popupRef.current = null;
        };
    }, [map, openNeighbour]);

    const runCheck = useCallback(async () => {
        if (!publicId) return;
        const geom = draftGeometry ?? context?.selected.geometry ?? null;
        if (
            !geom ||
            (geom.type !== "Polygon" && geom.type !== "MultiPolygon")
        ) {
            setCheckError("Draw or load a polygon before checking geometry.");
            return;
        }
        setCheckBusy(true);
        setCheckError(null);
        try {
            const result = await validateAdminAreaGeometry(publicId, {
                type: geom.type,
                coordinates: geom.coordinates,
            });
            setValidation(result);
            setHighlightIssues(true);
        } catch (err) {
            setValidation(null);
            setCheckError(err instanceof Error ? err.message : "Boundary check failed");
        } finally {
            setCheckBusy(false);
        }
    }, [publicId, draftGeometry, context]);

    useEffect(() => {
        if (checkGeometryRef) {
            checkGeometryRef.current = () => {
                void runCheck();
            };
        }
        return () => {
            if (checkGeometryRef) {
                checkGeometryRef.current = null;
            }
        };
    }, [checkGeometryRef, runCheck]);

    const nameWarning = adminAreaNameWarningMessage(
        canonicalName ?? context?.selected.display_name ?? null,
    );

    return (
        <div className="space-y-2">
            {showInlineControls ? (
                <BoundaryReviewControls
                    toggles={toggles}
                    onTogglesChange={setToggles}
                    onCheckGeometry={() => void runCheck()}
                    checkBusy={checkBusy}
                />
            ) : null}
            {contextError ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
                    Context: {contextError}
                </div>
            ) : null}
            {nameWarning ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
                    {nameWarning}
                </div>
            ) : null}
            {context?.meta.neighbour_truncated ? (
                <div className="text-[10px] text-slate-500">
                    Neighbour list truncated to {context.meta.neighbour_limit} (local bbox only).
                </div>
            ) : null}
            <BoundaryCheckPanel
                checks={validation?.checks ?? null}
                busy={checkBusy}
                error={checkError}
                highlightActive={highlightIssues}
                onHighlightIssues={() => setHighlightIssues((v) => !v)}
            />
        </div>
    );
}
