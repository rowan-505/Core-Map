import TourismPlaceProfileEditor from "@/src/features/tourism-moderation/TourismPlaceProfileEditor";

export default async function TourismPlaceEditPage({
  params,
}: {
  readonly params: Promise<{ readonly placeId: string }>;
}) {
  const { placeId } = await params;
  return <TourismPlaceProfileEditor mode="update" placePublicId={placeId} />;
}
