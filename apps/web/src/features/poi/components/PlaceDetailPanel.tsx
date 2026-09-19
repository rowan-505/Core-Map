import { memo, useState } from 'react';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import { useReverseAddress } from '@/features/map/api/useReverseAddress';
import { SaveButton } from '@/features/saved-places/components/SaveButton';
import { ReportEntryButton } from '@/features/reports/components/ReportEntryButton';
import { ShareCard, type ShareCardTarget } from '@/features/share/components/ShareCard';
import { PlaceTourismSection } from '@/features/tourism/components/PlaceTourismSection';
import { PlaceReviewsPanel } from '@/features/place-reviews/components/PlaceReviewsPanel';
import { ActionButton, MetadataList, MetadataRow, PanelEmptyState } from '@/components/ui/sidebarUi';
import type { ReportTarget } from '@/features/reports/api/reportsApi';
import type { PlaceLanguageMode, PublicSearchResult } from '@/features/poi/api/publicMapApi';
import type { Poi } from '@/types';
import { getLocalizedName } from '@local-map/localized-name';
import { poiCategoryLabel } from '../categoryLabel';

const PLACE_PUBLIC_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RoutePlacePayload = {
  readonly label: string;
  readonly coordinates: readonly [number, number];
  readonly placeId?: string;
};

export type PlaceDetailPanelProps = {
  readonly selectedPoi: Poi | undefined;
  readonly detailLoading?: boolean;
  readonly detailError?: Error | null;
  readonly selectedSearchResult?: PublicSearchResult | null;
  readonly onBack: () => void;
  readonly onRoutePlace: (field: 'from' | 'to', place: RoutePlacePayload) => void;
};

/** Neutral report button styling so it matches SaveButton in the compact action row. */
const REPORT_BUTTON_CLASS =
  'flex min-h-10 w-full items-center justify-center gap-2 rounded-map-control border border-map-border bg-map-surface px-2.5 py-2 text-xs font-semibold text-map-ink transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 hover:border-map-primary/30 hover:bg-map-primary-soft hover:text-map-primary';

