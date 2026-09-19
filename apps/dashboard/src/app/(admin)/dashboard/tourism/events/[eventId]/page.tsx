import TourismEventDetailPage from "@/src/features/tourism-catalog/TourismEventDetailPage";

export default async function TourismEventDetailRoutePage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <TourismEventDetailPage eventId={eventId} />;
}
