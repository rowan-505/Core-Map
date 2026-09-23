import { Suspense } from "react";

import NamePairReviewsPage from "@/src/features/name-pair-reviews/NamePairReviewsPage";

/** Plan route alias: /dashboard/name-pairs */
export default function NamePairsTopLevelRoutePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl p-6">
          <p className="text-sm text-gray-500">Loading name pairs…</p>
        </div>
      }
    >
      <NamePairReviewsPage />
    </Suspense>
  );
}
