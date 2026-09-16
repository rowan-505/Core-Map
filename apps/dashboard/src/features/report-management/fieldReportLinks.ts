import { transportPath } from "@/src/lib/dashboardPaths";

/** Keep report review open; open transport editors in a separate tab. */
export const FIELD_EDITOR_LINK_PROPS = {
    target: "_blank",
    rel: "noopener noreferrer",
} as const;

export function fieldStopEditorHref(stopPublicId: string): string {
    return `${transportPath("stops")}?stop=${encodeURIComponent(stopPublicId)}`;
}

export function fieldRouteEditorHref(routePublicId: string): string {
    return `${transportPath("routes")}?route=${encodeURIComponent(routePublicId)}`;
}

/** Open stop/route editor without leaving the report detail page. */
export function openFieldEditorInNewTab(href: string): void {
    window.open(href, "_blank", "noopener,noreferrer");
}
