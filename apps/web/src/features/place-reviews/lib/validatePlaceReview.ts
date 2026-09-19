import {
  PLACE_REVIEW_BODY_MAX_LENGTH,
  PLACE_REVIEW_RATING_MAX,
  PLACE_REVIEW_RATING_MIN,
  PLACE_REVIEW_TITLE_MAX_LENGTH,
} from '../api/placeReviewsApiTypes';

export type PlaceReviewFormInput = {
  readonly rating: number | null;
  readonly title: string;
  readonly body: string;
};

export type PlaceReviewValidationErrorKey =
  | 'rating_required'
  | 'rating_range'
  | 'title_too_long'
  | 'body_too_long';

export type PlaceReviewValidationResult =
  | { readonly ok: true; readonly rating: number; readonly title?: string; readonly body?: string }
  | { readonly ok: false; readonly errorKey: PlaceReviewValidationErrorKey };

export function validatePlaceReviewInput(
  input: PlaceReviewFormInput,
): PlaceReviewValidationResult {
  if (input.rating === null || input.rating === undefined || Number.isNaN(input.rating)) {
    return { ok: false, errorKey: 'rating_required' };
  }
  const rating = Math.floor(input.rating);
  if (rating < PLACE_REVIEW_RATING_MIN || rating > PLACE_REVIEW_RATING_MAX) {
    return { ok: false, errorKey: 'rating_range' };
  }
  const title = input.title.trim();
  if (title.length > PLACE_REVIEW_TITLE_MAX_LENGTH) {
    return { ok: false, errorKey: 'title_too_long' };
  }
  const body = input.body.trim();
  if (body.length > PLACE_REVIEW_BODY_MAX_LENGTH) {
    return { ok: false, errorKey: 'body_too_long' };
  }
  return {
    ok: true,
    rating,
    ...(title ? { title } : {}),
    ...(body ? { body } : {}),
  };
}

export function placeReviewValidationMessage(
  key: PlaceReviewValidationErrorKey,
  t: (myanmar: string, english: string) => string,
): string {
  switch (key) {
    case 'rating_required': return t('အဆင့်ပေးရန် လိုအပ်သည်။', 'Rating is required.');
    case 'rating_range': return t('အဆင့်သည် ၁ မှ ၅ အထိ ဖြစ်ရမည်။', 'Rating must be between 1 and 5.');
    case 'title_too_long': return t('ခေါင်းစဉ် ရှည်လွန်းသည်။', 'Title is too long.');
    case 'body_too_long': return t('အကြောင်းအရာ ရှည်လွန်းသည်။', 'Review text is too long.');
    default: return t('မမှန်ကန်ပါ', 'Invalid input');
  }
}

export function isDuplicatePlaceReviewError(error: {
  readonly status?: number;
  readonly message?: string;
}): boolean {
  if (error.status === 409) return true;
  return (error.message ?? '').toLowerCase().includes('already have a review');
}
