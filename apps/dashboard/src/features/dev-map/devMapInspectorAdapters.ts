import { getBuilding, getCoreReviewDetail, getPlace, getStreet, isAbortError } from "@/src/lib/api";
import { localBasemapPath } from "@/src/lib/dashboardPaths";

import {
    fetchLocalBasemapFeature,
    type LocalBasemapFeatureDetail,
} from "@/src/features/local-basemap/localBasemapApi";
import {
    getTransportRouteDetail,
    getTransportStopDetail,
} from "@/src/features/transport/api";

import { getDevMapEntityEntry, type DevMapEntityType } from "./devMapEntityRegistry";
import { buildLifecycleCommandActions } from "./devMapInspectorLifecycle";
import {
    DevMapInspectorLoadError,
    type DevMapEntityAdapter,
    type DevMapInspectorAction,
    type DevMapInspectorDetail,
    type DevMapInspectorField,
    type DevMapInspectorLinkAction,
} from "./devMapInspectorTypes";
import type { DevMapSelection } from "./devMapSelection";
import { resolveDevMapDetailHref } from "./devMapSelection";

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

export function pickString(record: Record<string, unknown> | null, keys: string[]): string | null {
    if (!record) return null;
    for (const key of keys) {
        const value = record[key];
        if (value == null) continue;
        const text = String(value).trim();
        if (text.length > 0) return text;
    }
    return null;
}

export function formatInspectorValue(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value === "boolean") return value ? "yes" : "no";
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    const text = String(value).trim();
    return text.length > 0 ? text : null;
}

export function field(label: string, value: unknown): DevMapInspectorField | null {
    const formatted = formatInspectorValue(value);
    if (!formatted) return null;
    return { label, value: formatted };
}

export function compactFields(fields: Array<DevMapInspectorField | null>): DevMapInspectorField[] {
    return fields.filter((item): item is DevMapInspectorField => item != null);
}

export function isNotFoundError(error: unknown): boolean {
    if (error instanceof DevMapInspectorLoadError) {
        return error.code === "not_found";
    }
    const message = error instanceof Error ? error.message : String(error);
    return /\b404\b|not found|Feature not found/i.test(message);
}

/** True when local-basemap bridge is off or unreachable (not a stale tile). */
export function isLocalBasemapUnavailableError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
        /\b404\b/.test(message) && /local-basemap/i.test(message)
    ) || /Failed to fetch|NetworkError|ECONNREFUSED|local basemap/i.test(message);
}

function looksLikeUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

/** Prefer public UUID, then any non-empty entity/core id (numeric ids OK after API fix). */
function detailLookupId(selection: DevMapSelection): string | null {
    const candidates = [selection.corePublicId, selection.entityId, selection.coreId];
    for (const value of candidates) {
        if (value && String(value).trim()) {
            return String(value).trim();
        }
    }
    return null;
}

export function mapLoadError(error: unknown): DevMapInspectorLoadError {
    if (error instanceof DevMapInspectorLoadError) {
        return error;
    }
    if (isLocalBasemapUnavailableError(error)) {
        return new DevMapInspectorLoadError(
            "not_found",
            "Local Basemap API has no row for this feature (tiles DB off, or OSM-only public basemap feature).",
        );
    }
    if (isNotFoundError(error)) {
        return new DevMapInspectorLoadError(
            "not_found",
            "No matching row in the database (tile may be stale).",
        );
    }
    const message = error instanceof Error ? error.message : "Failed to load entity detail.";
    return new DevMapInspectorLoadError("fetch_failed", message);
}

function linkAction(id: string, label: string, href: string): DevMapInspectorLinkAction {
    return { kind: "link", id, label, href };
}

/** Open Details + Edit when the registry points at an existing edit route. */
export function navigationActions(selection: DevMapSelection): DevMapInspectorLinkAction[] {
    const href = resolveDevMapDetailHref(selection);
    if (!href) return [];
    const actions: DevMapInspectorLinkAction[] = [
        linkAction("open-details", "Open Details", href),
    ];
    if (href.includes("/edit")) {
        actions.push(linkAction("edit", "Edit", href));
    }
    return actions;
}

