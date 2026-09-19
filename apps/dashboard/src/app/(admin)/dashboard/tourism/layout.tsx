import type { ReactNode } from "react";
import { Suspense } from "react";

import FamilyTopNavFromConfig from "@/src/components/dashboard/FamilyTopNavFromConfig";
import { TOURISM_PATH, tourismTabs } from "@/src/lib/dashboardNavigation";

export default function TourismLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <FamilyTopNavFromConfig
          ariaLabel="Tourism sections"
          basePath={TOURISM_PATH}
          tabs={tourismTabs}
        />
      </Suspense>
      {children}
    </>
  );
}
