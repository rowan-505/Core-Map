import { Suspense } from "react";

import AdminGeographyPage from "@/src/features/admin-geography/AdminGeographyPage";

export default function Page() {
    return (
        <Suspense
            fallback={
                <div className="p-4 text-sm text-slate-500">Loading admin geography…</div>
            }
        >
            <AdminGeographyPage />
        </Suspense>
    );
}
