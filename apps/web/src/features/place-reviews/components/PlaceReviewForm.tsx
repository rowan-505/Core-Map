import { useState } from 'react';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import {
  PLACE_REVIEW_BODY_MAX_LENGTH,
  PLACE_REVIEW_RATING_MAX,
  PLACE_REVIEW_RATING_MIN,
  PLACE_REVIEW_TITLE_MAX_LENGTH,
} from '../api/placeReviewsApiTypes';
import {
  placeReviewValidationMessage,
  validatePlaceReviewInput,
} from '../lib/validatePlaceReview';

export type PlaceReviewFormValues = {
  readonly rating: number;
  readonly title?: string;
  readonly body?: string;
};

type PlaceReviewFormProps = {
  readonly initialRating?: number | null;
  readonly initialTitle?: string | null;
  readonly initialBody?: string | null;
  readonly submitLabel: string;
  readonly pending?: boolean;
  readonly errorMessage?: string | null;
  readonly successMessage?: string | null;
  readonly noticeMessage?: string | null;
  readonly onCancel?: () => void;
  readonly onSubmit: (values: PlaceReviewFormValues) => void;
};

export function PlaceReviewForm({
  initialRating = null,
  initialTitle = null,
  initialBody = null,
  submitLabel,
  pending = false,
  errorMessage = null,
  successMessage = null,
  noticeMessage = null,
  onCancel,
  onSubmit,
}: PlaceReviewFormProps) {
  const t = useMapUiText();
  const [rating, setRating] = useState<number | null>(initialRating);
  const [title, setTitle] = useState(initialTitle ?? '');
  const [body, setBody] = useState(initialBody ?? '');
  const [localError, setLocalError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3 rounded-map-card border border-map-border/80 bg-map-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const validated = validatePlaceReviewInput({ rating, title, body });
        if (!validated.ok) {
          setLocalError(placeReviewValidationMessage(validated.errorKey, t));
          return;
        }
        setLocalError(null);
        onSubmit({
          rating: validated.rating,
          ...(validated.title ? { title: validated.title } : {}),
          ...(validated.body ? { body: validated.body } : {}),
        });
      }}
    >
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-semibold text-map-muted">
          {t('အဆင့်ပေးရန်', 'Rating')} *
        </legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('အဆင့်', 'Rating')}>
          {Array.from(
            { length: PLACE_REVIEW_RATING_MAX - PLACE_REVIEW_RATING_MIN + 1 },
            (_, index) => PLACE_REVIEW_RATING_MIN + index,
          ).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={rating === value}
              className={`min-h-10 min-w-10 rounded-map-control border px-2.5 text-sm font-semibold ${
                rating === value
                  ? 'border-map-primary bg-map-primary text-white'
                  : 'border-map-border bg-map-bg text-map-ink hover:border-map-primary/40 hover:bg-map-primary-soft'
              }`}
              onClick={() => setRating(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block space-y-1">
        <span className="text-xs font-semibold text-map-muted">
          {t('ခေါင်းစဉ် (ရွေးချယ်နိုင်)', 'Title (optional)')}
        </span>
        <input
          maxLength={PLACE_REVIEW_TITLE_MAX_LENGTH}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="w-full rounded-map-control border border-map-border bg-map-bg px-3 py-2 text-sm text-map-ink outline-none focus:border-map-primary/40 focus:ring-2 focus:ring-map-primary/15"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-semibold text-map-muted">
          {t('အကြောင်းအရာ (ရွေးချယ်နိုင်)', 'Review (optional)')}
        </span>
        <textarea
          maxLength={PLACE_REVIEW_BODY_MAX_LENGTH}
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className="w-full resize-y rounded-map-control border border-map-border bg-map-bg px-3 py-2 text-sm text-map-ink outline-none focus:border-map-primary/40 focus:ring-2 focus:ring-map-primary/15"
        />
      </label>

      {noticeMessage ? (
        <p className="rounded-map-control bg-amber-50 px-2.5 py-2 text-xs text-amber-800" role="status">
          {noticeMessage}
        </p>
      ) : null}
      {successMessage ? (
        <p className="rounded-map-control bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800" role="status">
          {successMessage}
        </p>
      ) : null}
      {localError || errorMessage ? (
        <p className="text-xs text-red-600" role="alert">{localError ?? errorMessage}</p>
      ) : null}

      <div className="flex gap-2">
        {onCancel ? (
          <button
            type="button"
            className="min-h-10 flex-1 rounded-map-control border border-map-border bg-map-bg px-3 text-sm font-semibold text-map-ink"
            disabled={pending}
            onClick={onCancel}
          >
            {t('ပယ်ဖျက်', 'Cancel')}
          </button>
        ) : null}
        <button
          type="submit"
          className="min-h-10 flex-1 rounded-map-control border border-map-primary bg-map-primary px-3 text-sm font-semibold text-white shadow-map-control disabled:opacity-55"
          disabled={pending}
        >
          {pending ? t('ပေးပို့နေသည်…', 'Submitting…') : submitLabel}
        </button>
      </div>
    </form>
  );
}
