"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { Geometry } from "geojson";
import { useRouter } from "next/navigation";
import { Controller, type Control, useFormState, useWatch } from "react-hook-form";

import { CoreGeometryEditor, type CoreGeometryValidationResult } from "@/src/components/core-review/geometry";
import { mapEditorBtnSuccess } from "@/src/components/map/mapPreviewUi";
import AdminAreaBoundaryReviewHost from "@/src/features/admin-area-boundary-review/AdminAreaBoundaryReviewHost";
import BoundaryReviewControls from "@/src/features/admin-area-boundary-review/BoundaryReviewControls";
import {
    DEFAULT_BOUNDARY_REVIEW_TOGGLES,
    type BoundaryReviewToggles,
} from "@/src/features/admin-area-boundary-review/types";
import {
    ensureRoadClassSelected,
    prepareLocalStreetGeometryForSave,
} from "@/src/features/streets/streetSaveLocalChecks";
import { validateStreetGeometryForSave } from "@/src/features/streets/streetGeometrySaveValidation";
import type { ValidateStreetGeometryResponse } from "@/src/lib/api";
import { coreReviewPath } from "@/src/lib/dashboardPaths";
import type { CoreEntityGeometryConfig } from "@/src/lib/core-review/entityConfigs/types";
import { dashDevLog } from "@/src/lib/dashDevLog";

import type { StreetSplitMapProps } from "./StreetEditExtras";

function invalidGeometryValidation(message: string): ValidateStreetGeometryResponse {
    return {
        isValid: false,
        errors: [message],
        warnings: [],
        startConnection: null,
        endConnection: null,
        crossings: [],
        duplicates: [],
    };
}

export type CoreEntityGeometrySectionProps = {
    config: CoreEntityGeometryConfig;
    control: Control<Record<string, unknown>>;
    externalId?: string | null;
    selectedEntityName?: string | null;
    snapExcludePublicId?: string | null;
    disabled?: boolean;
    roadClassId?: string;
    onGeometryValidation?: (result: CoreGeometryValidationResult | null) => void;
    onApiValidation?: (result: ValidateStreetGeometryResponse | null) => void;
    streetSplitMapProps?: StreetSplitMapProps | null;
    mapSurfaceRef?: MutableRefObject<MaplibreMap | null>;
    /** Enable admin-area neighbour/parent boundary review overlays. */
    enableAdminAreaBoundaryReview?: boolean;
};

