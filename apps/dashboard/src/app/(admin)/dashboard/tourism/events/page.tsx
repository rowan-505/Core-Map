import { Suspense } from "react";

import TourismEventsPage from "@/src/features/tourism-catalog/TourismEventsPage";

export default function TourismEventsRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl p-6">
          <p className="text-sm text-gray-500">Loading events…</p>
        </div>
      }
    >
      <TourismEventsPage />
    </Suspense>
  );
}
