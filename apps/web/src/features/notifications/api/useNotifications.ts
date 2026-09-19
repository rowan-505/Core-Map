import { useEffect, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '@/features/auth/state/useAuth';
import { hasStoredSession } from '@/features/auth/lib/tokenStorage';
import {
  getNotificationsUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './notificationsApi';

export const notificationsListQueryKey = (unreadOnly: boolean) =>
  ['notifications', 'list', unreadOnly ? 'unread' : 'all'] as const;

export const notificationsUnreadCountQueryKey = ['notifications', 'unread-count'] as const;

const UNREAD_POLL_MS = 90_000;

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    window.addEventListener('focus', onChange);
    return () => {
      document.removeEventListener('visibilitychange', onChange);
      window.removeEventListener('focus', onChange);
    };
  }, []);

  return visible;
}

/** Unread count — polls every 90s only while signed in and the page is visible. */
export function useNotificationsUnreadCount() {
  const { isAuthenticated, initializing } = useAuth();
  const pageVisible = useDocumentVisible();
  // `user` and the in-memory token are cleared through separate subscriptions.
  // Requiring both prevents a protected request during that short transition.
  const enabled = isAuthenticated && !initializing && hasStoredSession();

  return useQuery({
    queryKey: notificationsUnreadCountQueryKey,
    enabled,
    queryFn: ({ signal }) => getNotificationsUnreadCount(signal),
    refetchOnWindowFocus: true,
    refetchInterval: enabled && pageVisible ? UNREAD_POLL_MS : false,
    refetchIntervalInBackground: false,
    staleTime: 15_000,
  });
}

export function useNotificationsFeed(options: {
  readonly unreadOnly: boolean;
  readonly enabled: boolean;
}) {
  return useInfiniteQuery({
    queryKey: notificationsListQueryKey(options.unreadOnly),
    enabled: options.enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listNotifications(
        {
          cursor: pageParam,
          limit: 20,
          unreadOnly: options.unreadOnly || undefined,
        },
        signal,
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (publicId: string) => markNotificationRead(publicId),
    onSuccess: () => {
      queryClient.setQueryData(
        notificationsUnreadCountQueryKey,
        (prev: { unread_count: number } | undefined) => {
          if (!prev) return prev;
          return { unread_count: Math.max(0, prev.unread_count - 1) };
        },
      );
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      queryClient.setQueryData(notificationsUnreadCountQueryKey, { unread_count: 0 });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/** Call after community actions that may create notifications for the viewer. */
export function invalidateNotificationsQueries(
  queryClient: ReturnType<typeof useQueryClient>,
): void {
  void queryClient.invalidateQueries({ queryKey: ['notifications'] });
}
