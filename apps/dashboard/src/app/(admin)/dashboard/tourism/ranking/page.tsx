import { Suspense } from "react";

import TourismRankingPage from "@/src/features/tourism-moderation/TourismRankingPage";

export default function TourismRankingRoutePage() {
    return (
        <Suspense
            fallback={
                <div className="mx-auto max-w-7xl p-6">
                    <p className="text-sm text-gray-500">Loading tourism ranking…</p>
                </div>
            }
        >
            <TourismRankingPage />
        </Suspense>
    );
}
