import { Suspense } from "react";

import TourismCandidatesPage from "@/src/features/tourism-moderation/TourismCandidatesPage";

export default function TourismCandidatesRoutePage() {
    return (
        <Suspense
            fallback={
                <div className="mx-auto max-w-7xl p-6">
                    <p className="text-sm text-gray-500">Loading tourism candidates…</p>
                </div>
            }
        >
            <TourismCandidatesPage />
        </Suspense>
    );
}
