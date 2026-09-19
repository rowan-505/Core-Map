import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/features/auth/api/http';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import { useDebouncedValue } from '@/features/filters/useDebouncedValue';
import { searchRegions, type RegionOption } from '@/features/regions/api/regionsApi';
import { Chip, ChipRow, SidebarSectionTitle } from '@/components/ui/sidebarUi';
import {
  useTourismActivities,
  useTourismEvents,
  useTourismPlaces,
} from '../api/useTourismData';
import type { TourismRankingMode } from '../api/tourismApi';
import type { TourismPublicActivity, TourismPublicEvent } from '../api/tourismApi';
import { TOURISM_MODE_META, tourismModeLabel } from '../lib/tourismModes';
import { TOURISM_TYPE_FILTERS, tourismTypeFilterLabel } from '../lib/tourismTypes';
import {
  flattenTourismPages,
  resolveTourismListUiState,
  tourismModeNeedsMapCenter,
} from '../lib/tourismListState';
import { TourismPlaceCard } from './TourismPlaceCard';
import { TourismActivityCard } from './TourismActivityCard';
import { TourismEventCard } from './TourismEventCard';

export type TourismMapCenter = {
  readonly lat: number;
  readonly lng: number;
};

type TourismPanelProps = {
  readonly mapCenter: TourismMapCenter | null;
  readonly selectedPlaceId: string | null;
  readonly onSelectPlace: (publicId: string | null) => void;
  readonly onFocusPlace?: (lng: number, lat: number) => void;
};

const TOWNSHIP_LEVELS = new Set(['township', 'town']);

