export type LocalBasemapLifecycleState = "base" | "archive" | "core" | "deleted" | "absent";

export type LocalBasemapAction = "promote" | "demote" | "delete" | "clear_suppression";

/** Mirrors API `actionsForLifecycleState` for UI button visibility. */
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

export function lifecycleStateLabel(state: LocalBasemapLifecycleState): string {
    switch (state) {
        case "base":
            return "Base";
        case "archive":
            return "Archive";
        case "core":
            return "Core";
        case "deleted":
            return "Deleted/Suppressed";
        default:
            return "Absent";
    }
}
