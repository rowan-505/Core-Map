import { TOURISM_PLACE_CARD_CLASS } from '../lib/tourismListState';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import type { TourismPublicActivity } from '../api/tourismApi';

type TourismActivityCardProps = {
  readonly activity: TourismPublicActivity;
  readonly selected?: boolean;
  readonly onSelect: (activity: TourismPublicActivity) => void;
};

export function TourismActivityCard({
  activity,
  selected = false,
  onSelect,
}: TourismActivityCardProps) {
  const t = useMapUiText();

  return (
    <button
      type="button"
      onClick={() => onSelect(activity)}
      className={`${TOURISM_PLACE_CARD_CLASS} ${
        selected
          ? 'border-map-primary/40 bg-map-primary-soft/70 ring-1 ring-map-primary/20'
          : 'border-map-border bg-map-surface hover:border-map-primary/25 hover:bg-map-primary-soft/40'
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600">
          {activity.activity_type_name_en}
        </span>
        {activity.is_verified ? (
          <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
            {t('စစ်ဆေးပြီး', 'Verified')}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-5 text-map-ink">
        {activity.name}
      </p>
      {activity.short_description ? (
        <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-map-muted">
          {activity.short_description}
        </p>
      ) : null}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-map-muted">
        <span className="truncate">{activity.admin_area_name}</span>
        <span className="shrink-0">{formatSeason(activity, t)}</span>
      </div>
    </button>
  );
}

function formatSeason(
  activity: TourismPublicActivity,
  t: (myanmar: string, english: string) => string,
): string {
  if (activity.season_mode === 'all_year') return t('တစ်နှစ်ပတ်လုံး', 'All year');
  if (activity.season_mode === 'temporarily_unavailable') {
    return t('ယာယီမရနိုင်', 'Temporarily unavailable');
  }
  if (activity.season_start_month && activity.season_end_month) {
    return `${activity.season_start_month}–${activity.season_end_month}`;
  }
  return activity.season_mode.replaceAll('_', ' ');
}
