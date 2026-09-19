import type { TourismRankingMode } from '../api/tourismApiTypes';

export const TOURISM_RANKING_MODES = [
  'recommended',
  'top_rated',
  'most_reviewed',
  'nearby',
  'editor_picks',
] as const satisfies readonly TourismRankingMode[];

export type TourismModeMeta = {
  readonly id: TourismRankingMode;
  readonly labelMy: string;
  readonly labelEn: string;
};

/** Product labels — never use “best” for low-sample rankings. */
export const TOURISM_MODE_META: readonly TourismModeMeta[] = [
  {
    id: 'recommended',
    labelMy: 'အကြံပြုထားသည်',
    labelEn: 'Recommended',
  },
  {
    id: 'top_rated',
    labelMy: 'အဆင့်မြင့်',
    labelEn: 'Top rated',
  },
  {
    id: 'most_reviewed',
    labelMy: 'သုံးသပ်ချက်များစွာ',
    labelEn: 'Most reviewed',
  },
  {
    id: 'nearby',
    labelMy: 'အနီးအနား',
    labelEn: 'Nearby',
  },
  {
    id: 'editor_picks',
    labelMy: 'CoreMap အထူးရွေးချယ်မှု',
    labelEn: 'Featured by CoreMap',
  },
] as const;

export function isTourismRankingMode(value: string): value is TourismRankingMode {
  return (TOURISM_RANKING_MODES as readonly string[]).includes(value);
}

export function tourismModeLabel(
  mode: TourismRankingMode,
  t: (myanmar: string, english: string) => string,
): string {
  const match = TOURISM_MODE_META.find((item) => item.id === mode);
  if (!match) return mode;
  return t(match.labelMy, match.labelEn);
}