function baseDetail(
    selection: DevMapSelection,
    partial: Omit<
        DevMapInspectorDetail,
        | "entityType"
        | "badgeLabel"
        | "featureKey"
        | "detailHref"
        | "actions"
        | "fallbackNote"
        | "lifecycleEntity"
    > &
        Partial<
            Pick<
                DevMapInspectorDetail,
                "featureKey" | "detailHref" | "actions" | "fallbackNote" | "lifecycleEntity"
            >
        >,
): DevMapInspectorDetail {
    const entry = getDevMapEntityEntry(selection.entityType);
    const detailHref = partial.detailHref ?? resolveDevMapDetailHref(selection);
    const actions = partial.actions ?? navigationActions(selection);
    return {
        entityType: selection.entityType,
        badgeLabel: entry.label,
        displayName: partial.displayName,
        stableId: partial.stableId,
        featureKey: partial.featureKey ?? selection.featureKey,
        lifecycleState: partial.lifecycleState,
        sourceLabel: partial.sourceLabel,
        fields: partial.fields,
        actions,
        detailHref,
        fallbackNote: partial.fallbackNote ?? null,
        lifecycleEntity: partial.lifecycleEntity ?? null,
    };
}

function tilePropsFallback(
    selection: DevMapSelection,
    note: string,
    extraActions: DevMapInspectorLinkAction[] = [],
): DevMapInspectorDetail {
    const nav = navigationActions(selection);
    const actions = [...nav, ...extraActions];
    return baseDetail(selection, {
        displayName: selection.displayName,
        stableId: selection.entityId,
        lifecycleState: null,
        sourceLabel: selection.sourceLayer || null,
        fields: compactFields([
            field("Entity id", selection.entityId),
            field("Feature key", selection.featureKey),
            field("Core id", selection.coreId),
            field("Public id", selection.corePublicId),
            field("Source layer", selection.sourceLayer),
        ]),
        actions,
        fallbackNote: note,
    });
}

function localBasemapFallbackLink(): DevMapInspectorLinkAction {
    return linkAction("local-basemap", "Open Local Basemap", localBasemapPath());
}

/** Prefer dedicated name columns, then language entries in `names`. */
function streetDisplayNames(record: Record<string, unknown>): {
    displayName: string | null;
    myanmarName: string | null;
    englishName: string | null;
} {
    const names = Array.isArray(record.names) ? record.names : [];
    let fromMy: string | null = null;
    let fromEn: string | null = null;
    for (const entry of names) {
        const row = asRecord(entry);
        if (!row) continue;
        const name = pickString(row, ["name"]);
        if (!name) continue;
        const lang = (pickString(row, ["language_code", "languageCode"]) ?? "").toLowerCase();
        const script = (pickString(row, ["script_code", "scriptCode"]) ?? "").toUpperCase();
        if (!fromMy && (lang === "my" || script === "MYMR")) {
            fromMy = name;
        }
        if (!fromEn && (lang === "en" || script === "LATN")) {
            fromEn = name;
        }
    }
    const myanmarName = pickString(record, ["myanmarName", "name_mm", "nameMm"]) ?? fromMy;
    const englishName = pickString(record, ["englishName", "name_en", "nameEn"]) ?? fromEn;
    const displayName =
        pickString(record, ["canonical_name", "canonicalName", "name"]) ??
        englishName ??
        myanmarName ??
        fromEn ??
        fromMy;
    return { displayName, myanmarName, englishName };
}

function lifecycleNavAndCommands(
    selection: DevMapSelection,
    detail: LocalBasemapFeatureDetail,
): DevMapInspectorAction[] {
    const href = resolveDevMapDetailHref({
        ...selection,
        featureKey: detail.feature_key,
        coreId: detail.core_id,
        corePublicId: detail.core_public_id,
    });
    const actions: DevMapInspectorAction[] = [];
    if (href) {
        actions.push(linkAction("open-details", "Open Details", href));
        if (href.includes("/edit")) {
            actions.push(linkAction("edit", "Edit", href));
        }
    }
    actions.push(...buildLifecycleCommandActions(detail));
    actions.push(linkAction("local-basemap", "Open Local Basemap", localBasemapPath()));
    return actions;
}

