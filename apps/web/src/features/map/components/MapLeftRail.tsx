import type { ReactNode } from 'react';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { useNotificationsUnreadCount } from '@/features/notifications/api/useNotifications';
import { NotificationUnreadBadge } from '@/features/notifications/components/NotificationUnreadBadge';
import { unreadNotificationsAriaLabel } from '@/features/notifications/lib/unreadBadge';
import type { SidebarMode } from './MapSidebar';

type RailMode = Extract<
  SidebarMode,
  'search' | 'route' | 'saved' | 'community' | 'tourism' | 'notifications' | 'more'
>;

type MapLeftRailProps = {
  readonly activeMode: SidebarMode;
  readonly onModeChange: (mode: RailMode) => void;
  /** Account control (sign-in / profile). Pinned to the end of the rail. */
  readonly accountSlot?: ReactNode;
};

const RAIL_ITEMS: readonly {
  readonly mode: RailMode;
  readonly labelMy: string;
  readonly labelEn: string;
  readonly icon: ReactNode;
  /** Desktop-only: keep the mobile top rail uncluttered. */
  readonly desktopOnly?: boolean;
}[] = [
  { mode: 'search', labelMy: 'ရှာဖွေရန်', labelEn: 'Search', icon: <SearchIcon /> },
  { mode: 'route', labelMy: 'လမ်းညွှန်', labelEn: 'Directions', icon: <RouteIcon /> },
  { mode: 'saved', labelMy: 'သိမ်းထားသည်', labelEn: 'Saved', icon: <SavedIcon /> },
  {
    mode: 'community',
    labelMy: 'လူမှုအသိုင်းအဝိုင်း',
    labelEn: 'Community',
    icon: <CommunityIcon />,
    desktopOnly: true,
  },
  {
    mode: 'tourism',
    labelMy: 'ခရီးသွား',
    labelEn: 'Tourism',
    icon: <TourismIcon />,
    desktopOnly: true,
  },
  {
    mode: 'notifications',
    labelMy: 'အသိပေးချက်များ',
    labelEn: 'Notifications',
    icon: <NotificationsIcon />,
    desktopOnly: true,
  },
  { mode: 'more', labelMy: 'နောက်ထပ်', labelEn: 'More', icon: <MoreIcon /> },
];

export function MapLeftRail({ activeMode, onModeChange, accountSlot }: MapLeftRailProps) {
  const t = useMapUiText();
  const unreadQuery = useNotificationsUnreadCount();
  const unreadCount = unreadQuery.data?.unread_count ?? 0;

  return (
    <nav
      className="pointer-events-auto absolute left-3 top-3 z-40 flex w-auto gap-1 rounded-map-card border border-map-border/80 bg-map-surface/96 p-1 shadow-map-control lg:bottom-0 lg:left-0 lg:top-0 lg:w-16 lg:flex-col lg:items-center lg:rounded-none lg:border-0 lg:border-r lg:border-map-border lg:bg-map-surface lg:px-2 lg:py-3 lg:shadow-none lg:pt-[max(0.75rem,env(safe-area-inset-top))] lg:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      aria-label={t('မြေပုံလမ်းညွှန်', 'Map navigation')}
    >
      <div
        className="hidden h-10 w-10 place-items-center rounded-map-control bg-map-primary-soft text-sm font-bold tracking-tight text-map-primary lg:grid"
        aria-hidden="true"
      >
        CM
      </div>
      <div className="flex gap-1 lg:mt-3 lg:min-h-0 lg:flex-1 lg:flex-col lg:items-center">
        {RAIL_ITEMS.map((item) => {
          const active = isRailItemActive(activeMode, item.mode);
          const baseLabel = t(item.labelMy, item.labelEn);
          const label =
            item.mode === 'notifications'
              ? unreadNotificationsAriaLabel(unreadCount, t)
              : baseLabel;

          return (
            <button
              type="button"
              key={item.mode}
              className={`map-rail-tip group relative grid h-11 w-11 place-items-center rounded-map-control transition-colors duration-150 ${
                item.desktopOnly ? 'max-lg:hidden lg:grid' : ''
              } ${
                active
                  ? 'bg-map-primary-soft text-map-primary'
                  : 'text-map-muted hover:bg-map-bg hover:text-map-ink'
              }`}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              title={baseLabel}
              data-tooltip={baseLabel}
              onClick={() => onModeChange(item.mode)}
            >
              {item.icon}
              {item.mode === 'notifications' ? (
                <NotificationUnreadBadge
                  count={unreadCount}
                  className="absolute -right-0.5 -top-0.5"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      {accountSlot ? (
        <div className="flex items-center lg:mt-auto lg:flex-col lg:border-t lg:border-map-border lg:pt-2">
          {accountSlot}
        </div>
      ) : null}
    </nav>
  );
}

function isRailItemActive(activeMode: SidebarMode, itemMode: RailMode): boolean {
  if (itemMode === 'search') {
    return (
      activeMode === 'search' ||
      activeMode === 'placeDetail' ||
      activeMode === 'transportStopDetail' ||
      activeMode === 'address'
    );
  }

  return activeMode === itemMode;
}

function SearchIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10.8 17.1a6.3 6.3 0 1 0 0-12.6 6.3 6.3 0 0 0 0 12.6Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="m15.3 15.3 4.2 4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function RouteIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 17.5c3.7 0 2.2-11 7-11h2.7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m14.8 3.8 3 2.7-3 2.7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.8 20.2a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4Z"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path
        d="M7 5.8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path
        d="M7 7.8v2.7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SavedIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 5.5A2.5 2.5 0 0 1 9.5 3h5A2.5 2.5 0 0 1 17 5.5v15L12 17l-5 3.5v-15Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CommunityIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M15.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M4.5 19.2c.6-2.4 2.5-3.7 4-3.7s3.4 1.3 4 3.7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M11.5 19.2c.6-2.4 2.5-3.7 4-3.7s3.4 1.3 4 3.7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TourismIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21s-6.5-4.8-6.5-10A6.5 6.5 0 0 1 12 4.5 6.5 6.5 0 0 1 18.5 11c0 5.2-6.5 10-6.5 10Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path
        d="M12 13.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
        stroke="currentColor"
        strokeWidth="1.9"
      />
    </svg>
  );
}

function NotificationsIcon() {
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

function MoreIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12h.01M12 12h.01M19 12h.01"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
