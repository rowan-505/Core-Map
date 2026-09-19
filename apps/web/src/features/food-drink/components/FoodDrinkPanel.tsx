import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/features/auth/api/http';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import { useDebouncedValue } from '@/features/filters/useDebouncedValue';
import { searchRegions, type RegionOption } from '@/features/regions/api/regionsApi';
import { SidebarSectionTitle } from '@/components/ui/sidebarUi';
import { useFoodDrinkRecommendations } from '../api/useFoodDrinkData';
import type { FoodDrinkRankedPlace } from '../api/foodDrinkApi';
import { FoodDrinkPlaceCard } from './FoodDrinkPlaceCard';

export type FoodDrinkMapCenter = {
  readonly lat: number;
  readonly lng: number;
};

type FoodDrinkPanelProps = {
  readonly mapCenter: FoodDrinkMapCenter | null;
  readonly selectedPlaceId: string | null;
  readonly onSelectPlace: (publicId: string | null) => void;
  readonly onFocusPlace?: (lng: number, lat: number) => void;
  readonly onDirections: (place: {
    readonly label: string;
    readonly coordinates: readonly [number, number];
    readonly placeId?: string;
  }) => void;
  readonly onOpenPlaceDetail: (publicId: string) => void;
};

const TOWNSHIP_LEVELS = new Set(['township', 'town']);

export function FoodDrinkPanel({
  mapCenter,
  selectedPlaceId,
  onSelectPlace,
  onFocusPlace,
  onDirections,
  onOpenPlaceDetail,
}: FoodDrinkPanelProps) {
  const t = useMapUiText();
  const languageMode = useMapUiStore((s) => s.languageMode);
  const lang = languageMode === 'en' ? 'en' : 'my';

  const [townshipId, setTownshipId] = useState<string | null>(null);
  const [townshipLabel, setTownshipLabel] = useState<string | null>(null);
  const [areaQuery, setAreaQuery] = useState('');
  const debouncedQuery = useDebouncedValue(areaQuery, 250);

  const areasQuery = useQuery({
    queryKey: ['food-drink-township-search', debouncedQuery],
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

  const rankingQuery = useFoodDrinkRecommendations({
    enabled: Boolean(townshipId),
    townshipAdminAreaId: townshipId,
    lang,
    lat: mapCenter?.lat ?? null,
    lng: mapCenter?.lng ?? null,
  });

  const items = useMemo(() => {
    const pages = rankingQuery.data?.pages ?? [];
    const out: FoodDrinkRankedPlace[] = [];
    for (const page of pages) {
      out.push(...page.items);
    }
    return out;
  }, [rankingQuery.data?.pages]);

  const titleTownship =
    rankingQuery.data?.pages[0]?.township_name ?? townshipLabel ?? t('မြို့နယ်', 'Township');

  const onPickTownship = (option: RegionOption) => {
    setTownshipId(option.id);
    setTownshipLabel(option.display_name || option.name);
    setAreaQuery('');
    onSelectPlace(null);
  };

  const onCardSelect = (publicId: string) => {
    onSelectPlace(publicId);
    const place = items.find((item) => item.public_id === publicId);
    if (place && onFocusPlace) {
      onFocusPlace(place.lng, place.lat);
    }
  };

  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-3 p-4"
      aria-label={t('အစားအသောက်နှင့် အဖျော်ယမကာ', 'Food & Drink')}
    >
      <div className="space-y-1">
        <SidebarSectionTitle>
          {t(`အစားအသောက်နှင့် အဖျော်ယမကာ — ${titleTownship}`, `Food & Drink in ${titleTownship}`)}
        </SidebarSectionTitle>
        <p className="text-[12px] leading-4 text-map-muted">
          {t(
            'မြို့နယ်အလိုက် အကြံပြုချက်။ Tourism Discover နှင့် သီးခြားဖြစ်သည်။',
            'Township recommendations. Separate from Tourism Discover.',
          )}
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-map-muted">
          {t('မြို့နယ်', 'Township')}
        </label>
        {townshipId && townshipLabel ? (
          <div className="flex items-center justify-between gap-2 rounded-map-card border border-map-border bg-map-surface px-3 py-2">
            <span className="truncate text-sm font-medium text-map-ink">{townshipLabel}</span>
            <button
              type="button"
              className="shrink-0 text-xs font-semibold text-map-primary"
              onClick={() => {
                setTownshipId(null);
                setTownshipLabel(null);
                onSelectPlace(null);
              }}
            >
              {t('ပြောင်းရန်', 'Change')}
            </button>
          </div>
        ) : (
          <>
            <input
              className="min-h-10 w-full rounded-map-control border border-map-border bg-map-surface px-3 text-sm text-map-ink outline-none focus:border-map-primary/40"
              placeholder={t('မြို့နယ် ရှာရန်…', 'Search township…')}
              value={areaQuery}
              onChange={(e) => setAreaQuery(e.target.value)}
            />
            {townshipOptions.length > 0 ? (
              <ul className="max-h-40 overflow-y-auto rounded-map-card border border-map-border bg-map-surface">
                {townshipOptions.map((option) => (
                  <li key={option.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm text-map-ink hover:bg-map-primary-soft"
                      onClick={() => onPickTownship(option)}
                    >
                      {option.display_name || option.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>

      {!townshipId ? (
        <p className="text-sm text-map-muted">
          {t('မြို့နယ်တစ်ခု ရွေးပါ။', 'Select a township to see recommendations.')}
        </p>
      ) : rankingQuery.isError ? (
        <p className="text-sm text-red-700">
          {rankingQuery.error instanceof ApiError
            ? rankingQuery.error.message
            : t('စာရင်း မရနိုင်ပါ', 'List unavailable')}
        </p>
      ) : rankingQuery.isPending ? (
        <p className="text-sm text-map-muted">{t('ဖွင့်နေသည်…', 'Loading…')}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-map-muted">
          {t('ဤမြို့နယ်တွင် အစားအသောက်နေရာ မရှိသေးပါ။', 'No food & drink places in this township yet.')}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {items.map((place) => (
            <FoodDrinkPlaceCard
              key={place.public_id}
              place={place}
              selected={selectedPlaceId === place.public_id}
              onSelect={onCardSelect}
              onDirections={(p) =>
                onDirections({
                  label: p.name,
                  coordinates: [p.lng, p.lat],
                  placeId: p.public_id,
                })
              }
              onOpenDetail={onOpenPlaceDetail}
            />
          ))}
          {rankingQuery.hasNextPage ? (
            <button
              type="button"
              className="min-h-10 rounded-map-control border border-map-border bg-map-surface text-sm font-semibold text-map-ink hover:bg-map-primary-soft disabled:opacity-55"
              disabled={rankingQuery.isFetchingNextPage}
              onClick={() => rankingQuery.fetchNextPage()}
            >
              {rankingQuery.isFetchingNextPage
                ? t('ဖွင့်နေသည်…', 'Loading…')
                : t('နောက်ထပ်', 'Load more')}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
