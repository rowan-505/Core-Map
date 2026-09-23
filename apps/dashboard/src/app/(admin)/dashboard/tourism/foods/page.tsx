import { Suspense } from "react";

import TourismFoodsPage from "@/src/features/tourism-visitor/TourismFoodsPage";

export default function TourismFoodsRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl p-6">
          <p className="text-sm text-gray-500">Loading foods…</p>
        </div>
      }
    >
      <TourismFoodsPage />
    </Suspense>
  );
}
