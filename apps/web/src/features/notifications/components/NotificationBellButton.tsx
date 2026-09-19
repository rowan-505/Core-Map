import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { useNotificationsUnreadCount } from '../api/useNotifications';
import { unreadNotificationsAriaLabel } from '../lib/unreadBadge';
import { NotificationUnreadBadge } from './NotificationUnreadBadge';

type NotificationBellButtonProps = {
  readonly active?: boolean;
  readonly onOpen: () => void;
  /** When true, only render on viewports below the `lg` breakpoint. */
  readonly mobileOnly?: boolean;
  /** When true, only render at `lg` and above. */
  readonly desktopOnly?: boolean;
};

export function NotificationBellButton({
  active = false,
  onOpen,
  mobileOnly = false,
  desktopOnly = false,
}: NotificationBellButtonProps) {
  const t = useMapUiText();
  const unreadQuery = useNotificationsUnreadCount();
  const count = unreadQuery.data?.unread_count ?? 0;
  const aria = unreadNotificationsAriaLabel(count, t);

  const visibilityClass = mobileOnly
    ? 'lg:hidden'
    : desktopOnly
      ? 'hidden lg:grid'
      : '';

  return (
    <button
      type="button"
      className={`relative grid h-11 w-11 place-items-center rounded-map-control border border-white/90 bg-white/96 text-map-ink shadow-map-control backdrop-blur-xl transition-colors duration-150 hover:border-map-primary/25 hover:bg-map-primary-soft hover:text-map-primary ${
        active ? 'border-map-primary/30 bg-map-primary-soft text-map-primary hover:bg-map-primary-soft hover:text-map-primary' : ''
      } ${visibilityClass}`}
      aria-label={aria}
      title={t('အသိပေးချက်များ', 'Notifications')}
      aria-current={active ? 'page' : undefined}
      onClick={onOpen}
    >
      <BellIcon />
      <NotificationUnreadBadge
        count={count}
        className="absolute -right-0.5 -top-0.5"
      />
    </button>
  );
}

function BellIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5a5 5 0 0 0-5 5v1.8c0 .7-.2 1.4-.6 2L5.2 14.6c-.5.7 0 1.7.9 1.7h11.8c.9 0 1.4-1 .9-1.7l-1.2-2.3c-.4-.6-.6-1.3-.6-2V8.5a5 5 0 0 0-5-5Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path
        d="M10 18.2a2.2 2.2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}
