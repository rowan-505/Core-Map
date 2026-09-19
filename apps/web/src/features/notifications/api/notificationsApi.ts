/**
 * Authenticated notifications API for the public web app.
 */
import { authJson } from '@/features/auth/api/http';

export type NotificationType =
  | 'post_reaction'
  | 'post_community_confirmed'
  | 'post_admin_verified'
  | 'post_resolved'
  | 'post_reopened'
  | 'post_rejected'
  | 'post_expired'
  | 'moderation_message';

export type NotificationActor = {
  readonly public_id: string;
  readonly display_name: string;
};

export type NotificationRelatedPost = {
  readonly public_id: string;
  readonly title: string | null;
  readonly available: boolean;
};

export type NotificationItem = {
  readonly public_id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly message: string;
  readonly reaction_type: 'confirm' | 'helpful' | 'incorrect' | null;
  readonly is_read: boolean;
  readonly created_at: string;
  readonly actor: NotificationActor | null;
  readonly related_post: NotificationRelatedPost | null;
};

export type NotificationPage = {
  readonly items: readonly NotificationItem[];
  readonly next_cursor: string | null;
};

export type NotificationsListQuery = {
  readonly cursor?: string;
  readonly limit?: number;
  readonly unreadOnly?: boolean;
};

function buildListQuery(query: NotificationsListQuery): string {
  const params = new URLSearchParams();
  if (query.cursor) params.set('cursor', query.cursor);
  if (typeof query.limit === 'number') params.set('limit', String(query.limit));
  if (query.unreadOnly) params.set('unreadOnly', 'true');
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function listNotifications(
  query: NotificationsListQuery = {},
  signal?: AbortSignal,
): Promise<NotificationPage> {
  return authJson<NotificationPage>(`/notifications${buildListQuery(query)}`, { signal });
}

export async function getNotificationsUnreadCount(
  signal?: AbortSignal,
): Promise<{ unread_count: number }> {
  return authJson<{ unread_count: number }>('/notifications/unread-count', { signal });
}

export async function markNotificationRead(
  publicId: string,
): Promise<{ public_id: string; is_read: true }> {
  return authJson<{ public_id: string; is_read: true }>(
    `/notifications/${encodeURIComponent(publicId)}/read`,
    { method: 'PATCH' },
  );
}

export async function markAllNotificationsRead(): Promise<{ updated_count: number }> {
  return authJson<{ updated_count: number }>('/notifications/read-all', {
    method: 'POST',
  });
}