function PlaceDetailPanelInner({
  selectedPoi,
  detailLoading = false,
  detailError = null,
  selectedSearchResult = null,
  onBack,
  onRoutePlace,
}: PlaceDetailPanelProps) {
  const t = useMapUiText();
  const languageMode = useMapUiStore((s) => s.languageMode);
  const [showShare, setShowShare] = useState(false);
  const detail = buildPlaceDetail({
    poi: selectedPoi,
    searchResult: selectedSearchResult,
    languageMode,
  });

  // Resolve again for the active language. Stored detail snapshots may contain
  // an older mixed-language address line.
  const needsReverse = Boolean(detail?.coordinates);
  const reverse = useReverseAddress(needsReverse ? detail!.coordinates : null);

  if (detailLoading && !detail) {
    return (
      <StateView
        onBack={onBack}
        title={t('အသေးစိတ် ဖွင့်နေသည်…', 'Loading details…')}
        body={t('နေရာအချက်အလက် ရယူနေသည်။', 'Fetching place data.')}
      />
    );
  }

  if (detailError && !detail) {
    return (
      <StateView
        onBack={onBack}
        title={t('အသေးစိတ်ကို ဖွင့်၍မရပါ။', 'Could not load details.')}
        body={t('ပြန်သွားပြီး ထပ်ကြိုးစားပါ။', 'Go back and retry.')}
        tone="error"
      />
    );
  }

  if (!detail) {
    return (
      <StateView
        onBack={onBack}
        title={t('နေရာရွေးပါ', 'Select a place')}
        body={t('စာရင်း သို့မဟုတ် မြေပုံမှ ရွေးပါ။', 'Choose from the list or map.')}
      />
    );
  }

  const coordinatesText = detail.coordinates
    ? formatCoordinates(detail.coordinates[0], detail.coordinates[1])
    : null;

  const addressLine = reverse.data?.address_line ?? detail.addressLine ?? null;
  const plusCode = detail.plusCode ?? reverse.data?.plus_code ?? null;
  const reportTarget = buildReportTarget(selectedPoi, detail);
  const shareTarget = buildShareTarget(detail, addressLine, plusCode);

  return (
    <section className="px-4 py-4" aria-label={t('ရွေးထားသောနေရာ အချက်အလက်', 'Selected place details')}>
      <article>
        <div className="pb-3">
          <div className="flex items-start gap-2">
            <BackButton onBack={onBack} />
            <div className="min-w-0 flex-1">
              <h2 className="wrap-break-word text-[20px] font-semibold leading-[1.45] text-map-ink">
                {detail.title}
              </h2>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-map-muted">
                <span>{detail.category}</span>
                {detail.area ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{detail.area}</span>
                  </>
                ) : null}
                <StatusBadge verified={detail.verified} />
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <ActionButton
              primary
              title={t('သွားမည့်နေရာ', 'Route destination')}
              disabled={!detail.coordinates}
              onClick={() => {
                if (detail.coordinates) {
                  onRoutePlace('to', {
                    label: detail.title,
                    coordinates: detail.coordinates,
                    placeId: detail.placeId,
                  });
                }
              }}
            >
              {t('သို့', 'To')}
            </ActionButton>
            <ActionButton
              title={t('လမ်းကြောင်းစတင်ရာ', 'Route start')}
              disabled={!detail.coordinates}
              onClick={() => {
                if (detail.coordinates) {
                  onRoutePlace('from', {
                    label: detail.title,
                    coordinates: detail.coordinates,
                    placeId: detail.placeId,
                  });
                }
              }}
            >
              {t('မှ', 'From')}
            </ActionButton>
            <ActionButton
              title={t('နေရာမျှဝေရန်', 'Share place')}
              disabled={!shareTarget}
              onClick={() => setShowShare((open) => !open)}
            >
              {t('မျှဝေ', 'Share')}
            </ActionButton>
            <ActionButton
              title={t('ကိုဩဒိနိတ်ကူးယူရန်', 'Copy coordinates')}
              disabled={!coordinatesText}
              onClick={() => {
                if (coordinatesText) copyText(coordinatesText);
              }}
            >
              {t('ကူးယူ', 'Copy')}
            </ActionButton>
          </div>

          <div className={`mt-2 grid gap-2 ${reportTarget ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <SaveButton placeApiId={selectedPoi?.apiId} />
            {reportTarget ? (
              <ReportEntryButton
                target={reportTarget}
                label={t('တိုင်ကြား', 'Report')}
                className={REPORT_BUTTON_CLASS}
              />
            ) : null}
          </div>
        </div>

        <div className="-mx-4">
        <MetadataList>
          {addressLine ? (
            <MetadataRow label={t('လိပ်စာ', 'Address')} stacked>
              <span className="line-clamp-2 text-sm leading-5">{addressLine}</span>
            </MetadataRow>
          ) : reverse.loading ? (
            <MetadataRow label={t('လိပ်စာ', 'Address')} stacked muted>
              {t('လိပ်စာ ဖွင့်နေသည်…', 'Loading address…')}
            </MetadataRow>
          ) : null}
          <MetadataRow label={t('တည်နေရာ', 'Coords')} mono>
            {coordinatesText ?? t('မရှိပါ', 'Unavailable')}
          </MetadataRow>
          {plusCode ? (
            <MetadataRow label="Plus code" mono>
              {plusCode}
            </MetadataRow>
          ) : null}
        </MetadataList>
        </div>
      </article>

      {showShare && shareTarget ? (
        <div className="mt-3">
          <ShareCard target={shareTarget} />
        </div>
      ) : null}

      {detail.placeId && PLACE_PUBLIC_ID_RE.test(detail.placeId) ? (
        <>
          <PlaceTourismSection
            placePublicId={detail.placeId}
            reportTarget={reportTarget}
          />
          <article className="mt-4 border-t border-map-border/80 pt-3">
            <PlaceReviewsPanel placePublicId={detail.placeId} />
          </article>
        </>
      ) : null}
    </section>
  );
}

function BackButton({ onBack }: { readonly onBack: () => void }) {
  const t = useMapUiText();
  return (
    <button
      type="button"
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-map-muted transition-colors hover:bg-map-primary-soft hover:text-map-primary"
      aria-label={t('ရှာဖွေမှုရလဒ်များသို့ ပြန်ရန်', 'Back to search results')}
      onClick={onBack}
    >
      <BackIcon />
    </button>
  );
}

function StatusBadge({ verified }: { readonly verified: boolean }) {
  const t = useMapUiText();
  return (
    <span
      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
        verified
          ? 'bg-teal-50 text-teal-800'
          : 'bg-map-bg text-map-muted'
      }`}
    >
      {verified ? t('အတည်ပြုပြီး', 'Verified') : t('စစ်ဆေးဆဲ', 'Pending')}
    </span>
  );
}