export default function CoreEntityGeometrySection({
    config,
    control,
    externalId,
    selectedEntityName,
    snapExcludePublicId,
    disabled,
    roadClassId,
    onGeometryValidation,
    onApiValidation,
    streetSplitMapProps,
    mapSurfaceRef,
    enableAdminAreaBoundaryReview = false,
}: CoreEntityGeometrySectionProps) {
    const router = useRouter();
    const [apiValidationBusy, setApiValidationBusy] = useState(false);
    const [mapInstance, setMapInstance] = useState<MaplibreMap | null>(null);
    const [toggles, setToggles] = useState<BoundaryReviewToggles>(DEFAULT_BOUNDARY_REVIEW_TOGGLES);
    const checkRef = useRef<(() => void) | null>(null);
    const localMapRef = useRef<MaplibreMap | null>(null);
    const combinedMapRef = mapSurfaceRef ?? localMapRef;

    const geometryValue = useWatch({ control, name: config.fieldKey }) as Geometry | null | undefined;
    const canonicalName = useWatch({ control, name: "canonical_name" }) as string | undefined;
    const { isDirty } = useFormState({ control });

    useEffect(() => {
        if (!enableAdminAreaBoundaryReview) return;
        const tick = window.setInterval(() => {
            const next = combinedMapRef.current;
            setMapInstance((prev) => (prev === next ? prev : next));
        }, 400);
        return () => window.clearInterval(tick);
    }, [combinedMapRef, enableAdminAreaBoundaryReview]);

    const handleValidateGeometry = useCallback(
        async (geometry: Geometry | null) => {
            if (!config.validateWithApi || !geometry || geometry.type !== "LineString") {
                onApiValidation?.(null);
                return true;
            }

            const local = prepareLocalStreetGeometryForSave(
                geometry as { type: "LineString"; coordinates: number[][] },
            );
            if (!local.ok) {
                onApiValidation?.(invalidGeometryValidation(local.message));
                return false;
            }

            const roadClass = ensureRoadClassSelected(roadClassId);
            if (!roadClass) {
                onApiValidation?.(invalidGeometryValidation("Select a road class before validating geometry."));
                return false;
            }

            setApiValidationBusy(true);
            try {
                const result = await validateStreetGeometryForSave({
                    geometry: local.sanitized,
                    ...(snapExcludePublicId ? { streetId: snapExcludePublicId } : {}),
                });
                onApiValidation?.(result);
                dashDevLog("street:form:validate-geometry", result);
                return result.isValid && result.errors.length === 0;
            } catch (err) {
                onApiValidation?.(
                    invalidGeometryValidation(
                        err instanceof Error ? err.message : "Geometry validation failed",
                    ),
                );
                return false;
            } finally {
                setApiValidationBusy(false);
            }
        },
        [config.validateWithApi, onApiValidation, roadClassId, snapExcludePublicId],
    );

    const boundaryControls = enableAdminAreaBoundaryReview ? (
        <BoundaryReviewControls
            toggles={toggles}
            onTogglesChange={setToggles}
            onCheckGeometry={() => checkRef.current?.()}
            palette="core"
        />
    ) : null;

    return (
        <Controller
            name={config.fieldKey}
            control={control}
            render={({ field }) => (
                <div className="space-y-2">
                    <CoreGeometryEditor
                        geometryType={config.geometryType}
                        value={(field.value as Geometry | null) ?? null}
                        onChange={field.onChange}
                        readonly={disabled}
                        showVertices={config.showVertices}
                        enableSnapping={config.enableSnapping}
                        fitOnLoad
                        title={config.title}
                        externalId={externalId}
                        snapExcludePublicId={snapExcludePublicId}
                        selectedEntityPublicId={externalId}
                        selectedEntityName={selectedEntityName}
                        onValidationResult={onGeometryValidation}
                        splitPickActive={streetSplitMapProps?.splitPickActive}
                        onSplitPointClicked={streetSplitMapProps?.onSplitPointClicked}
                        splitPreviewLngLat={streetSplitMapProps?.splitPreviewLngLat}
                        basemapOnly={config.basemapOnly}
                        autoEnterVertexEdit={config.autoEnterVertexEdit}
                        mapSurfaceRef={combinedMapRef}
                        headerTrailingControls={boundaryControls}
                        footerExtra={
                            enableAdminAreaBoundaryReview && externalId ? (
                                <AdminAreaBoundaryReviewHost
                                    publicId={externalId}
                                    map={mapInstance}
                                    draftGeometry={(field.value as Geometry | null) ?? null}
                                    hasUnsavedEdits={isDirty}
                                    canonicalName={canonicalName ?? selectedEntityName ?? null}
                                    showInlineControls={false}
                                    toggles={toggles}
                                    onTogglesChange={setToggles}
                                    checkGeometryRef={checkRef}
                                    onOpenNeighbour={({ publicId }) => {
                                        router.push(coreReviewPath(`admin-areas/${publicId}/edit`));
                                    }}
                                />
                            ) : null
                        }
                    />
                    {config.validateWithApi ? (
                        <button
                            type="button"
                            disabled={disabled || apiValidationBusy}
                            onClick={() =>
                                void handleValidateGeometry((field.value as Geometry | null) ?? null)
                            }
                            className={`${mapEditorBtnSuccess()} disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                            {apiValidationBusy ? "Validating…" : "Validate geometry"}
                        </button>
                    ) : null}
                </div>
            )}
        />
    );
}
