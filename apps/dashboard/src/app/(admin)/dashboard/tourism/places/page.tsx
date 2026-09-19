import { Suspense } from "react";

import TourismPlacesPage from "@/src/features/tourism-moderation/TourismPlacesPage";

export default function TourismPlacesRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl p-6">
          <p className="text-sm text-gray-500">Loading tourism places…</p>
        </div>
      }
    >
      <TourismPlacesPage />
    </Suspense>
  );
}
