import { Suspense } from "react";

import TourismGuideEditorPage from "@/src/features/tourism-visitor/TourismGuideEditorPage";

export default function TourismGuideNewRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl p-6">
          <p className="text-sm text-gray-500">Loading…</p>
        </div>
      }
    >
      <TourismGuideEditorPage />
    </Suspense>
  );
}
