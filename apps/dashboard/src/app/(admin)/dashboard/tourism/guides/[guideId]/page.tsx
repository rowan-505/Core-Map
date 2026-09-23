import TourismGuideEditorPage from "@/src/features/tourism-visitor/TourismGuideEditorPage";

export default async function TourismGuideEditRoutePage({
  params,
}: {
  params: Promise<{ guideId: string }>;
}) {
  const { guideId } = await params;
  return <TourismGuideEditorPage guideId={guideId} />;
}
