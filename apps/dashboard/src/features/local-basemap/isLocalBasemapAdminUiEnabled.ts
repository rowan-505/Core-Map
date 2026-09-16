import { isLocalDevHost } from "@/src/lib/isLocalDevHost";

/**
 * Local Windows/WSL Local Basemap admin UI gate.
 *
 * Requires ALL of:
 * - non-production NODE_ENV (build-time)
 * - NEXT_PUBLIC_ENABLE_LOCAL_BASEMAP_ADMIN=true|1
 * - browser host is localhost (or SSR treating non-production as local)
 *
 * Production builds never show this page by default.
 */
export function isLocalBasemapAdminUiEnabled(): boolean {
    if (process.env.NODE_ENV === "production") {
        return false;
    }
    const flag = (process.env.NEXT_PUBLIC_ENABLE_LOCAL_BASEMAP_ADMIN ?? "").trim().toLowerCase();
    if (flag !== "true" && flag !== "1") {
        return false;
    }
    return isLocalDevHost();
}
