/**
 * Dev Map lifecycle action wiring — thin reuse of Local Basemap admin helpers.
 * Does not redefine promote/demote/delete rules.
 */
import {
    actionsForLifecycleState,
    type LocalBasemapAction,
    type LocalBasemapLifecycleState,
} from "@/src/features/local-basemap/localBasemapActions";
import {
    runLocalBasemapAction,
    type LocalBasemapActionResult,
    type LocalBasemapEntity,
    type LocalBasemapFeatureDetail,
} from "@/src/features/local-basemap/localBasemapApi";

import type {
    DevMapInspectorActionBanner,
    DevMapInspectorLifecycleAction,
} from "./devMapInspectorTypes";

/** Same delete confirm copy as LocalBasemapPage. */
export const DEV_MAP_DELETE_CONFIRM = {
    title: "Delete feature from map?",
    description:
        "Delete writes a render suppression so Base and Archive do not reappear. This is different from Demote (which keeps Archive). Confirm to continue.",
    confirmLabel: "Delete and suppress",
} as const;

/** Prefer backend available_actions; fall back to shared state→actions map. */
export function resolveLifecycleActionsForDetail(
    detail: Pick<LocalBasemapFeatureDetail, "available_actions" | "lifecycle_state">,
): LocalBasemapAction[] {
    if (detail.available_actions?.length) {
        return [...detail.available_actions];
    }
    return actionsForLifecycleState(detail.lifecycle_state);
}

export function lifecycleActionUi(action: LocalBasemapAction): DevMapInspectorLifecycleAction {
    switch (action) {
        case "promote":
            return {
                kind: "lifecycle",
                id: "promote",
                label: "Promote to Core",
                tone: "promote",
                requiresConfirm: false,
            };
        case "demote":
            return {
                kind: "lifecycle",
                id: "demote",
                label: "Demote to Local",
                tone: "demote",
                requiresConfirm: false,
            };
        case "delete":
            return {
                kind: "lifecycle",
                id: "delete",
                label: "Delete",
                tone: "delete",
                requiresConfirm: true,
            };
        case "clear_suppression":
            return {
                kind: "lifecycle",
                id: "clear_suppression",
                label: "Clear suppression",
                tone: "neutral",
                requiresConfirm: false,
            };
    }
}

export function buildLifecycleCommandActions(
    detail: Pick<LocalBasemapFeatureDetail, "available_actions" | "lifecycle_state">,
): DevMapInspectorLifecycleAction[] {
    return resolveLifecycleActionsForDetail(detail).map(lifecycleActionUi);
}

/**
 * Regression matrix helper — expected Dev Map actions by entity state.
 * Must match Local Basemap + API `actionsForLifecycleState`.
 */
export const DEV_MAP_LIFECYCLE_ACTION_MATRIX: ReadonlyArray<{
    entity: LocalBasemapEntity;
    state: LocalBasemapLifecycleState;
    existingBeforeDevMap: LocalBasemapAction[];
    availableInDevMap: LocalBasemapAction[];
}> = (
    [
        ["buildings", "base"],
        ["buildings", "archive"],
        ["buildings", "core"],
        ["land", "base"],
        ["land", "archive"],
        ["land", "core"],
    ] as const
).map(([entity, state]) => {
    const actions = actionsForLifecycleState(state);
    return {
        entity,
        state,
        existingBeforeDevMap: actions,
        availableInDevMap: actions,
    };
});

export async function runDevMapLifecycleAction(args: {
    entity: LocalBasemapEntity;
    action: LocalBasemapAction;
    featureKey: string;
}): Promise<LocalBasemapActionResult> {
    return runLocalBasemapAction(args.entity, args.action, args.featureKey);
}

export function bannerFromLifecycleResult(
    result: LocalBasemapActionResult,
): DevMapInspectorActionBanner {
    if (!result.ok) {
        return {
            tone: "error",
            message: result.message,
            dependencies: result.dependencies?.map(
                (d) => `${d.code}: ${d.message} (${d.count})`,
            ),
        };
    }
    if (result.sync_stale) {
        return { tone: "warning", message: result.message };
    }
    return { tone: "success", message: result.message };
}
