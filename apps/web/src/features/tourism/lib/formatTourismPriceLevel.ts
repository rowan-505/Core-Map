export function formatTourismPriceLevel(
  priceLevel: number | null,
  t: (myanmar: string, english: string) => string,
): string | null {
  if (priceLevel === null || !Number.isFinite(priceLevel)) return null;
  const level = Math.floor(priceLevel);
  if (level === 0) return t('အခမဲ့', 'Free');
  if (level < 1 || level > 4) return null;
  return '$'.repeat(level);
}
