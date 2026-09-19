/**
 * Unread badge display helpers (no React).
 * Hidden at zero; 1–99 as digits; 99+ above 99.
 */

export function formatUnreadBadgeCount(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (count > 99) return '99+';
  return String(Math.floor(count));
}

export function unreadNotificationsAriaLabel(
  count: number,
  t: (myanmar: string, english: string) => string,
): string {
  if (!Number.isFinite(count) || count <= 0) {
    return t('အသိပေးချက်များ', 'Notifications');
  }
  if (count > 99) {
    return t('မဖတ်ရသေးသော အသိပေးချက် ၉၉+', '99+ unread notifications');
  }
  const n = Math.floor(count);
  return t(
    `မဖတ်ရသေးသော အသိပေးချက် ${n} ခု`,
    `${n} unread notification${n === 1 ? '' : 's'}`,
  );
}