function StateView({
  onBack,
  title,
  body,
  tone = 'neutral',
}: {
  readonly onBack: () => void;
  readonly title: string;
  readonly body: string;
  readonly tone?: 'neutral' | 'error';
}) {
  const t = useMapUiText();
  return (
    <section className="px-4 py-4" aria-label={t('ရွေးထားသောနေရာ အချက်အလက်', 'Selected place details')}>
      <div className="mb-3">
        <BackButton onBack={onBack} />
      </div>
      <PanelEmptyState title={title} body={body} tone={tone} />
    </section>
  );
}

type PlaceDetail = {
  readonly title: string;
  readonly category: string;
  readonly area?: string;
  readonly address?: string;
  readonly addressLine?: string;
  readonly plusCode?: string | null;
  readonly coordinates: readonly [number, number] | null;
  readonly placeId?: string;
  readonly verified: boolean;
};

function buildPlaceDetail({
  poi,
  searchResult,
  languageMode,
}: {
  readonly poi: Poi | undefined;
  readonly searchResult: PublicSearchResult | null;
  readonly languageMode: PlaceLanguageMode;
}): PlaceDetail | null {
  if (poi) {
    return {
      title: getLocalizedName(poi, languageMode),
      category: localizedCategoryLabel(
        poiCategoryLabel(poi.category, poi.categoryName, poi.categoryCode),
        poi.categoryCode ?? poi.category,
        languageMode,
      ),
      area: poi.address,
      address: poi.address,
      addressLine: poi.addressLine,
      plusCode: poi.plusCode ?? null,
      coordinates: [poi.longitude, poi.latitude],
      placeId: poi.publicId ?? poi.id,
      verified: poi.isVerified === true,
    };
  }

  if (!searchResult) return null;

  const typeLabel = searchResultTypeLabel(searchResult.type, languageMode);
  const placeId =
    searchResult.type === 'place'
      ? (searchResult.publicId ?? searchResult.id)
      : undefined;

  return {
    title: getLocalizedName(searchResult, languageMode),
    category: localizedCategoryLabel(
      searchResult.categoryName ?? searchResult.categoryCode ?? typeLabel,
      searchResult.categoryCode ?? searchResult.type,
      languageMode,
    ),
    area: searchResult.subtitle,
    address: searchResult.subtitle,
    coordinates: getSearchResultCenter(searchResult),
    placeId,
    verified: false,
  };
}

/**
 * Builds the report target for the detail card. Prefers a 'place' target (with
 * the core place id) when this is a real POI; otherwise falls back to a
 * 'map_point' target using the available coordinate. Returns null when there is
 * nothing locatable to report.
 */