function fromLocalBasemapDetail(
    selection: DevMapSelection,
    detail: LocalBasemapFeatureDetail,
    entityLabel: string,
    lifecycleEntity: "buildings" | "land",
): DevMapInspectorDetail {
    const displayName =
        [detail.name, detail.name_en, detail.name_mm].find(
            (value) => value && String(value).trim().length > 0,
        ) ?? selection.displayName;
    return baseDetail(selection, {
        displayName: String(displayName),
        stableId: detail.core_public_id ?? detail.core_id ?? detail.feature_key,
        featureKey: detail.feature_key,
        lifecycleState: detail.lifecycle_state,
        sourceLabel: `${entityLabel} · ${detail.source_identity}`,
        lifecycleEntity,
        fields: compactFields([
            field("Class", detail.class_code),
            field("Core id", detail.core_id),
            field("Public id", detail.core_public_id),
            field(
                "OSM",
                detail.osm_feature_type && detail.osm_id
                    ? `${detail.osm_feature_type}/${detail.osm_id}`
                    : null,
            ),
            field(
                "Local layers",
                [
                    detail.local_layers.base ? "base" : null,
                    detail.local_layers.archive ? "archive" : null,
                    detail.local_layers.core ? "core" : null,
                    detail.local_layers.suppressed ? "suppressed" : null,
                ]
                    .filter(Boolean)
                    .join(", ") || null,
            ),
        ]),
        actions: lifecycleNavAndCommands(selection, detail),
    });
}

async function loadStreetDetail(
    selection: DevMapSelection,
    signal: AbortSignal,
): Promise<DevMapInspectorDetail> {
    const id = detailLookupId(selection);
    if (!id) {
        throw new DevMapInspectorLoadError("missing_id", "Street has no core id.");
    }
    try {
        const street = await getStreet(id, { signal });
        const record = asRecord(street) ?? {};
        const names = streetDisplayNames(record);
        const displayName = names.displayName ?? selection.displayName;
        const publicId = pickString(record, ["public_id", "publicId"]) ?? (looksLikeUuid(id) ? id : null);
        const linked: DevMapSelection = {
            ...selection,
            corePublicId: publicId ?? selection.corePublicId,
            entityId: publicId ?? selection.entityId,
        };
        return baseDetail(linked, {
            displayName,
            stableId: publicId ?? pickString(record, ["id"]) ?? id,
            lifecycleState: null,
            sourceLabel: "Core street",
            fields: compactFields([
                field("Myanmar name", names.myanmarName),
                field("English name", names.englishName),
                field(
                    "Road class",
                    pickString(record, ["road_class_name", "road_class", "roadClass"]),
                ),
                field("Surface", pickString(record, ["surface"])),
                field(
                    "Travel direction",
                    pickString(record, ["travel_direction", "travelDirection"]),
                ),
                field("Admin area", pickString(record, ["admin_area_name", "adminAreaName"])),
                field("Edit status", pickString(record, ["edit_status", "editStatus"])),
                field("Routing status", pickString(record, ["routing_status", "routingStatus"])),
                field("Active", record.is_active ?? record.isActive),
                field("Core id", selection.coreId),
                field("Public id", publicId),
            ]),
            actions: navigationActions(linked),
        });
    } catch (error) {
        if (isNotFoundError(error)) {
            return tilePropsFallback(
                selection,
                "Street not found in core by tile id. Tile may be stale, or this segment is not published.",
            );
        }
        throw error;
    }
}

async function loadAdminDetail(
    selection: DevMapSelection,
    signal: AbortSignal,
): Promise<DevMapInspectorDetail> {
    const id = detailLookupId(selection);
    if (!id) {
        throw new DevMapInspectorLoadError("missing_id", "Admin area has no core id.");
    }
    try {
        const response = await getCoreReviewDetail<Record<string, unknown>>("admin-areas", id, {
            signal,
        });
        const record = asRecord(response.data) ?? {};
        const displayName =
            pickString(record, ["canonical_name", "canonicalName", "name", "name_en", "name_mm"]) ??
            selection.displayName;
        const publicId =
            pickString(record, ["public_id", "publicId"]) ?? (looksLikeUuid(id) ? id : null);
        return baseDetail(
            {
                ...selection,
                corePublicId: publicId ?? selection.corePublicId,
                entityId: publicId ?? selection.entityId,
            },
            {
                displayName,
                stableId: publicId ?? pickString(record, ["id"]) ?? id,
                lifecycleState: null,
                sourceLabel: "Core admin area",
                fields: compactFields([
                    field("Myanmar name", pickString(record, ["name_mm", "nameMm"])),
                    field("English name", pickString(record, ["name_en", "nameEn"])),
                    field("Slug", pickString(record, ["slug"])),
                    field(
                        "Admin level",
                        pickString(record, [
                            "admin_level_name",
                            "adminLevelName",
                            "admin_level_code",
                            "adminLevelCode",
                        ]),
                    ),
                    field(
                        "Verification",
                        pickString(record, ["verification_status", "verificationStatus"]),
                    ),
                    field("Active", record.is_active ?? record.isActive),
                    field("Parent id", pickString(record, ["parent_id", "parentId"])),
                    field("Core id", selection.coreId ?? pickString(record, ["id"])),
                    field("Public id", publicId),
                ]),
                actions: navigationActions({
                    ...selection,
                    corePublicId: publicId ?? selection.corePublicId,
                    entityId: publicId ?? selection.entityId,
                }),
            },
        );
    } catch (error) {
        if (isNotFoundError(error)) {
            return tilePropsFallback(
                selection,
                "Admin area not found in core by tile id. Showing tile properties only.",
            );
        }
        throw error;
    }
}

