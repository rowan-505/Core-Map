import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  getCommunityPost,
  listCommunityPosts,
  listMyCommunityPosts,
  type CommunityFeed,
  type CommunityListQuery,
} from './communityApi';

export const communityFeedQueryKey = (
  feed: CommunityFeed,
  category?: string,
) => ['community', 'feed', feed, category ?? null] as const;

export const communityMarkersQueryKey = (
  feed: CommunityFeed,
  bbox: string,
) => ['community', 'markers', feed, bbox] as const;

export const communityMyPostsQueryKey = ['community', 'mine'] as const;

export const communityPostDetailQueryKey = (publicId: string) =>
  ['community', 'post', publicId] as const;

export function useCommunityFeed(options: {
  readonly feed: CommunityFeed;
  readonly enabled: boolean;
  readonly category?: string;
}) {
  return useInfiniteQuery({
    queryKey: communityFeedQueryKey(options.feed, options.category),
    enabled: options.enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listCommunityPosts(
        {
          feed: options.feed,
          cursor: pageParam,
          limit: 20,
          category: options.category,
        },
        signal,
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useMyCommunityPosts(options: { readonly enabled: boolean }) {
  return useInfiniteQuery({
    queryKey: communityMyPostsQueryKey,
    enabled: options.enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listMyCommunityPosts({ cursor: pageParam, limit: 20 }, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

/** Geotagged posts in a committed viewport — only while Community is active. */
export function useCommunityMapMarkers(options: {
  readonly enabled: boolean;
  readonly feed: CommunityFeed;
  readonly bbox: string | null;
}) {
  const query: CommunityListQuery = {
    feed: options.feed,
    bbox: options.bbox ?? undefined,
    limit: 50,
  };

  return useQuery({
    queryKey: communityMarkersQueryKey(options.feed, options.bbox ?? ''),
    enabled: options.enabled && Boolean(options.bbox),
    queryFn: ({ signal }) => listCommunityPosts(query, signal),
    staleTime: 30_000,
  });
}

export function useCommunityPostDetail(options: {
  readonly publicId: string | null;
  readonly enabled?: boolean;
}) {
  return useQuery({
    queryKey: communityPostDetailQueryKey(options.publicId ?? ''),
    enabled: Boolean(options.publicId) && (options.enabled ?? true),
    queryFn: ({ signal }) => getCommunityPost(options.publicId!, signal),
  });
}
