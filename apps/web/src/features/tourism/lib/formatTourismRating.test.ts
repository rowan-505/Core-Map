import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatTourismRatingDisplay,
  formatTourismRatingSummary,
} from './formatTourismRating.ts';

const t = (my: string, en: string) => en;

describe('formatTourismRating', () => {
  it('shows compact rating and review count', () => {
    const display = formatTourismRatingDisplay({
      averageRating: 4.56,
      publishedReviewCount: 12,
      t,
    });
    assert.equal(display.showRating, true);
    assert.equal(display.ratingText, '4.6');
    assert.equal(display.countText, '12 reviews');
    assert.equal(
      formatTourismRatingSummary({
        averageRating: 4.56,
        publishedReviewCount: 12,
        t,
      }),
      '4.6 · 12 reviews',
    );
  });

  it('hides rating when review count is zero', () => {
    const display = formatTourismRatingDisplay({
      averageRating: null,
      publishedReviewCount: 0,
      t,
    });
    assert.equal(display.showRating, false);
    assert.equal(display.ratingText, null);
    assert.match(display.countText, /No reviews/);
  });

  it('never exposes an internal ranking score field', () => {
    const summary = formatTourismRatingSummary({
      averageRating: 4,
      publishedReviewCount: 3,
      t,
    });
    assert.equal(summary.includes('score'), false);
    assert.equal(summary.includes('bayesian'), false);
    assert.equal(summary, '4 · 3 reviews');
  });
});
