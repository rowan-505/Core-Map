import { Suspense } from "react";

import TourismResearchPage from "@/src/features/tourism-research/TourismResearchPage";

export default function TourismResearchRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl p-6">
          <p className="text-sm text-gray-500">Loading research…</p>
        </div>
      }
    >
      <TourismResearchPage />
    </Suspense>
  );
}
