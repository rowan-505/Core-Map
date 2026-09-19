import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import { SettingsRow } from '@/components/ui/sidebarUi';
import type { PlaceLanguageMode } from '@/features/poi/api/publicMapApi';
import { isMapModeAvailable, type MapMode } from '@/features/map/config';

type MoreToolsPanelProps = {
  readonly onOpenCommunity: () => void;
  readonly onOpenTourism: () => void;
  readonly onOpenFoodDrink: () => void;
  readonly onOpenAccount?: () => void;
  readonly onOpenReports?: () => void;
};

export function MoreToolsPanel({
  onOpenCommunity,
  onOpenTourism,
  onOpenFoodDrink,
  onOpenAccount,
  onOpenReports,
}: MoreToolsPanelProps) {
  const t = useMapUiText();
  const languageMode = useMapUiStore((s) => s.languageMode);
  const setLanguageMode = useMapUiStore((s) => s.setLanguageMode);
  const mapMode = useMapUiStore((s) => s.mapMode);
  const setMapMode = useMapUiStore((s) => s.setMapMode);

  return (
    <section className="flex min-h-0 flex-col" aria-label={t('နောက်ထပ်', 'More tools')}>
      <SettingsGroup title={t('အကောင့်', 'Account')}>
        {onOpenAccount ? (
          <SettingsRow
            icon={<AccountIcon />}
            label={t('အကောင့်', 'Account')}
            onClick={onOpenAccount}
          />
        ) : null}
        {onOpenReports ? (
          <SettingsRow
            icon={<ReportsIcon />}
            label={t('ကျွန်ုပ်၏ တိုင်ကြားချက်များ', 'My reports')}
            onClick={onOpenReports}
          />
        ) : null}
      </SettingsGroup>

      <SettingsGroup title={t('ဘာသာစကား', 'Language')}>
        <SettingsRow
          icon={<LanguageIcon />}
          label={t('မြေပုံစာတန်းများ', 'Map labels')}
          value={languageValue(languageMode, t)}
          onClick={() => setLanguageMode(nextLanguageMode(languageMode))}
        />
      </SettingsGroup>

      <SettingsGroup title={t('မြေပုံဆက်တင်', 'Map settings')}>
        <SettingsRow
          icon={<LayersIcon />}
          label={t('မြေပုံပုံစံ', 'Map style')}
          value={mapModeValue(mapMode, t)}
          onClick={() => setMapMode(nextMapMode(mapMode))}
        />
      </SettingsGroup>

      <SettingsGroup title={t('ရှာဖွေမှု', 'Explore')}>
        <SettingsRow
          icon={<CommunityIcon />}
          label={t('လူမှုအသိုင်းအဝိုင်း', 'Community')}
          onClick={onOpenCommunity}
        />
        <SettingsRow
          icon={<TourismIcon />}
          label={t('ခရီးသွားနေရာများ', 'Tourism')}
          onClick={onOpenTourism}
        />
        <SettingsRow
          icon={<FoodIcon />}
          label={t('စားသောက်ဆိုင်များ', 'Food & Drink')}
          onClick={onOpenFoodDrink}
        />
      </SettingsGroup>

      <SettingsGroup title={t('အကူအညီနှင့် အကြောင်း', 'Help and about')}>
        <LinkRow
          icon={<HelpIcon />}
          label={t('ဆက်သွယ်ရန်', 'Contact')}
          href="/contact"
        />
        <LinkRow
          icon={<AboutIcon />}
          label={t('ကိုယ်ရေးအချက်အလက်', 'Privacy')}
          href="/privacy"
        />
        <LinkRow
          icon={<AboutIcon />}
          label={t('စည်းကမ်းချက်များ', 'Terms')}
          href="/terms"
        />
      </SettingsGroup>
    </section>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="border-b border-map-border/80">
      <h2 className="px-4 pb-1 pt-4 text-[13px] font-semibold text-map-muted">{title}</h2>
      <div className="divide-y divide-map-border/70">{children}</div>
    </div>
  );
}

function LinkRow({
  icon,
  label,
  href,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly href: string;
}) {
  return (
    <Link
      to={href}
      className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-map-primary-soft/60"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-map-control bg-map-bg text-map-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-[15px] font-medium text-map-ink">{label}</span>
      <svg className="h-4 w-4 shrink-0 text-map-muted" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="m6 3.5 4.5 4.5L6 12.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}

function languageValue(
  mode: PlaceLanguageMode,
  t: (myanmar: string, english: string) => string,
): string {
  if (mode === 'en') return t('အင်္ဂလိပ်', 'English');
  if (mode === 'both') return t('နှစ်မျိုး', 'Both');
  return t('မြန်မာ', 'Myanmar');
}

function nextLanguageMode(mode: PlaceLanguageMode): PlaceLanguageMode {
  if (mode === 'my') return 'en';
  if (mode === 'en') return 'both';
  return 'my';
}

function mapModeValue(
  mode: MapMode,
  t: (myanmar: string, english: string) => string,
): string {
  if (mode === 'satellite') return t('ဂြိုဟ်တု', 'Satellite');
  if (mode === 'hybrid') return t('ပေါင်းစပ်', 'Hybrid');
  return t('မြေပုံ', 'Map');
}

function nextMapMode(mode: MapMode): MapMode {
  const order: readonly MapMode[] = ['normal', 'satellite', 'hybrid'];
  const start = order.indexOf(mode);
  for (let i = 1; i <= order.length; i += 1) {
    const next = order[(start + i) % order.length];
    if (next && isMapModeAvailable(next)) return next;
  }
  return 'normal';
}

export function MoreToolsPanelFallback({ children }: { readonly children?: ReactNode }) {
  return <div className="p-4">{children}</div>;
}

function AccountIcon() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="5" r="2.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.8 13.4a5.2 5.2 0 0 1 10.4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ReportsIcon() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 2.5h8v11H4z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 5.5h4M6 8h4M6 10.5h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function LanguageIcon() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 3h6M5 2v1M6.8 3c-.5 2.8-1.8 4.8-4 6.2M3.5 5.5c.8 1.5 1.8 2.7 3.4 3.6M9 13l2.5-6L14 13M10 11h3"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.8 14 5 8 8.2 2 5l6-3.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="m2 8 6 3.2L14 8M2 11l6 3.2L14 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CommunityIcon() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="2" />
      <path d="M15.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="2" />
      <path d="M4.5 19.2c.6-2.4 2.5-3.7 4-3.7s3.4 1.3 4 3.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TourismIcon() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21s-6.5-4.8-6.5-10A6.5 6.5 0 0 1 12 4.5 6.5 6.5 0 0 1 18.5 11c0 5.2-6.5 10-6.5 10Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FoodIcon() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5 2v6M3.5 2v4.5A1.5 1.5 0 0 0 5 8M6.5 2v4.5A1.5 1.5 0 0 1 5 8v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11 2.5c1.2 0 2 1 2 2.3S12.2 7 11 7v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 6.2a1.6 1.6 0 1 1 2.3 1.4c-.5.3-.8.6-.8 1.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 11.4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function AboutIcon() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7.2v3.6M8 5.2h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
