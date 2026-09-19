import { redirect } from "next/navigation";
import { reviewsPath } from "@/src/lib/dashboardPaths";

export default function LegacyTourismReviewsRedirect() {
  redirect(reviewsPath());
}