async function loadSettlementDetail(
    selection: DevMapSelection,
    signal: AbortSignal,
): Promise<DevMapInspectorDetail> {
    const id = selection.corePublicId ?? selection.coreId ?? selection.entityId;
    if (!id) {
        throw new DevMapInspectorLoadError("missing_id", "Settlement has no public/core id.");
    }
    const response = await getCoreReviewDetail<Record<string, unknown>>("settlements", id, {
        signal,
    });
    const record = asRecord(response.data) ?? {};
    const displayName =
        pickString(record, ["canonical_name", "canonicalName", "name", "name_en", "name_mm"]) ??
        selection.displayName;
    return baseDetail(selection, {
        displayName,
        stableId:
            pickString(record, ["public_id", "publicId", "id"]) ?? selection.corePublicId ?? id,
        lifecycleState: null,
        sourceLabel: "Core settlement",
        fields: compactFields([
            field("Myanmar name", pickString(record, ["name_mm", "nameMm"])),
            field("English name", pickString(record, ["name_en", "nameEn"])),
            field(
                "Settlement type",
                pickString(record, [
                    "settlement_type_code",
                    "settlementTypeCode",
                    "settlement_type",
                ]),
            ),
            field(
                "Township",
                pickString(record, ["township_name", "townshipName", "township_id", "townshipId"]),
            ),
            field("Population", record.population),
            field(
                "Verification",
                pickString(record, ["verification_status", "verificationStatus"]),
            ),
        ]),
        actions: navigationActions(selection),
    });
}

async function loadBuildingDetail(
    selection: DevMapSelection,
    signal: AbortSignal,
): Promise<DevMapInspectorDetail> {
    if (selection.featureKey) {
        try {
            const detail = await fetchLocalBasemapFeature(
                "buildings",
                selection.featureKey,
                signal,
            );
            return fromLocalBasemapDetail(selection, detail, "Building", "buildings");
        } catch (error) {
            if (!isNotFoundError(error) && !isLocalBasemapUnavailableError(error)) {
                throw error;
            }
            // Fall through to core / tile props.
        }
    }

    const coreLookup =
        selection.corePublicId ??
        (selection.coreId && looksLikeUuid(selection.coreId) ? selection.coreId : null) ??
        (looksLikeUuid(selection.entityId) ? selection.entityId : null);

    if (coreLookup) {
        try {
            const building = await getBuilding(coreLookup, { signal });
            const record = asRecord(building) ?? {};
            return baseDetail(selection, {
                displayName:
                    pickString(record, ["name", "name_en", "name_mm", "fallback_name"]) ??
                    selection.displayName,
                stableId: pickString(record, ["public_id", "publicId", "id"]) ?? coreLookup,
                lifecycleState: "core",
                sourceLabel: "Core building",
                fields: compactFields([
                    field("Class", pickString(record, ["class_code", "classCode"])),
                    field(
                        "Building type",
                        pickString(record, [
                            "building_type_name",
                            "buildingTypeName",
                            "building_type_code",
                        ]),
                    ),
                    field("Levels", record.levels),
                    field("Area m²", record.area_m2 ?? record.areaM2),
                    field("Verified", record.is_verified ?? record.isVerified),
                    field("Active", record.is_active ?? record.isActive),
                    field("Feature key", selection.featureKey),
                ]),
                actions: navigationActions({
                    ...selection,
                    corePublicId: pickString(record, ["public_id", "publicId"]) ?? coreLookup,
                }),
            });
        } catch (error) {
            if (!isNotFoundError(error)) {
                throw error;
            }
        }
    }

    return tilePropsFallback(
        selection,
        selection.featureKey
            ? "OSM/public basemap feature — Local Basemap has no matching row (start tiles DB + ENABLE_LOCAL_BASEMAP_ADMIN for Promote/Demote/Delete)."
            : "No matching building row in Local Basemap or core.",
        selection.featureKey ? [localBasemapFallbackLink()] : [],
    );
}

