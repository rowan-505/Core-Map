import { tourismTypeFilterLabel } from '../lib/tourismTypes';
import { formatTourismRatingSummary } from '../lib/formatTourismRating';
import { TOURISM_PLACE_CARD_CLASS } from '../lib/tourismListState';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import type { TourismRankedPlace } from '../api/tourismApi';

type TourismPlaceCardProps = {
  readonly place: TourismRankedPlace;
  readonly selected?: boolean;
  readonly onSelect: (publicId: string) => void;
  readonly rank?: number | null;
};

export function TourismPlaceCard({
  place,
  selected = false,
  onSelect,
  rank = null,
}: TourismPlaceCardProps) {
  const t = useMapUiText();
  const ratingSummary = formatTourismRatingSummary({
    averageRating: place.average_rating,
    publishedReviewCount: place.published_review_count,
    t,
  });
  const typeLabel = tourismTypeFilterLabel(place.tourism_type, t);
  const distanceText =
    typeof place.distance_meters === 'number' && Number.isFinite(place.distance_meters)
      ? formatDistanceMeters(place.distance_meters, t)
      : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(place.public_id)}
      className={`${TOURISM_PLACE_CARD_CLASS} ${
        selected
          ? 'border-map-primary/40 bg-map-primary-soft/70 ring-1 ring-map-primary/20'
          : 'border-map-border bg-map-surface hover:border-map-primary/25 hover:bg-map-primary-soft/40'
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {typeof rank === 'number' ? (
          <span className="rounded-md bg-map-primary px-1.5 py-0.5 text-[11px] font-semibold text-white">
            #{rank}
          </span>
        ) : null}
        <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600">
          {typeLabel}
        </span>
        {place.editor_pick ? (
          <span className="rounded-md bg-map-primary-soft px-1.5 py-0.5 text-[11px] font-medium text-map-primary">
            {t('CoreMap အထူးရွေးချယ်မှု', 'Featured by CoreMap')}
          </span>
        ) : null}
        {place.is_verified ? (
          <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
            {t('စစ်ဆေးပြီး', 'Verified')}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-5 text-map-ink">
        {place.name}
      </p>
      {place.short_description ? (
        <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-map-muted">
          {place.short_description}
        </p>
      ) : null}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-map-muted">
        <span className="truncate tabular-nums" data-testid="tourism-rating-summary">
          {ratingSummary}
        </span>
        {distanceText ? (
          <span className="shrink-0 tabular-nums">{distanceText}</span>
        ) : null}
      </div>
    </button>
  );
}

function formatDistanceMeters(
  meters: number,
  t: (myanmar: string, english: string) => string,
): string {
  if (meters < 1000) {
    return t(`${Math.round(meters)} မီတာ`, `${Math.round(meters)} m`);
  }
  const km = Math.round((meters / 1000) * 10) / 10;
  return t(`${km} ကီလိုမီတာ`, `${km} km`);
}
