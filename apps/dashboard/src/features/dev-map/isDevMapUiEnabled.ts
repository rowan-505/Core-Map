import { isLocalBasemapAdminUiEnabled } from "@/src/features/local-basemap/isLocalBasemapAdminUiEnabled";
import { isLocalDevHost } from "@/src/lib/isLocalDevHost";

function envFlagEnabled(value: string | undefined): boolean {
    const flag = (value ?? "").trim().toLowerCase();
    return flag === "true" || flag === "1";
}

/**
 * Local/dev-only gate for the dashboard Dev Map.
 *
 * Production builds never enable this page.
 * Reuses the existing Local Basemap admin UI flag when set; otherwise accepts
 * `NEXT_PUBLIC_ENABLE_DEV_MAP=true|1` on a local host.
 */
export function isDevMapUiEnabled(): boolean {
    if (process.env.NODE_ENV === "production") {
        return false;
    }
    if (isLocalBasemapAdminUiEnabled()) {
        return true;
    }
    if (!envFlagEnabled(process.env.NEXT_PUBLIC_ENABLE_DEV_MAP)) {
        return false;
    }
    return isLocalDevHost();
}
