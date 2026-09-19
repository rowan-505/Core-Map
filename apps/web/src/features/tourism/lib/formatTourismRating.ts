/**
 * Compact rating / review-count display for tourism cards.
 * Never shows an internal Bayesian ranking score.
 */

export type TourismRatingDisplay = {
  readonly ratingText: string | null;
  readonly countText: string;
  readonly showRating: boolean;
};

export function formatTourismRatingDisplay(input: {
  readonly averageRating: number | null;
  readonly publishedReviewCount: number;
  readonly t: (myanmar: string, english: string) => string;
}): TourismRatingDisplay {
  const count = Math.max(0, Math.floor(input.publishedReviewCount));
  const countText =
    count === 1
      ? input.t('သုံးသပ်ချက် ၁ ခု', '1 review')
      : input.t(`သုံးသပ်ချက် ${count} ခု`, `${count} reviews`);

  if (count <= 0 || input.averageRating === null || !Number.isFinite(input.averageRating)) {
    return {
      ratingText: null,
      countText: input.t('သုံးသပ်ချက် မရှိသေး', 'No reviews yet'),
      showRating: false,
    };
  }

  const rounded = Math.round(input.averageRating * 10) / 10;
  const ratingText = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);

  return {
    ratingText,
    countText,
    showRating: true,
  };
}

/** Compact one-line summary for list rows. */
export function formatTourismRatingSummary(input: {
  readonly averageRating: number | null;
  readonly publishedReviewCount: number;
  readonly t: (myanmar: string, english: string) => string;
}): string {
  const display = formatTourismRatingDisplay(input);
  if (!display.showRating || !display.ratingText) {
    return display.countText;
  }
  return `${display.ratingText} · ${display.countText}`;
}
