import { Suspense } from "react";
import PlaceReviewsPage from "@/src/features/place-review-moderation/PlaceReviewsPage";

export default function ReviewsRoute() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading reviews…</div>}>
      <PlaceReviewsPage />
    </Suspense>
  );
}
