import TourismResearchDetailPage from "@/src/features/tourism-research/TourismResearchDetailPage";

export default async function TourismResearchDetailRoutePage({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  const { candidateId } = await params;
  return <TourismResearchDetailPage candidateId={candidateId} />;
}
