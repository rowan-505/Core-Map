import { Suspense } from "react";

import CommunityModerationPage from "@/src/features/community-moderation/CommunityModerationPage";

export default function CommunityPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl p-6">
          <p className="text-sm text-gray-500">Loading community posts…</p>
        </div>
      }
    >
      <CommunityModerationPage />
    </Suspense>
  );
}
