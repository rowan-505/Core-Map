import { Suspense } from "react";

import TourismFoodEditorPage from "@/src/features/tourism-visitor/TourismFoodEditorPage";

export default function TourismFoodNewRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl p-6">
          <p className="text-sm text-gray-500">Loading…</p>
        </div>
      }
    >
      <TourismFoodEditorPage />
    </Suspense>
  );
}
