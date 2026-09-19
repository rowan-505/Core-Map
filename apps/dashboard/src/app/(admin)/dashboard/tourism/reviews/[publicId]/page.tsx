import { redirect } from "next/navigation";

import { reviewsPath } from "@/src/lib/dashboardPaths";

type Props = {
  readonly params: Promise<{ publicId: string }>;
};

/** Tourism-owned review detail moved to universal /dashboard/reviews/:id. */
export default async function LegacyTourismReviewDetailRedirect({ params }: Props) {
  const { publicId } = await params;
  redirect(reviewsPath(publicId));
}
