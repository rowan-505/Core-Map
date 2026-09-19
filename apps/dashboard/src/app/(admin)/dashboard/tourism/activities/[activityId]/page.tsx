import TourismActivityEditorPage from "@/src/features/tourism-catalog/TourismActivityEditorPage";

export default async function TourismActivityEditRoutePage({
  params,
}: {
  params: Promise<{ activityId: string }>;
}) {
  const { activityId } = await params;
  return <TourismActivityEditorPage activityId={activityId} />;
}
