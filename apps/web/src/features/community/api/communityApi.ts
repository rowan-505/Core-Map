/**
 * Community API client for the public web map.
 * Uses publicGet for feeds/detail and authJson for write/protected paths.
 */
import { ApiError, authJson, publicGet } from '@/features/auth/api/http';

export type CommunityFeed = 'latest' | 'trusted';
export type CommunityReactionType = 'confirm' | 'helpful' | 'incorrect';
export type CommunityPublicationStatus =
  | 'published'
  | 'resolved'
  | 'expired'
  | 'rejected'
  | 'removed';
export type CommunityVerificationStatus =
  | 'unverified'
  | 'community_confirmed'
  | 'admin_verified';

export type CommunityAuthor = {
  readonly public_id: string;
  readonly display_name: string;
};

export type CommunityLocation = {
  readonly lng: number;
  readonly lat: number;
  readonly label: string | null;
};

export type CommunityReactionCounts = {
  readonly confirm: number;
  readonly helpful: number;
  readonly incorrect: number;
};

export type CommunityPostListItem = {
  readonly public_id: string;
  readonly title: string;
  readonly description_preview: string;
  readonly category: string;
  readonly publication_status: CommunityPublicationStatus;
  readonly verification_status: CommunityVerificationStatus;
  readonly trust_score: number;
  readonly published_at: string;
  readonly has_location: boolean;
  readonly location: CommunityLocation | null;
  readonly author: CommunityAuthor;
  readonly reaction_counts: CommunityReactionCounts;
};

export type CommunityPostDetail = CommunityPostListItem & {
  readonly description: string;
  readonly updated_at: string;
  readonly viewer_reaction: CommunityReactionType | null;
};

export type CommunityPostPage = {
  readonly items: readonly CommunityPostListItem[];
  readonly next_cursor: string | null;
};

export type CommunityListQuery = {
  readonly feed?: CommunityFeed;
  readonly cursor?: string;
  readonly limit?: number;
  readonly category?: string;
  /** west,south,east,north — only returns geotagged posts in the box */
  readonly bbox?: string;
};

export type CreateCommunityPostInput = {
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly location?: CommunityLocation | null;
};

export type PatchCommunityPostInput = {
  readonly title?: string;
  readonly description?: string;
  readonly category?: string;
  readonly location?: CommunityLocation | null;
};

function buildListQuery(query: CommunityListQuery): string {
  const params = new URLSearchParams();
  if (query.feed) params.set('feed', query.feed);
  if (query.cursor) params.set('cursor', query.cursor);
  if (typeof query.limit === 'number') params.set('limit', String(query.limit));
  if (query.category) params.set('category', query.category);
  if (query.bbox) params.set('bbox', query.bbox);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function listCommunityPosts(
  query: CommunityListQuery = {},
  signal?: AbortSignal,
): Promise<CommunityPostPage> {
  return publicGet<CommunityPostPage>(`/community/posts${buildListQuery(query)}`, signal);
}

export async function getCommunityPost(
  publicId: string,
  signal?: AbortSignal,
): Promise<CommunityPostDetail> {
  return publicGet<CommunityPostDetail>(`/community/posts/${encodeURIComponent(publicId)}`, signal);
}

export async function listMyCommunityPosts(
  query: { readonly cursor?: string; readonly limit?: number } = {},
  signal?: AbortSignal,
): Promise<CommunityPostPage> {
  const params = new URLSearchParams();
  if (query.cursor) params.set('cursor', query.cursor);
  if (typeof query.limit === 'number') params.set('limit', String(query.limit));
  const qs = params.toString();
  return authJson<CommunityPostPage>(`/me/community-posts${qs ? `?${qs}` : ''}`, {
    signal,
  });
}

export async function createCommunityPost(
  input: CreateCommunityPostInput,
): Promise<CommunityPostDetail> {
  return authJson<CommunityPostDetail>('/community/posts', {
    method: 'POST',
    body: {
      title: input.title,
      description: input.description,
      category: input.category,
      location: input.location ?? null,
    },
  });
}

export async function patchCommunityPost(
  publicId: string,
  input: PatchCommunityPostInput,
): Promise<CommunityPostDetail> {
  return authJson<CommunityPostDetail>(`/community/posts/${encodeURIComponent(publicId)}`, {
    method: 'PATCH',
    body: input,
  });
}

export async function deleteCommunityPost(publicId: string): Promise<CommunityPostDetail> {
  return authJson<CommunityPostDetail>(`/community/posts/${encodeURIComponent(publicId)}`, {
    method: 'DELETE',
  });
}

export async function putCommunityReaction(
  publicId: string,
  reactionType: CommunityReactionType,
): Promise<CommunityPostDetail> {
  return authJson<CommunityPostDetail>(
    `/community/posts/${encodeURIComponent(publicId)}/reaction`,
    {
      method: 'PUT',
      body: { reactionType },
    },
  );
}

export async function deleteCommunityReaction(publicId: string): Promise<CommunityPostDetail> {
  return authJson<CommunityPostDetail>(
    `/community/posts/${encodeURIComponent(publicId)}/reaction`,
    { method: 'DELETE' },
  );
}

export { ApiError };
