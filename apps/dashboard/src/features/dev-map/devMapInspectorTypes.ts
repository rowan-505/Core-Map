import type { DevMapEntityType } from "./devMapEntityRegistry";
import type { DevMapSelection } from "./devMapSelection";
import type { LocalBasemapAction } from "@/src/features/local-basemap/localBasemapActions";

export type DevMapInspectorField = {
    label: string;
    value: string;
};

/** Navigation action — routes to an existing dashboard page. */
export type DevMapInspectorLinkAction = {
    kind: "link";
    id: string;
    label: string;
    href: string;
};

/**
 * Lifecycle command — runs existing local-basemap API action.
 * Labels/confirmations mirror Local Basemap admin; no new semantics.
 */
export type DevMapInspectorLifecycleAction = {
    kind: "lifecycle";
    id: LocalBasemapAction;
    label: string;
    /** Matches LocalBasemapPage button styling roles. */
    tone: "promote" | "demote" | "delete" | "neutral";
    /** Delete uses CoreReviewConfirmDialog (same copy as Local Basemap). */
    requiresConfirm: boolean;
};

export type DevMapInspectorAction = DevMapInspectorLinkAction | DevMapInspectorLifecycleAction;

export type DevMapInspectorDetail = {
    entityType: DevMapEntityType;
    badgeLabel: string;
    displayName: string;
    stableId: string | null;
    featureKey: string | null;
    /** Lifecycle or resolved source label when relevant (e.g. core / base / archive). */
    lifecycleState: string | null;
    sourceLabel: string | null;
    fields: DevMapInspectorField[];
    actions: DevMapInspectorAction[];
    detailHref: string | null;
    /** Short note when detail came from tile props only. */
    fallbackNote: string | null;
    /** When set, lifecycle commands target this local-basemap entity. */
    lifecycleEntity: "buildings" | "land" | null;
};

export type DevMapInspectorLoadErrorCode =
    | "not_found"
    | "fetch_failed"
    | "unsupported"
    | "missing_id";

export class DevMapInspectorLoadError extends Error {
    readonly code: DevMapInspectorLoadErrorCode;

    constructor(code: DevMapInspectorLoadErrorCode, message: string) {
        super(message);
        this.name = "DevMapInspectorLoadError";
        this.code = code;
    }
}

export type DevMapEntityAdapter = {
    entityType: DevMapEntityType;
    loadDetail: (
        selection: DevMapSelection,
        signal: AbortSignal,
    ) => Promise<DevMapInspectorDetail>;
};

export type DevMapInspectorLoadState =
    | { status: "idle" }
    | { status: "loading"; selection: DevMapSelection }
    | { status: "ready"; selection: DevMapSelection; detail: DevMapInspectorDetail }
    | {
          status: "error";
          selection: DevMapSelection;
          code: DevMapInspectorLoadErrorCode;
          message: string;
      };

export type DevMapInspectorActionBanner = {
    tone: "success" | "warning" | "error" | "info";
    message: string;
    dependencies?: string[];
};
