import { Suspense } from "react";

import TourismActivitiesPage from "@/src/features/tourism-catalog/TourismActivitiesPage";

export default function TourismActivitiesRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl p-6">
          <p className="text-sm text-gray-500">Loading activities…</p>
        </div>
      }
    >
      <TourismActivitiesPage />
    </Suspense>
  );
}
