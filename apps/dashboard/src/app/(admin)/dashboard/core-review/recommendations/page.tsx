import { Suspense } from "react";

import FoodRecommendationsPage from "@/src/features/food-recommendations/FoodRecommendationsPage";

export default function CoreReviewRecommendationsRoutePage() {
    return (
        <Suspense fallback={<p className="p-6 text-sm text-gray-500">Loading recommendations…</p>}>
            <FoodRecommendationsPage />
        </Suspense>
    );
}
