import { Suspense } from "react";

import TourismAdvisoriesPage from "@/src/features/tourism-visitor/TourismAdvisoriesPage";

export default function TourismAdvisoriesRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl p-6">
          <p className="text-sm text-gray-500">Loading advisories…</p>
        </div>
      }
    >
      <TourismAdvisoriesPage />
    </Suspense>
  );
}
