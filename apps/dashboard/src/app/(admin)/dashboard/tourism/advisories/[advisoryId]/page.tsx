import TourismAdvisoryEditorPage from "@/src/features/tourism-visitor/TourismAdvisoryEditorPage";

export default async function TourismAdvisoryEditRoutePage({
  params,
}: {
  params: Promise<{ advisoryId: string }>;
}) {
  const { advisoryId } = await params;
  return <TourismAdvisoryEditorPage advisoryId={advisoryId} />;
}
