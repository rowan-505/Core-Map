/** Scrollable list of visible POIs — click selects the same id the map uses. */
import { memo } from 'react';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import { ListSkeleton, PanelEmptyState, ResultRow } from '@/components/ui/sidebarUi';
import { resultTitleClass } from '@/components/ui/sidebarTokens';
import type { Poi } from '@/types';
import { getLocalizedName } from '@local-map/localized-name';
import { poiCategoryLabel } from '../categoryLabel';
import { getPlaceCategoryStyle } from '../placeCategoryStyle';

export type PoiListProps = {
  readonly pois: readonly Poi[];
  readonly selectedPoiId: string | null;
  readonly onSelectPoiId: (id: string) => void;
  readonly isLoading?: boolean;
  readonly error?: Error | null;
};

function PoiListInner({
  pois,
  selectedPoiId,
  onSelectPoiId,
  isLoading = false,
  error = null,
}: PoiListProps) {
  const t = useMapUiText();
  const languageMode = useMapUiStore((s) => s.languageMode);

  if (isLoading) {
    return <ListSkeleton rows={4} />;
  }

  if (error) {
    return (
      <PanelEmptyState
        tone="error"
        title={t('နေရာများကို ဖွင့်၍မရပါ။', 'Could not load places.')}
        body={t('ချိတ်ဆက်မှုကို စစ်ဆေးပါ။', 'Check your connection.')}
      />
    );
  }

  if (pois.length === 0) {
    return (
      <PanelEmptyState
        title={t('နေရာမတွေ့ပါ', 'No places found')}
        body={t('စစ်ထုတ်မှု ပြောင်းပါ။', 'Change the filter.')}
      />
    );
  }

  return (
    <ul
      className="-mx-4 divide-y divide-map-border/70"
      role="listbox"
      aria-label={t('မြင်ရသောနေရာများ', 'Visible places')}
    >
      {pois.map((poi) => {
        const selected = poi.id === selectedPoiId;
        const title = getLocalizedName(poi, languageMode);
        const categoryLabel = poiCategoryLabel(
          poi.category,
          poi.categoryName,
          poi.categoryCode,
        );
        const avatar = getPlaceCategoryStyle(poi.category, poi.categoryName, poi.categoryCode);

        return (
          <li key={poi.id}>
            <ResultRow
              selected={selected}
              align="center"
              onClick={() => onSelectPoiId(poi.id)}
              leading={
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border text-xs font-semibold ${avatar.className}`}
                >
                  {avatar.initial}
                </span>
              }
              title={<span className={resultTitleClass(languageMode === 'both')}>{title}</span>}
              subtitle={
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-map-muted">
                  <span className="truncate">{categoryLabel}</span>
                  <span className="h-1 w-1 shrink-0 rounded-full bg-map-primary/30" />
                  <span className="shrink-0 text-map-muted/75">{t('အနီးအနား', 'Nearby')}</span>
                </span>
              }
              trailing={
                selected ? (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-map-primary shadow-[0_0_0_3px_rgba(15,104,232,0.12)]" />
                ) : null
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

export const PoiList = memo(PoiListInner);

