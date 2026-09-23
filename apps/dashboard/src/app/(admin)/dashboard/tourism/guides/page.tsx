import { Suspense } from "react";

import TourismGuidesPage from "@/src/features/tourism-visitor/TourismGuidesPage";

export default function TourismGuidesRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl p-6">
          <p className="text-sm text-gray-500">Loading guides…</p>
        </div>
      }
    >
      <TourismGuidesPage />
    </Suspense>
  );
}
