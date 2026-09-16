import type { ReactNode } from "react";

import DashboardQueryProvider from "@/src/components/providers/DashboardQueryProvider";
import DashboardSidebar from "@/src/components/layout/DashboardSidebar";
import { BuildingTileVersionProvider } from "@/src/components/map/BuildingTileVersionContext";
import DashboardViewerRouteGate from "@/src/components/viewer/DashboardViewerRouteGate";

/**
 * Shared shell for authenticated data modules (`/dashboard`, `/places`, `/streets`, etc.).
 * Route group name `(admin)` is not part of URLs.
 */
export default function AdminModuleLayout({ children }: { children: ReactNode }) {
    return (
        <DashboardQueryProvider>
            <BuildingTileVersionProvider>
                <div className="flex h-screen overflow-hidden bg-gray-100">
                    <DashboardSidebar />
                    <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto">
                        <DashboardViewerRouteGate>{children}</DashboardViewerRouteGate>
                    </div>
                </div>
            </BuildingTileVersionProvider>
        </DashboardQueryProvider>
    );
}
