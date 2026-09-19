import PlaceReviewDetailPage from "@/src/features/place-review-moderation/PlaceReviewDetailPage";

export default async function PlaceReviewDetailRoutePage({
  params,
}: {
  readonly params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return <PlaceReviewDetailPage publicId={publicId} />;
}
