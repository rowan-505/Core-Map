import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatUnreadBadgeCount,
  unreadNotificationsAriaLabel,
} from './unreadBadge.ts';

describe('formatUnreadBadgeCount', () => {
  it('hides zero and negative counts', () => {
    assert.equal(formatUnreadBadgeCount(0), null);
    assert.equal(formatUnreadBadgeCount(-1), null);
  });

  it('shows 1–99 as digits', () => {
    assert.equal(formatUnreadBadgeCount(1), '1');
    assert.equal(formatUnreadBadgeCount(99), '99');
  });

  it('caps display at 99+', () => {
    assert.equal(formatUnreadBadgeCount(100), '99+');
    assert.equal(formatUnreadBadgeCount(1000), '99+');
  });
});

describe('unreadNotificationsAriaLabel', () => {
  const t = (_my: string, en: string) => en;

  it('uses a generic label when there are no unread items', () => {
    assert.equal(unreadNotificationsAriaLabel(0, t), 'Notifications');
  });

  it('includes the count for accessible unread state', () => {
    assert.equal(unreadNotificationsAriaLabel(1, t), '1 unread notification');
    assert.equal(unreadNotificationsAriaLabel(3, t), '3 unread notifications');
    assert.equal(unreadNotificationsAriaLabel(120, t), '99+ unread notifications');
  });
});
