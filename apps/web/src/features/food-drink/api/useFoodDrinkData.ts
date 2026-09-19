import { useInfiniteQuery } from '@tanstack/react-query';
import {
  listFoodDrinkRecommendations,
  type FoodDrinkRecommendationsPage,
} from './foodDrinkApi';

const PAGE_SIZE = 20;

export function useFoodDrinkRecommendations(input: {
  readonly enabled: boolean;
  readonly townshipAdminAreaId: string | null;
  readonly lang: 'my' | 'en';
  readonly lat: number | null;
  readonly lng: number | null;
}) {
  return useInfiniteQuery({
    queryKey: [
      'food-drink-recommendations',
      input.townshipAdminAreaId,
      input.lang,
      input.lat,
      input.lng,
    ],
    enabled: input.enabled && Boolean(input.townshipAdminAreaId),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      listFoodDrinkRecommendations(
        {
          township_admin_area_id: input.townshipAdminAreaId!,
          lang: input.lang,
          limit: PAGE_SIZE,
          offset: pageParam,
          lat: input.lat ?? undefined,
          lng: input.lng ?? undefined,
        },
        signal,
      ),
    getNextPageParam: (last: FoodDrinkRecommendationsPage) => {
      const next = last.offset + last.limit;
      return next < last.total ? next : undefined;
    },
  });
}
