import { TOURISM_PLACE_CARD_CLASS } from '../lib/tourismListState';
import { formatTourismEventDateRange } from '../lib/formatTourismEventDateRange';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import type { TourismPublicEvent } from '../api/tourismApi';

type TourismEventCardProps = {
  readonly event: TourismPublicEvent;
  readonly selected?: boolean;
  readonly onSelect: (event: TourismPublicEvent) => void;
};

export function TourismEventCard({
  event,
  selected = false,
  onSelect,
}: TourismEventCardProps) {
  const t = useMapUiText();
  const dateLabel = formatTourismEventDateRange(
    event.occurrence.starts_at,
    event.occurrence.ends_at,
  );

  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className={`${TOURISM_PLACE_CARD_CLASS} ${
        selected
          ? 'border-map-primary/40 bg-map-primary-soft/70 ring-1 ring-map-primary/20'
          : 'border-map-border bg-map-surface hover:border-map-primary/25 hover:bg-map-primary-soft/40'
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600">
          {event.event_type_name_en}
        </span>
        {event.is_verified ? (
          <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
            {t('စစ်ဆေးပြီး', 'Verified')}
          </span>
        ) : null}
        <span className="rounded-md bg-map-primary-soft px-1.5 py-0.5 text-[11px] font-medium text-map-primary">
          {dateLabel}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-5 text-map-ink">
        {event.name}
      </p>
      {event.occurrence.schedule_note ? (
        <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-map-muted">
          {event.occurrence.schedule_note}
        </p>
      ) : event.short_description ? (
        <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-map-muted">
          {event.short_description}
        </p>
      ) : null}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-map-muted">
        <span className="truncate">{event.admin_area_name}</span>
        <span className="shrink-0 tabular-nums">
          {event.occurrence.duration_days >= 1
            ? t(
                `${Math.round(event.occurrence.duration_days)} ရက်`,
                `${Math.round(event.occurrence.duration_days)} days`,
              )
            : null}
        </span>
      </div>
    </button>
  );
}
