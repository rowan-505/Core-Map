import { redirect } from "next/navigation";

import { tourismPath } from "@/src/lib/dashboardPaths";

export default function TourismIndexPage() {
  redirect(tourismPath("places"));
}
