import { Suspense } from "react";

import TourismAdvisoryEditorPage from "@/src/features/tourism-visitor/TourismAdvisoryEditorPage";

export default function TourismAdvisoryNewRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl p-6">
          <p className="text-sm text-gray-500">Loading…</p>
        </div>
      }
    >
      <TourismAdvisoryEditorPage />
    </Suspense>
  );
}
