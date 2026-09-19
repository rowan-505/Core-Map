import CommunityPostDetailPage from "@/src/features/community-moderation/CommunityPostDetailPage";

export default async function CommunityPostDetailRoutePage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return <CommunityPostDetailPage publicId={publicId} />;
}
