import TourismFoodEditorPage from "@/src/features/tourism-visitor/TourismFoodEditorPage";

export default async function TourismFoodEditRoutePage({
  params,
}: {
  params: Promise<{ foodId: string }>;
}) {
  const { foodId } = await params;
  return <TourismFoodEditorPage foodId={foodId} />;
}
