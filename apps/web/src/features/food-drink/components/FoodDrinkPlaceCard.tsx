import { useMapUiText } from '@/features/map/i18n/mapUiText';
import type { FoodDrinkRankedPlace } from '../api/foodDrinkApi';

type FoodDrinkPlaceCardProps = {
  readonly place: FoodDrinkRankedPlace;
  readonly selected?: boolean;
  readonly onSelect: (publicId: string) => void;
  readonly onDirections: (place: FoodDrinkRankedPlace) => void;
  readonly onOpenDetail: (publicId: string) => void;
};

export function FoodDrinkPlaceCard({
  place,
  selected = false,
  onSelect,
  onDirections,
  onOpenDetail,
}: FoodDrinkPlaceCardProps) {
  const t = useMapUiText();
  const ratingText = formatRating(place, t);
  const distanceText =
    typeof place.distance_meters === 'number' && Number.isFinite(place.distance_meters)
      ? formatDistanceMeters(place.distance_meters, t)
      : null;
  const categoryLabel =
    t(place.category_name_mm ?? place.category_name, place.category_name) || place.category_code;

  return (
    <article
      className={`rounded-map-card border p-3 text-left shadow-map-card transition-[color,background-color,border-color] duration-150 ${
        selected
          ? 'border-map-primary/40 bg-map-primary-soft/70 ring-1 ring-map-primary/20'
          : 'border-map-border bg-map-surface hover:border-map-primary/25 hover:bg-map-primary-soft/40'
      }`}
    >
      <button type="button" className="w-full text-left" onClick={() => onSelect(place.public_id)}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-map-primary px-1.5 py-0.5 text-[11px] font-semibold text-white">
            #{place.rank}
          </span>
          <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600">
            {categoryLabel}
          </span>
        </div>
        <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-5 text-map-ink">
          {place.name}
        </p>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-map-muted">
          <span className="truncate tabular-nums">{ratingText}</span>
          {distanceText ? <span className="shrink-0 tabular-nums">{distanceText}</span> : null}
        </div>
      </button>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          className="min-h-9 rounded-map-control border border-map-border bg-map-surface px-2 text-xs font-semibold text-map-ink hover:border-map-primary/40 hover:bg-map-primary-soft"
          onClick={() => onDirections(place)}
        >
          {t('လမ်းကြောင်း', 'Directions')}
        </button>
        <button
          type="button"
          className="min-h-9 rounded-map-control border border-map-primary/30 bg-map-primary-soft px-2 text-xs font-semibold text-map-primary hover:bg-blue-100"
          onClick={() => onOpenDetail(place.public_id)}
        >
          {t('သိမ်းရန် / အသေးစိတ်', 'Save / Detail')}
        </button>
      </div>
    </article>
  );
}

function formatRating(
  place: FoodDrinkRankedPlace,
  t: (myanmar: string, english: string) => string,
): string {
  if (place.published_review_count <= 0 || place.average_rating == null) {
    return t('သုံးသပ်ချက် မရှိသေး', 'No reviews yet');
  }
  return t(
    `${place.average_rating.toFixed(1)} · ${place.published_review_count} သုံးသပ်ချက်`,
    `${place.average_rating.toFixed(1)} · ${place.published_review_count} reviews`,
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
