import type { LocalBasemapAction, LocalBasemapLifecycleState } from "./local-basemap.types.js";

/** Pure UI/API helper: which lifecycle buttons apply for a resolved state. */
export function actionsForLifecycleState(state: LocalBasemapLifecycleState): LocalBasemapAction[] {
    switch (state) {
        case "base":
        case "archive":
            return ["promote"];
        case "core":
            return ["demote", "delete"];
        case "deleted":
            return ["clear_suppression"];
        default:
            return [];
    }
}