async function loadLandDetail(
    selection: DevMapSelection,
    signal: AbortSignal,
): Promise<DevMapInspectorDetail> {
    if (selection.featureKey) {
        try {
            const detail = await fetchLocalBasemapFeature("land", selection.featureKey, signal);
            return fromLocalBasemapDetail(selection, detail, "Land", "land");
        } catch (error) {
            if (!isNotFoundError(error) && !isLocalBasemapUnavailableError(error)) {
                throw error;
            }
        }
    }

    const coreLookup =
        selection.corePublicId ??
        (selection.coreId && looksLikeUuid(selection.coreId) ? selection.coreId : null) ??
        (looksLikeUuid(selection.entityId) ? selection.entityId : null);

    if (coreLookup) {
        try {
            const response = await getCoreReviewDetail<Record<string, unknown>>(
                "land-areas",
                coreLookup,
                { signal },
            );
            const record = asRecord(response.data) ?? {};
            return baseDetail(selection, {
                displayName:
                    pickString(record, [
                        "name",
                        "name_en",
                        "name_mm",
                        "canonical_name",
                        "canonicalName",
                    ]) ?? selection.displayName,
                stableId: pickString(record, ["public_id", "publicId", "id"]) ?? coreLookup,
                lifecycleState: "core",
                sourceLabel: "Core land area",
                fields: compactFields([
                    field(
                        "Class",
                        pickString(record, ["class_code", "classCode", "land_area_class_code"]),
                    ),
                    field("Detail level", pickString(record, ["detail_level", "detailLevel"])),
                    field("Feature key", selection.featureKey),
                ]),
                actions: navigationActions({
                    ...selection,
                    corePublicId: pickString(record, ["public_id", "publicId"]) ?? coreLookup,
                }),
            });
        } catch (error) {
            if (!isNotFoundError(error)) {
                throw error;
            }
        }
    }

    return tilePropsFallback(
        selection,
        selection.featureKey
            ? "OSM/public basemap feature — Local Basemap has no matching row (start tiles DB + ENABLE_LOCAL_BASEMAP_ADMIN for Promote/Demote/Delete)."
            : "No matching land row in Local Basemap or core.",
        selection.featureKey ? [localBasemapFallbackLink()] : [],
    );
}

async function loadPlacesDetail(
    selection: DevMapSelection,
    signal: AbortSignal,
): Promise<DevMapInspectorDetail> {
    const id = selection.corePublicId ?? selection.entityId;
    if (!id) {
        throw new DevMapInspectorLoadError("missing_id", "Place has no public id.");
    }
    const place = await getPlace(id, { signal });
    const record = asRecord(place) ?? {};
    return baseDetail(selection, {
        displayName:
            pickString(record, [
                "display_name",
                "displayName",
                "primary_name",
                "name",
                "name_en",
                "name_mm",
            ]) ?? selection.displayName,
        stableId: pickString(record, ["public_id", "publicId", "id"]) ?? id,
        lifecycleState: null,
        sourceLabel: "Core place",
        fields: compactFields([
            field("Category", pickString(record, ["category_name", "categoryName", "category_id"])),
            field("Myanmar name", pickString(record, ["name_mm", "nameMm", "myanmarName"])),
            field("English name", pickString(record, ["name_en", "nameEn", "englishName"])),
            field("Verified", record.is_verified ?? record.isVerified),
            field("Active", record.is_active ?? record.isActive),
            field("Admin area", pickString(record, ["admin_area_name", "adminAreaName"])),
        ]),
        actions: navigationActions(selection),
    });
}