function buildReportTarget(poi: Poi | undefined, detail: PlaceDetail): ReportTarget | null {
  const latitude = detail.coordinates ? detail.coordinates[1] : undefined;
  const longitude = detail.coordinates ? detail.coordinates[0] : undefined;

  const placeApiId = poi?.apiId ? Number(poi.apiId) : null;
  if (placeApiId !== null && Number.isFinite(placeApiId)) {
    return {
      targetEntityType: 'place',
      targetEntityId: placeApiId,
      ...(poi?.publicId ? { targetPublicId: poi.publicId } : {}),
      ...(latitude !== undefined ? { latitude } : {}),
      ...(longitude !== undefined ? { longitude } : {}),
      contextLabel: detail.title,
    };
  }

  if (latitude !== undefined && longitude !== undefined) {
    return {
      targetEntityType: 'map_point',
      latitude,
      longitude,
      contextLabel: detail.title,
    };
  }

  return null;
}

function getSearchResultCenter(result: PublicSearchResult): readonly [number, number] | null {
  if (result.cameraTarget?.type === 'point') return result.cameraTarget.center;
  if (result.center) return result.center;
  if (typeof result.lng === 'number' && typeof result.lat === 'number') {
    return [result.lng, result.lat];
  }
  if (result.cameraTarget?.type === 'bounds' && result.cameraTarget.bbox) {
    return centerFromBbox(result.cameraTarget.bbox);
  }
  if (result.bbox) return centerFromBbox(result.bbox);
  return null;
}

function centerFromBbox(
  bbox: readonly [number, number, number, number],
): readonly [number, number] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

function formatCoordinates(lng: number, lat: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text);
}

/**
 * Builds the share target for the detail card. Real places (with a public id)
 * share as a 'place'; everything else with a coordinate (streets, admin areas,
 * search hits) falls back to a 'point' share. Returns null when nothing is
 * locatable.
 */
function buildShareTarget(
  detail: PlaceDetail,
  addressLine: string | null,
  plusCode: string | null,
): ShareCardTarget | null {
  if (detail.placeId) {
    return {
      kind: 'place',
      placePublicId: detail.placeId,
      name: detail.title,
      addressLine,
      plusCode,
    };
  }

  if (detail.coordinates) {
    return {
      kind: 'point',
      lat: detail.coordinates[1],
      lng: detail.coordinates[0],
      addressLine,
      plusCode,
    };
  }

  return null;
}

function searchResultTypeLabel(
  type: PublicSearchResult['type'],
  languageMode: PlaceLanguageMode,
): string {
  if (type === 'street' || type === 'street_group') {
    return languageMode === 'en' ? 'Street' : 'လမ်း';
  }
  if (type === 'admin_area') return languageMode === 'en' ? 'Area' : 'ဒေသ';
  return languageMode === 'en' ? 'Place' : 'နေရာ';
}

function localizedCategoryLabel(
  label: string,
  code: string,
  languageMode: PlaceLanguageMode,
): string {
  if (languageMode === 'en') return label;

  const normalized = `${code} ${label}`.toLowerCase();
  if (normalized.includes('hotel') || normalized.includes('lodging')) return 'ဟိုတယ်';
  if (normalized.includes('restaurant') || normalized.includes('food')) return 'စားသောက်ဆိုင်';
  if (normalized.includes('cafe')) return 'ကဖေး';
  if (normalized.includes('shop')) return 'ဆိုင်';
  if (normalized.includes('hospital') || normalized.includes('clinic')) return 'ဆေးရုံ';
  if (normalized.includes('school') || normalized.includes('education')) return 'ပညာရေး';
  if (normalized.includes('bank') || normalized.includes('finance')) return 'ဘဏ်';
  if (normalized.includes('relig') || normalized.includes('worship')) return 'ဘာသာရေး';
  if (normalized.includes('park') || normalized.includes('outdoor')) return 'ပန်းခြံ';
  if (normalized.includes('service')) return 'ဝန်ဆောင်မှု';
  return label;
}

function BackIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10 3.5 5.5 8l4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const PlaceDetailPanel = memo(PlaceDetailPanelInner);
