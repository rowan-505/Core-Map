import { useState } from 'react';
import { useAuth } from '@/features/auth/state/useAuth';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import { ListSkeleton, PanelEmptyState } from '@/components/ui/sidebarUi';
import { resultTitleClass } from '@/components/ui/sidebarTokens';
import { useSavedPlaces } from '../state/useSavedPlaces';
import type { SavedPlace } from '../api/savedPlacesApi';

export type SavedLocationSelection = {
  readonly latitude: number;
  readonly longitude: number;
  readonly label: string;
};

type SavedPlacesPanelProps = {
  /** Fly the map to a saved map point when its row is clicked. */
  readonly onSelectLocation?: (selection: SavedLocationSelection) => void;
};

/** Sidebar panel listing the signed-in user's saved places and map points. */
export function SavedPlacesPanel({ onSelectLocation }: SavedPlacesPanelProps) {
  const t = useMapUiText();
  const { isAuthenticated, openAuthModal } = useAuth();
  const { items, loading, error } = useSavedPlaces();

  if (!isAuthenticated) {
    return (
      <PanelEmptyState
        title={t('နေရာများကို သိမ်းထားပါ', 'Save your places')}
        body={t('နေရာသိမ်းရန် အကောင့်ဝင်ပါ။', 'Sign in to save places.')}
        action={
          <button
            type="button"
            className="rounded-map-control bg-map-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-map-primary-hover"
            onClick={() => openAuthModal('login')}
          >
            {t('အကောင့်ဝင်ရန်', 'Sign in')}
          </button>
        }
      />
    );
  }

  if (loading) {
    return <ListSkeleton rows={4} />;
  }

  if (error) {
    return (
      <PanelEmptyState
        tone="error"
        title={t('သိမ်းထားသောနေရာများ မရပါ။', 'Saved places unavailable.')}
      />
    );
  }

  if (items.length === 0) {
    return (
      <PanelEmptyState
        title={t('သိမ်းထားသောနေရာ မရှိသေးပါ', 'No saved places yet')}
        body={t(
          'နေရာတစ်ခုဖွင့်ပြီး “သိမ်းရန်” နှိပ်ပါ။',
          'Open a place and select Save.',
        )}
      />
    );
  }

  return (
    <section aria-label={t('သိမ်းထားသောနေရာများ', 'Saved places')}>
      <ul className="divide-y divide-map-border/70" role="listbox">
        {items.map((item) => (
          <li key={item.id}>
            <SavedPlaceRow item={item} onSelectLocation={onSelectLocation} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SavedPlaceRow({
  item,
  onSelectLocation,
}: {
  readonly item: SavedPlace;
  readonly onSelectLocation?: (selection: SavedLocationSelection) => void;
}) {
  const t = useMapUiText();
  const languageMode = useMapUiStore((state) => state.languageMode);
  const { removeSaved } = useSavedPlaces();
  const [busy, setBusy] = useState(false);

  const isMapPoint = item.entity_type === 'map_point';
  const title = isMapPoint
    ? item.custom_name ?? t('သိမ်းထားသောတည်နေရာ', 'Saved location')
    : item.display_name ?? t('အမည်မရှိသောနေရာ', 'Unnamed place');
  const canFly =
    isMapPoint &&
    typeof item.latitude === 'number' &&
    typeof item.longitude === 'number' &&
    onSelectLocation !== undefined;

  const onRemove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await removeSaved(item.id);
    } finally {
      setBusy(false);
    }
  };

  const onFly = () => {
    if (!canFly) return;
    onSelectLocation?.({
      latitude: item.latitude as number,
      longitude: item.longitude as number,
      label: title,
    });
  };

  const subtitle = isMapPoint
    ? item.address_line ?? t('မြေပုံအမှတ်', 'Map point')
    : item.category?.name ?? formatSavedDate(item.created_at, languageMode);

  return (
    <div
      className={`flex min-h-16 items-center gap-3 px-4 py-3 ${
        canFly ? '' : ''
      }`}
    >
      <button
        type="button"
        className={`min-w-0 flex-1 text-left ${canFly ? '' : 'cursor-default'}`}
        onClick={onFly}
        disabled={!canFly}
      >
        <span className={resultTitleClass(false)}>{title}</span>
        <span className="mt-0.5 block truncate text-xs text-map-muted">{subtitle}</span>
      </button>
      <button
        type="button"
        className="grid h-10 w-auto shrink-0 place-items-center rounded-map-control border border-map-border px-2.5 text-xs font-semibold text-map-muted transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        disabled={busy}
        onClick={() => void onRemove()}
      >
        {busy ? '…' : t('ဖယ်ရှားရန်', 'Remove')}
      </button>
    </div>
  );
}

function formatSavedDate(value: string, languageMode: 'my' | 'en' | 'both'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const formatted = date.toLocaleDateString(languageMode === 'en' ? 'en-US' : 'my-MM', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return languageMode === 'en' ? `Saved ${formatted}` : `${formatted} တွင် သိမ်းထားသည်`;
}
