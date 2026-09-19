import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import { MetadataList, MetadataRow, SidebarSectionTitle } from '@/components/ui/sidebarUi';
import { sidebarCard } from '@/components/ui/sidebarTokens';
import { ReportEntryButton } from '@/features/reports/components/ReportEntryButton';
import type { ReportTarget, ReportTypeCode } from '@/features/reports/api/reportsApi';
import { tourismTypeFilterLabel } from '../lib/tourismTypes';
import { formatTourismPriceLevel } from '../lib/formatTourismPriceLevel';
import { TOURISM_REPORT_TYPE_OPTIONS } from '../lib/tourismReportTypes';
import {
  isTourismProfileNotFound,
  useTourismPlaceGeoRanks,
  useTourismPlaceProfile,
} from '../api/useTourismData';

const REPORT_INCORRECT_CLASS =
  'flex min-h-10 w-full items-center justify-center gap-2 rounded-map-control border border-map-border bg-map-surface px-2.5 py-2 text-xs font-semibold text-map-ink transition-[color,background-color,border-color] duration-150 hover:border-map-primary/30 hover:bg-map-primary-soft hover:text-map-primary';

const TOURISM_PLACE_REPORT_CODES = TOURISM_REPORT_TYPE_OPTIONS.map(
  (option) => option.code,
) as readonly ReportTypeCode[];

type PlaceTourismSectionProps = {
  readonly placePublicId: string;
  readonly reportTarget: ReportTarget | null;
};

/**
 * Tourism metadata overlay for place detail.
 * Renders nothing when the place has no public tourism profile.
 */
export function PlaceTourismSection({
  placePublicId,
  reportTarget,
}: PlaceTourismSectionProps) {
  const t = useMapUiText();
  const languageMode = useMapUiStore((s) => s.languageMode);
  const lang = languageMode === 'en' ? 'en' : 'my';

  const profileQuery = useTourismPlaceProfile({
    publicId: placePublicId,
    lang,
    enabled: true,
  });
  const geoRanksQuery = useTourismPlaceGeoRanks({
    publicId: placePublicId,
    enabled: true,
  });

  if (profileQuery.isPending) {
    return (
      <section className="mt-3" aria-label={t('ခရီးသွား', 'Tourism')}>
        <article className={sidebarCard}>
          <div className="px-4 py-3">
            <p className="text-sm text-map-muted">
              {t('ခရီးသွားအချက်အလက် ဖွင့်နေသည်…', 'Loading tourism info…')}
            </p>
          </div>
        </article>
      </section>
    );
  }

  if (isTourismProfileNotFound(profileQuery.error) || !profileQuery.data) {
    return null;
  }

  if (profileQuery.isError) {
    return (
      <section className="mt-3" aria-label={t('ခရီးသွား', 'Tourism')}>
        <article className={sidebarCard}>
          <div className="px-4 py-3">
            <p className="text-sm text-red-700">
              {t('ခရီးသွားအချက်အလက် မရနိုင်ပါ', 'Tourism info unavailable')}
            </p>
          </div>
        </article>
      </section>
    );
  }

  const profile = profileQuery.data;
  const priceLabel = formatTourismPriceLevel(profile.price_level, t);
  const typeLabel = tourismTypeFilterLabel(profile.tourism_type, t);
  const tourismReportTarget: ReportTarget | null = reportTarget
    ? {
        ...reportTarget,
        allowedTypeCodes: TOURISM_PLACE_REPORT_CODES,
        defaultTypeCode: 'tourism_incorrect_type',
        contextLabel:
          reportTarget.contextLabel ??
          profile.name ??
          t('ခရီးသွားနေရာ', 'Tourism place'),
      }
    : null;

  return (
    <section className="mt-3 space-y-3" aria-label={t('ခရီးသွား', 'Tourism')}>
      <article className={sidebarCard}>
        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <SidebarSectionTitle>{t('ခရီးသွားအချက်အလက်', 'Tourism info')}</SidebarSectionTitle>
            {profile.editor_pick ? (
              <span className="rounded-md bg-map-primary-soft px-1.5 py-0.5 text-[11px] font-medium text-map-primary">
                {t('CoreMap အထူးရွေးချယ်မှု', 'Featured by CoreMap')}
              </span>
            ) : null}
          </div>

          <MetadataList>
            <MetadataRow label={t('အမျိုးအစား', 'Type')}>{typeLabel}</MetadataRow>
            {geoRanksQuery.data?.township ? (
              <MetadataRow label={t('မြို့နယ် အဆင့်', 'Township rank')}>
                #{geoRanksQuery.data.township.rank} / {geoRanksQuery.data.township.total}
              </MetadataRow>
            ) : null}
            {geoRanksQuery.data?.region ? (
              <MetadataRow label={t('တိုင်း/ပြည်နယ် အဆင့်', 'Region rank')}>
                #{geoRanksQuery.data.region.rank} / {geoRanksQuery.data.region.total}
              </MetadataRow>
            ) : null}
            {geoRanksQuery.data?.national ? (
              <MetadataRow label={t('မြန်မာ အဆင့်', 'Myanmar rank')}>
                #{geoRanksQuery.data.national.rank} / {geoRanksQuery.data.national.total}
              </MetadataRow>
            ) : null}
            {profile.short_description ? (
              <MetadataRow label={t('ဖော်ပြချက်', 'About')} stacked>
                <span className="text-sm leading-5">{profile.short_description}</span>
              </MetadataRow>
            ) : null}
            {priceLabel ? (
              <MetadataRow label={t('ဧည့်သည် ကုန်ကျစရိတ်', 'Visitor cost')}>
                {priceLabel}
              </MetadataRow>
            ) : null}
            {profile.address?.full_address ? (
              <MetadataRow label={t('လိပ်စာ', 'Address')} stacked>
                <span className="text-sm leading-5">{profile.address.full_address}</span>
                {profile.address.postal_code ? (
                  <span className="mt-0.5 block text-xs text-map-muted">
                    {profile.address.postal_code}
                  </span>
                ) : null}
              </MetadataRow>
            ) : null}
            {profile.contact?.phone ? (
              <MetadataRow label={t('ဖုန်း', 'Phone')}>{profile.contact.phone}</MetadataRow>
            ) : null}
            {profile.contact?.website ? (
              <MetadataRow label={t('ဝက်ဘ်ဆိုက်', 'Website')} stacked>
                <a
                  href={profile.contact.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-sm text-map-primary underline-offset-2 hover:underline"
                >
                  {profile.contact.website}
                </a>
              </MetadataRow>
            ) : null}
            {profile.contact?.facebook_url ? (
              <MetadataRow label="Facebook" stacked>
                <a
                  href={profile.contact.facebook_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-sm text-map-primary underline-offset-2 hover:underline"
                >
                  {profile.contact.facebook_url}
                </a>
              </MetadataRow>
            ) : null}
            {profile.contact?.opening_hours ? (
              <MetadataRow label={t('ဖွင့်ချိန်', 'Hours')} stacked>
                <span className="text-sm leading-5">{profile.contact.opening_hours}</span>
              </MetadataRow>
            ) : null}
          </MetadataList>

          {tourismReportTarget ? (
            <ReportEntryButton
              target={tourismReportTarget}
              label={t('အချက်အလက်မှားကြောင်း တိုင်ကြားရန်', 'Report incorrect information')}
              className={REPORT_INCORRECT_CLASS}
            />
          ) : null}
        </div>
      </article>

    </section>
  );
}
