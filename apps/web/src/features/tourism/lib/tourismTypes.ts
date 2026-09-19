/** V1 tourism taxonomy used by the API, with an additional All filter. */

export const TOURISM_TYPE_FILTERS = [
  { code: null, labelMy: 'အားလုံး', labelEn: 'All' },
  { code: 'attraction', labelMy: 'အထင်ကရနေရာ', labelEn: 'Attraction' },
  { code: 'religious', labelMy: 'ဘာသာရေးနေရာ', labelEn: 'Religious' },
  { code: 'historical', labelMy: 'သမိုင်းဝင်နေရာ', labelEn: 'Historical' },
  { code: 'cultural', labelMy: 'ယဉ်ကျေးမှု', labelEn: 'Cultural' },
  { code: 'nature', labelMy: 'သဘာဝ', labelEn: 'Nature' },
  { code: 'museum', labelMy: 'ပြတိုက်', labelEn: 'Museum' },
  { code: 'viewpoint', labelMy: 'ရှုခင်းကြည့်နေရာ', labelEn: 'Viewpoint' },
  { code: 'beach', labelMy: 'ကမ်းခြေ', labelEn: 'Beach' },
  { code: 'waterfall', labelMy: 'ရေတံခွန်', labelEn: 'Waterfall' },
  { code: 'park', labelMy: 'ပန်းခြံ', labelEn: 'Park' },
  { code: 'market', labelMy: 'ဈေး', labelEn: 'Market' },
  { code: 'recreation', labelMy: 'အပန်းဖြေ', labelEn: 'Recreation' },
  { code: 'other', labelMy: 'အခြား', labelEn: 'Other' },
] as const;

export type TourismTypeFilterCode =
  | (typeof TOURISM_TYPE_FILTERS)[number]['code']
  | string;

export function tourismTypeFilterLabel(
  code: string | null,
  t: (myanmar: string, english: string) => string,
): string {
  const match = TOURISM_TYPE_FILTERS.find((item) => item.code === code);
  if (!match) return code ?? t('အားလုံး', 'All');
  return t(match.labelMy, match.labelEn);
}
