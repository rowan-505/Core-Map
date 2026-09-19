import { useMemo, useState } from 'react';
import { useAuth } from '@/features/auth/state/useAuth';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { ListSkeleton, PanelEmptyState, SegmentedTabs } from '@/components/ui/sidebarUi';
import type { NotificationItem } from '../api/notificationsApi';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsFeed,
} from '../api/useNotifications';

type NotificationsTab = 'all' | 'unread';

type NotificationsPanelProps = {
  readonly onOpenCommunityPost: (publicId: string) => void;
};

export function NotificationsPanel({ onOpenCommunityPost }: NotificationsPanelProps) {
  const t = useMapUiText();
  const { isAuthenticated, openAuthModal } = useAuth();
  const [tab, setTab] = useState<NotificationsTab>('all');
  const [unavailableMessage, setUnavailableMessage] = useState<string | null>(null);

  const feedQuery = useNotificationsFeed({
    unreadOnly: tab === 'unread',
    enabled: isAuthenticated,
  });
  const markOne = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const items = useMemo(
    () => feedQuery.data?.pages.flatMap((page) => [...page.items]) ?? [],
    [feedQuery.data],
  );
  const grouped = useMemo(() => groupNotifications(items), [items]);

  if (!isAuthenticated) {
    return (
      <PanelEmptyState
        title={t('အသိပေးချက်များကို ကြည့်ရန် အကောင့်ဝင်ပါ။', 'Sign in to view your notifications.')}
        action={
          <button
            type="button"
            className="rounded-map-control bg-map-primary px-4 py-2 text-sm font-semibold text-white"
            onClick={() => openAuthModal('login')}
          >
            {t('အကောင့်ဝင်ရန်', 'Sign in')}
          </button>
        }
      />
    );
  }

  return (
    <section className="flex min-h-0 flex-col" aria-label={t('အသိပေးချက်များ', 'Notifications')}>
      <div className="sticky top-0 z-10 space-y-2 border-b border-map-border/70 bg-map-surface px-4 py-3">
        <SegmentedTabs
          label={t('အသိပေးချက် စစ်ထုတ်ရန်', 'Notification filters')}
          value={tab}
          onChange={(id) => {
            setTab(id);
            setUnavailableMessage(null);
          }}
          items={[
            { id: 'all', label: t('အားလုံး', 'All') },
            { id: 'unread', label: t('မဖတ်ရသေး', 'Unread') },
          ]}
        />
        <button
          type="button"
          className="min-h-10 w-full rounded-map-control px-2 text-sm font-semibold text-map-muted hover:bg-map-bg hover:text-map-ink disabled:opacity-50"
          disabled={markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          {markAll.isPending
            ? t('လုပ်ဆောင်နေသည်…', 'Working…')
            : t('အားလုံးကို ဖတ်ပြီးဟု မှတ်ရန်', 'Mark all as read')}
        </button>
      </div>

      {unavailableMessage ? (
        <div className="mx-4 mt-3 rounded-map-control bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          {unavailableMessage}
        </div>
      ) : null}

      {feedQuery.isLoading ? (
        <ListSkeleton rows={5} />
      ) : feedQuery.isError ? (
        <PanelEmptyState
          tone="error"
          title={t('အသိပေးချက်များ မရရှိနိုင်ပါ', 'Notifications unavailable')}
        />
      ) : items.length === 0 ? (
        <PanelEmptyState
          title={
            tab === 'unread'
              ? t('မဖတ်ရသေးသော အသိပေးချက် မရှိပါ', 'No unread notifications')
              : t('အသိပေးချက် မရှိသေးပါ', 'No notifications yet')
          }
          body={t(
            'Community တုံ့ပြန်မှုနှင့် အတည်ပြုချက်များ ဤနေရာတွင် ပေါ်မည်။',
            'Community reactions and verification updates will appear here.',
          )}
        />
      ) : (
        <div>
          {grouped.today.length > 0 ? (
            <NotificationGroup
              title={t('ယနေ့', 'Today')}
              items={grouped.today}
              pending={markOne.isPending}
              onActivate={(item) =>
                activateNotification(item, {
                  markOne,
                  setUnavailableMessage,
                  onOpenCommunityPost,
                  t,
                })
              }
            />
          ) : null}
          {grouped.earlier.length > 0 ? (
            <NotificationGroup
              title={t('ယခင်', 'Earlier')}
              items={grouped.earlier}
              pending={markOne.isPending}
              onActivate={(item) =>
                activateNotification(item, {
                  markOne,
                  setUnavailableMessage,
                  onOpenCommunityPost,
                  t,
                })
              }
            />
          ) : null}
          {feedQuery.hasNextPage ? (
            <div className="px-4 py-3">
              <button
                type="button"
                className="w-full rounded-map-control border border-map-border bg-map-surface px-3 py-2 text-sm font-semibold text-map-ink hover:bg-map-primary-soft disabled:opacity-50"
                disabled={feedQuery.isFetchingNextPage}
                onClick={() => {
                  void feedQuery.fetchNextPage();
                }}
              >
                {feedQuery.isFetchingNextPage
                  ? t('ဖွင့်နေသည်…', 'Loading…')
                  : t('နောက်ထပ် ကြည့်ရန်', 'Load more')}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function NotificationGroup({
  title,
  items,
  pending,
  onActivate,
}: {
  readonly title: string;
  readonly items: readonly NotificationItem[];
  readonly pending: boolean;
  readonly onActivate: (item: NotificationItem) => void;
}) {
  return (
    <div>
      <h2 className="px-4 pb-1 pt-4 text-[13px] font-semibold text-map-muted">{title}</h2>
      <ul className="divide-y divide-map-border/70">
        {items.map((item) => (
          <li key={item.public_id}>
            <NotificationRow item={item} pending={pending} onActivate={() => onActivate(item)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotificationRow({
  item,
  pending,
  onActivate,
}: {
  readonly item: NotificationItem;
  readonly pending: boolean;
  readonly onActivate: () => void;
}) {
  const t = useMapUiText();
  const relatedUnavailable = item.related_post !== null && !item.related_post.available;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={onActivate}
      className={`flex min-h-16 w-full gap-3 px-4 py-3 text-left transition-colors duration-150 ${
        item.is_read ? 'hover:bg-map-bg' : 'bg-map-primary-soft/40 hover:bg-map-primary-soft/70'
      }`}
    >
      <span className="mt-2 h-2 w-2 shrink-0 rounded-full">
        {!item.is_read ? (
          <span className="block h-2 w-2 rounded-full bg-map-primary" aria-hidden="true" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="map-clamp-1 block text-[15px] font-medium text-map-ink">{item.title}</span>
        <span className="map-clamp-2 mt-0.5 block text-xs leading-5 text-map-muted">{item.message}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-map-muted">
          <span className="tabular-nums">{formatShortDate(item.created_at)}</span>
          {item.actor ? <span className="truncate">{item.actor.display_name}</span> : null}
          {relatedUnavailable ? (
            <span className="font-medium text-amber-700">
              {t('ပို့စ် မရရှိနိုင်', 'Post unavailable')}
            </span>
          ) : item.related_post?.title ? (
            <span className="truncate">{item.related_post.title}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function groupNotifications(items: readonly NotificationItem[]): {
  readonly today: NotificationItem[];
  readonly earlier: NotificationItem[];
} {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today: NotificationItem[] = [];
  const earlier: NotificationItem[] = [];
  for (const item of items) {
    const created = new Date(item.created_at);
    if (!Number.isNaN(created.getTime()) && created >= startOfToday) {
      today.push(item);
    } else {
      earlier.push(item);
    }
  }
  return { today, earlier };
}

function activateNotification(
  item: NotificationItem,
  options: {
    readonly markOne: { mutate: (id: string) => void };
    readonly setUnavailableMessage: (message: string | null) => void;
    readonly onOpenCommunityPost: (publicId: string) => void;
    readonly t: (myanmar: string, english: string) => string;
  },
): void {
  if (!item.is_read) {
    options.markOne.mutate(item.public_id);
  }
  const related = item.related_post;
  if (!related) {
    options.setUnavailableMessage(
      options.t('ဆက်စပ် ပို့စ် မရှိပါ။', 'This notification has no related post.'),
    );
    return;
  }
  if (!related.available) {
    options.setUnavailableMessage(
      options.t(
        'ဤပို့စ်ကို ကြည့်၍မရတော့ပါ (ဖယ်ရှားထားခြင်း သို့မဟုတ် မရရှိနိုင်ခြင်း)။',
        'This post is unavailable or was removed.',
      ),
    );
    return;
  }
  options.setUnavailableMessage(null);
  options.onOpenCommunityPost(related.public_id);
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
