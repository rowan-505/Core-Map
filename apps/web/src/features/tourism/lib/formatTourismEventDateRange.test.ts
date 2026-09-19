import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatTourismEventDateRange } from './formatTourismEventDateRange';

describe('formatTourismEventDateRange', () => {
  it('formats a short 2-day event as Nov 5–6', () => {
    assert.equal(
      formatTourismEventDateRange('2026-11-05T00:00:00.000Z', '2026-11-06T23:59:59.000Z'),
      'Nov 5–6',
    );
  });

  it('formats a long same-year span as May 1 – Jun 30', () => {
    assert.equal(
      formatTourismEventDateRange('2026-05-01T00:00:00.000Z', '2026-06-30T00:00:00.000Z'),
      'May 1 – Jun 30',
    );
  });

  it('formats a cross-year span as Dec 28 – Jan 5', () => {
    assert.equal(
      formatTourismEventDateRange('2026-12-28T00:00:00.000Z', '2027-01-05T00:00:00.000Z'),
      'Dec 28 – Jan 5',
    );
  });
});