async function loadTransportStopDetail(
    selection: DevMapSelection,
    signal: AbortSignal,
): Promise<DevMapInspectorDetail> {
    const id = selection.corePublicId ?? selection.entityId;
    if (!id) {
        throw new DevMapInspectorLoadError("missing_id", "Transport stop has no public id.");
    }
    const stop = await getTransportStopDetail(id, { signal });
    const record = asRecord(stop) ?? {};
    return baseDetail(selection, {
        displayName:
            pickString(record, ["name", "name_en", "name_mm", "public_name"]) ??
            selection.displayName,
        stableId: pickString(record, ["public_id", "publicId", "id"]) ?? id,
        lifecycleState: null,
        sourceLabel: "Transport stop",
        fields: compactFields([
            field("Mode", pickString(record, ["mode"])),
            field("Stop type", pickString(record, ["stop_type", "stopType"])),
            field("Review status", pickString(record, ["review_status", "reviewStatus"])),
            field("Confidence", record.confidence_score ?? record.confidenceScore),
            field("Active", record.is_active ?? record.isActive),
        ]),
        actions: navigationActions(selection),
    });
}

async function loadTransportRouteDetail(
    selection: DevMapSelection,
    signal: AbortSignal,
): Promise<DevMapInspectorDetail> {
    // Martin path tiles expose route_code; API accepts code or public_id.
    const id = selection.corePublicId ?? selection.entityId;
    if (!id) {
        throw new DevMapInspectorLoadError("missing_id", "Transport route has no code/public id.");
    }
    const route = await getTransportRouteDetail(id, { signal });
    const record = asRecord(route) ?? {};
    const publicId = pickString(record, ["public_id", "publicId"]);
    const detailSelection: DevMapSelection = publicId
        ? { ...selection, entityId: publicId, corePublicId: publicId }
        : selection;
    return baseDetail(detailSelection, {
        displayName:
            pickString(record, ["public_name", "publicName", "name", "route_code", "routeCode"]) ??
            selection.displayName,
        stableId: publicId ?? id,
        lifecycleState: null,
        sourceLabel: "Transport route",
        fields: compactFields([
            field("Route code", pickString(record, ["route_code", "routeCode", "code"])),
            field("Mode", pickString(record, ["mode"])),
            field("Kind", pickString(record, ["route_kind", "routeKind"])),
            field("Review status", pickString(record, ["review_status", "reviewStatus"])),
            field("Active", record.is_active ?? record.isActive),
        ]),
        actions: navigationActions(detailSelection),
    });
}

async function loadWaterDetail(selection: DevMapSelection): Promise<DevMapInspectorDetail> {
    return tilePropsFallback(
        selection,
        "Water detail uses tile properties only on Dev Map (no dedicated inspector API).",
    );
}

const ADAPTERS: Partial<Record<DevMapEntityType, DevMapEntityAdapter>> = {
    streets: { entityType: "streets", loadDetail: loadStreetDetail },
    admin: { entityType: "admin", loadDetail: loadAdminDetail },
    settlements: { entityType: "settlements", loadDetail: loadSettlementDetail },
    buildings: { entityType: "buildings", loadDetail: loadBuildingDetail },
    land: { entityType: "land", loadDetail: loadLandDetail },
    water: { entityType: "water", loadDetail: async (selection) => loadWaterDetail(selection) },
    places: { entityType: "places", loadDetail: loadPlacesDetail },
    transport_stops: { entityType: "transport_stops", loadDetail: loadTransportStopDetail },
    transport_routes: { entityType: "transport_routes", loadDetail: loadTransportRouteDetail },
};

export function getDevMapEntityAdapter(
    entityType: DevMapEntityType,
): DevMapEntityAdapter | null {
    return ADAPTERS[entityType] ?? null;
}

/**
 * Load inspector detail via the entity adapter. Does not mutate map camera.
 * Throws DevMapInspectorLoadError (or AbortError).
 */
export async function loadDevMapInspectorDetail(
    selection: DevMapSelection,
    signal: AbortSignal,
): Promise<DevMapInspectorDetail> {
    const adapter = getDevMapEntityAdapter(selection.entityType);
    if (!adapter) {
        throw new DevMapInspectorLoadError(
            "unsupported",
            `No inspector adapter for ${selection.entityType}.`,
        );
    }
    try {
        return await adapter.loadDetail(selection, signal);
    } catch (error) {
        if (isAbortError(error)) {
            throw error;
        }
        throw mapLoadError(error);
    }
}

export const DEV_MAP_INSPECTOR_ADAPTER_TYPES = Object.keys(ADAPTERS) as DevMapEntityType[];
