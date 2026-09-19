/** Minimal Community post categories for V2 web create/edit. */

export const COMMUNITY_CATEGORIES = [
  { code: 'local_update', labelMy: 'ဒေသသတင်း', labelEn: 'Local Update' },
  { code: 'transport', labelMy: 'သယ်ယူပို့ဆောင်ရေး', labelEn: 'Transport' },
  { code: 'road_and_access', labelMy: 'လမ်းနှင့် ဝင်ထွက်', labelEn: 'Road and Access' },
  { code: 'public_service', labelMy: 'အများပြည်သူ ဝန်ဆောင်မှု', labelEn: 'Public Service' },
  { code: 'safety', labelMy: 'လုံခြုံရေး', labelEn: 'Safety' },
  { code: 'event', labelMy: 'ပွဲ/အစီအစဉ်', labelEn: 'Event' },
  { code: 'business', labelMy: 'စီးပွားရေး', labelEn: 'Business' },
  { code: 'other', labelMy: 'အခြား', labelEn: 'Other' },
] as const;

export type CommunityCategoryCode = (typeof COMMUNITY_CATEGORIES)[number]['code'];

const CODE_SET = new Set<string>(COMMUNITY_CATEGORIES.map((c) => c.code));

export function isCommunityCategoryCode(value: string): value is CommunityCategoryCode {
  return CODE_SET.has(value);
}

export function communityCategoryLabel(
  code: string,
  t: (myanmar: string, english: string) => string,
): string {
  const match = COMMUNITY_CATEGORIES.find((c) => c.code === code);
  if (!match) return code;
  return t(match.labelMy, match.labelEn);
}
