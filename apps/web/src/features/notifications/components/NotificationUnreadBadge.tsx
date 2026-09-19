import { useMapUiText } from '@/features/map/i18n/mapUiText';
import {
  formatUnreadBadgeCount,
  unreadNotificationsAriaLabel,
} from '../lib/unreadBadge';

type NotificationUnreadBadgeProps = {
  readonly count: number;
  /** Extra classes for positioning (absolute corner of a button). */
  readonly className?: string;
};

/** Compact unread pill. Renders nothing when count is zero. */
export function NotificationUnreadBadge({
  count,
  className = '',
}: NotificationUnreadBadgeProps) {
  const t = useMapUiText();
  const label = formatUnreadBadgeCount(count);
  if (!label) return null;

  return (
    <span
      className={`inline-flex min-w-4.5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white ring-2 ring-white ${className}`}
      aria-label={unreadNotificationsAriaLabel(count, t)}
    >
      {label}
    </span>
  );
}