export function TourismPanel({
  mapCenter,
  selectedPlaceId,
  onSelectPlace,
  onFocusPlace,
}: TourismPanelProps) {
  const t = useMapUiText();
  const languageMode = useMapUiStore((s) => s.languageMode);
  const lang = languageMode === 'en' ? 'en' : 'my';

  const [mode, setMode] = useState<TourismRankingMode>('recommended');
  const [tourismType, setTourismType] = useState<string | null>(null);
  const [nearbyCenter, setNearbyCenter] = useState<TourismMapCenter | null>(null);
  const [townshipId, setTownshipId] = useState<string | null>(null);
  const [townshipLabel, setTownshipLabel] = useState<string | null>(null);
  const [areaQuery, setAreaQuery] = useState('');
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [selectedEventKey, setSelectedEventKey] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(areaQuery, 250);

  const queryCenter = mode === 'nearby' ? (nearbyCenter ?? mapCenter) : null;

  const placesQuery = useTourismPlaces({
    enabled: true,
    mode,
    tourismType,
    lang,
    lat: queryCenter?.lat ?? null,
    lng: queryCenter?.lng ?? null,
    limit: 12,
  });

  const activitiesQuery = useTourismActivities({
    adminAreaId: townshipId,
    limit: 12,
  });
  const happeningQuery = useTourismEvents({
    status: 'happening_now',
    adminAreaId: townshipId,
    limit: 12,
  });
  const upcomingQuery = useTourismEvents({
    status: 'upcoming',
    adminAreaId: townshipId,
    limit: 12,
  });

  const areasQuery = useQuery({
    queryKey: ['tourism-discover-township-search', debouncedQuery],
    queryFn: ({ signal }) => searchRegions(debouncedQuery.trim(), 30, signal),
    enabled: debouncedQuery.trim().length >= 1,
    staleTime: 30_000,
  });

  const townshipOptions = useMemo(() => {
    const rows = areasQuery.data ?? [];
    return rows.filter((row) => {
      const code = (row.admin_level_code ?? row.admin_level ?? '').toLowerCase();
      return TOWNSHIP_LEVELS.has(code) || code.includes('township') || code.includes('town');
    });
  }, [areasQuery.data]);

  const attractionItems = useMemo(
    () => flattenTourismPages(placesQuery.data?.pages),
    [placesQuery.data?.pages],
  );

  const attractionsUi = resolveTourismListUiState({
    isLoading: placesQuery.isPending || (placesQuery.isFetching && attractionItems.length === 0),
    isError: placesQuery.isError,
    errorMessage:
      placesQuery.error instanceof ApiError
        ? placesQuery.error.message
        : t('ခရီးသွားစာရင်း မရနိုင်ပါ', 'Tourism list unavailable'),
    items: attractionItems,
    hasMore: Boolean(placesQuery.hasNextPage),
    loadingMore: placesQuery.isFetchingNextPage,
  });

  const needsCenter = tourismModeNeedsMapCenter(mode);
  const waitingForCenter = needsCenter && !queryCenter;

  const onModeChange = (next: TourismRankingMode) => {
    setMode(next);
    onSelectPlace(null);
    if (next === 'nearby' && mapCenter) {
      setNearbyCenter(mapCenter);
    }
  };

  const onPickTownship = (option: RegionOption) => {
    setTownshipId(option.id);
    setTownshipLabel(option.display_name || option.name);
    setAreaQuery('');
  };

  const onAttractionSelect = (publicId: string) => {
    setSelectedActivityId(null);
    setSelectedEventKey(null);
    onSelectPlace(publicId);
    const place = attractionItems.find((item) => item.public_id === publicId);
    if (
      place &&
      typeof place.lng === 'number' &&
      typeof place.lat === 'number' &&
      onFocusPlace
    ) {
      onFocusPlace(place.lng, place.lat);
    }
  };

  const onActivitySelect = (activity: TourismPublicActivity) => {
    setSelectedActivityId(activity.public_id);
    setSelectedEventKey(null);
    if (activity.primary_place) {
      onSelectPlace(activity.primary_place.public_id);
      if (
        typeof activity.primary_place.lng === 'number' &&
        typeof activity.primary_place.lat === 'number' &&
        onFocusPlace
      ) {
        onFocusPlace(activity.primary_place.lng, activity.primary_place.lat);
      }
    } else {
      onSelectPlace(null);
    }
  };

  const onEventSelect = (event: TourismPublicEvent) => {
    setSelectedEventKey(`${event.public_id}:${event.occurrence.public_id}`);
    setSelectedActivityId(null);
    if (event.primary_place) {
      onSelectPlace(event.primary_place.public_id);
      if (
        typeof event.primary_place.lng === 'number' &&
        typeof event.primary_place.lat === 'number' &&
        onFocusPlace
      ) {
        onFocusPlace(event.primary_place.lng, event.primary_place.lat);
      }
    } else {
      onSelectPlace(null);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-4" aria-label={t('ခရီးသွား', 'Tourism')}>
      <div className="space-y-2">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-map-muted">
          {t('မြို့နယ် (လုပ်ဆောင်မှု / ပွဲ)', 'Township (activities / events)')}
        </label>
        <input
          value={areaQuery}
          onChange={(e) => setAreaQuery(e.target.value)}
          placeholder={t('မြို့နယ် ရှာရန်…', 'Search township…')}
          className="min-h-10 w-full rounded-map-control border border-map-border bg-map-surface px-3 text-sm text-map-ink"
        />
        {townshipId ? (
          <div className="flex items-center justify-between gap-2 rounded-map-card border border-map-border/80 bg-map-surface px-3 py-2 text-[12px]">
            <span className="text-map-ink">
              {townshipLabel ?? t('မြို့နယ်', 'Township')}
            </span>
            <button
              type="button"
              className="font-semibold text-map-primary"
              onClick={() => {
                setTownshipId(null);
                setTownshipLabel(null);
              }}
            >
              {t('ဖယ်ရှား', 'Clear')}
            </button>
          </div>
        ) : null}
        {townshipOptions.length > 0 ? (
          <ul className="max-h-28 space-y-1 overflow-y-auto rounded-map-card border border-map-border bg-map-surface p-1">
            {townshipOptions.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-2 text-left text-sm text-map-ink hover:bg-map-primary-soft"
                  onClick={() => onPickTownship(option)}
                >
                  {option.display_name || option.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-2">
        {/* Recommended Attractions — existing ranking, not mixed with activities/events */}
        <section className="space-y-2" aria-label={t('အကြံပြုနေရာများ', 'Recommended Attractions')}>
          <SidebarSectionTitle>
            {t('အကြံပြုနေရာများ', 'Recommended Attractions')}
          </SidebarSectionTitle>
          <ChipRow label={t('ခရီးသွား ရလဒ်ပုံစံ', 'Tourism result mode')}>
            {TOURISM_MODE_META.map((item) => (
              <Chip
                key={item.id}
                selected={mode === item.id}
                onClick={() => onModeChange(item.id)}
              >
                {tourismModeLabel(item.id, t)}
              </Chip>
            ))}
          </ChipRow>
          <ChipRow label={t('ခရီးသွားအမျိုးအစား စစ်ထုတ်ရန်', 'Filter by tourism type')}>
            {TOURISM_TYPE_FILTERS.map((item) => (
              <Chip
                key={item.code ?? 'all'}
                selected={tourismType === item.code}
                onClick={() => setTourismType(item.code)}
              >
                {tourismTypeFilterLabel(item.code, t)}
              </Chip>
            ))}
          </ChipRow>
          {needsCenter ? (
            <div className="flex items-center justify-between gap-2 rounded-map-card border border-map-border/80 bg-map-surface px-3 py-2">
              <p className="text-[12px] leading-4 text-map-muted">
                {waitingForCenter
                  ? t('မြေပုံစင်တာကို စောင့်နေသည်…', 'Waiting for map center…')
                  : t('မြေပုံအလယ်မှ အနီးအနား', 'Nearby from map center')}
              </p>
              <button
                type="button"
                className="min-h-10 shrink-0 rounded-map-control border border-map-border bg-map-surface px-3 text-sm font-semibold text-map-ink hover:border-map-primary/40 hover:bg-map-primary-soft disabled:opacity-55"
                disabled={!mapCenter}
                onClick={() => {
                  if (!mapCenter) return;
                  setNearbyCenter(mapCenter);
                  onSelectPlace(null);
                }}
              >
                {t('ဤဧရိယာ', 'This area')}
              </button>
            </div>
          ) : null}
          {attractionsUi.kind === 'loading' ? (
            <TourismStatusCard
              title={t('ဖွင့်နေသည်…', 'Loading…')}
              body={t('ခရီးသွားစာရင်းကို ဖွင့်နေသည်', 'Loading tourism places')}
            />
          ) : null}
          {attractionsUi.kind === 'error' ? (
            <TourismStatusCard title={t('မရနိုင်ပါ', 'Unavailable')} body={attractionsUi.message} />
          ) : null}
          {attractionsUi.kind === 'empty' ? (
            <TourismStatusCard
              title={t('မရှိသေးပါ', 'Nothing here yet')}
              body={t('ဤစစ်ထုတ်မှုအတွက် နေရာ မရှိပါ', 'No places for this filter')}
            />
          ) : null}
          {attractionsUi.kind === 'ready'
            ? attractionItems.map((place) => (
                <TourismPlaceCard
                  key={place.public_id}
                  place={place}
                  selected={selectedPlaceId === place.public_id}
                  onSelect={onAttractionSelect}
                />
              ))
            : null}
          {placesQuery.hasNextPage ? (
            <button
              type="button"
              className="min-h-10 w-full rounded-map-control border border-map-border bg-map-surface text-sm font-semibold text-map-ink hover:bg-map-primary-soft disabled:opacity-55"
              disabled={placesQuery.isFetchingNextPage}
              onClick={() => void placesQuery.fetchNextPage()}
            >
              {placesQuery.isFetchingNextPage
                ? t('ထပ်ဖွင့်နေသည်…', 'Loading more…')
                : t('နောက်ထပ်', 'Load more')}
            </button>
          ) : null}
        </section>

        <DiscoverSection
          title={t('လုပ်ဆောင်ရန်အရာများ', 'Things to Do')}
          loading={activitiesQuery.isPending}
          error={
            activitiesQuery.isError
              ? activitiesQuery.error instanceof ApiError
                ? activitiesQuery.error.message
                : t('မရနိုင်ပါ', 'Unavailable')
              : null
          }
          empty={
            !activitiesQuery.isPending &&
            !activitiesQuery.isError &&
            (activitiesQuery.data?.items.length ?? 0) === 0
          }
          emptyTitle={t('လုပ်ဆောင်မှု မရှိသေးပါ', 'No activities added yet')}
          emptyBody={t(
            'ဤဧရိယာအတွက် လုပ်ဆောင်မှု မရှိသေးပါ',
            'No activities for this area yet',
          )}
        >
          {(activitiesQuery.data?.items ?? []).map((activity) => (
            <TourismActivityCard
              key={activity.public_id}
              activity={activity}
              selected={selectedActivityId === activity.public_id}
              onSelect={onActivitySelect}
            />
          ))}
        </DiscoverSection>

        <DiscoverSection
          title={t('ယခုဖြစ်ပွားနေသည်', 'Happening Now')}
          loading={happeningQuery.isPending}
          error={
            happeningQuery.isError
              ? happeningQuery.error instanceof ApiError
                ? happeningQuery.error.message
                : t('မရနိုင်ပါ', 'Unavailable')
              : null
          }
          empty={
            !happeningQuery.isPending &&
            !happeningQuery.isError &&
            (happeningQuery.data?.items.length ?? 0) === 0
          }
          emptyTitle={t('ယခု ဘာမှ မဖြစ်နေပါ', 'Nothing happening now')}
          emptyBody={t(
            'အတည်ပြုထားသော လက်ရှိပွဲ မရှိပါ',
            'No confirmed events are running right now',
          )}
        >
          {(happeningQuery.data?.items ?? []).map((event) => (
            <TourismEventCard
              key={`${event.public_id}:${event.occurrence.public_id}`}
              event={event}
              selected={
                selectedEventKey === `${event.public_id}:${event.occurrence.public_id}`
              }
              onSelect={onEventSelect}
            />
          ))}
        </DiscoverSection>

        <DiscoverSection
          title={t('လာမည့်ပွဲများ', 'Upcoming Events')}
          loading={upcomingQuery.isPending}
          error={
            upcomingQuery.isError
              ? upcomingQuery.error instanceof ApiError
                ? upcomingQuery.error.message
                : t('မရနိုင်ပါ', 'Unavailable')
              : null
          }
          empty={
            !upcomingQuery.isPending &&
            !upcomingQuery.isError &&
            (upcomingQuery.data?.items.length ?? 0) === 0
          }
          emptyTitle={t('လာမည့်ပွဲ မရှိသေးပါ', 'No upcoming events')}
          emptyBody={t(
            'အနာဂတ်အတွက် စီစဉ်ထားသော ပွဲ မရှိပါ',
            'No scheduled or confirmed future events',
          )}
        >
          {(upcomingQuery.data?.items ?? []).map((event) => (
            <TourismEventCard
              key={`${event.public_id}:${event.occurrence.public_id}`}
              event={event}
              selected={
                selectedEventKey === `${event.public_id}:${event.occurrence.public_id}`
              }
              onSelect={onEventSelect}
            />
          ))}
        </DiscoverSection>
      </div>
    </section>
  );
}

function DiscoverSection({
  title,
  loading,
  error,
  empty,
  emptyTitle,
  emptyBody,
  children,
}: {
  readonly title: string;
  readonly loading: boolean;
  readonly error: string | null;
  readonly empty: boolean;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly children: ReactNode;
}) {
  const t = useMapUiText();
  return (
    <section className="space-y-2" aria-label={title}>
      <SidebarSectionTitle>{title}</SidebarSectionTitle>
      {loading ? (
        <TourismStatusCard
          title={t('ဖွင့်နေသည်…', 'Loading…')}
          body={t('စာရင်းကို ဖွင့်နေသည်', 'Loading list')}
        />
      ) : null}
      {error ? <TourismStatusCard title={t('မရနိုင်ပါ', 'Unavailable')} body={error} /> : null}
      {empty ? <TourismStatusCard title={emptyTitle} body={emptyBody} /> : null}
      {!loading && !error && !empty ? children : null}
    </section>
  );
}

function TourismStatusCard({
  title,
  body,
}: {
  readonly title: string;
  readonly body: string;
}) {
  return (
    <article className="rounded-map-card border border-map-border/80 bg-map-surface px-3 py-3">
      <p className="text-sm font-semibold text-map-ink">{title}</p>
      <p className="mt-1 text-[12px] leading-4 text-map-muted">{body}</p>
    </article>
  );
}
