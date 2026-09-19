import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  isMapModeAvailable,
  resolveMartinTileUrl,
  type MapMode,
} from '@/features/map/config';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import type { PlaceLanguageMode } from '@/features/poi/api/publicMapApi';
import {
  useMapUiStore,
  type TransportBrowseMode,
} from '@/features/map/state/mapUiStore';
import type { BottomSheetState } from './MapSidebar';

type MapFloatingControlsProps = {
  readonly selectedLanguageMode: PlaceLanguageMode;
  readonly onSelectLanguageMode: (mode: PlaceLanguageMode) => void;
  readonly isSidebarOpen: boolean;
  readonly bottomSheetState: BottomSheetState;
  /** Own-user location control, anchored bottom-right with bottom-sheet-aware offset. */
  readonly locationSlot?: ReactNode;
  /** Mobile notification bell (desktop uses the left rail). */
  readonly notificationsSlot?: ReactNode;
};

type OpenControlsPanel = 'map' | 'language' | 'transport' | null;

const LANGUAGE_OPTIONS: readonly {
  readonly mode: PlaceLanguageMode;
  readonly labelMy: string;
  readonly labelEn: string;
  readonly displayLabelMy: string;
  readonly displayLabelEn: string;
  readonly icon?: ReactNode;
}[] = [
  {
    mode: 'my',
    labelMy: 'မြန်မာစာတန်းများ',
    labelEn: 'Myanmar labels',
    displayLabelMy: 'မြန်မာ',
    displayLabelEn: 'Myanmar',
    icon: <LanguageIcon />,
  },
  {
    mode: 'en',
    labelMy: 'အင်္ဂလိပ်စာတန်းများ',
    labelEn: 'English labels',
    displayLabelMy: 'အင်္ဂလိပ်',
    displayLabelEn: 'English',
  },
  {
    mode: 'both',
    labelMy: 'ဘာသာနှစ်မျိုး',
    labelEn: 'Both label languages',
    displayLabelMy: 'နှစ်မျိုး',
    displayLabelEn: 'Both',
  },
];

const MAP_TYPE_OPTIONS: readonly {
  readonly id: MapMode;
  readonly labelMy: string;
  readonly labelEn: string;
  readonly displayLabelMy: string;
  readonly displayLabelEn: string;
  readonly icon: ReactNode;
  readonly title?: string;
}[] = [
  {
    id: 'normal',
    labelMy: 'မြေပုံ',
    labelEn: 'Map',
    displayLabelMy: 'မြေပုံ',
    displayLabelEn: 'Map',
    icon: <MapIcon />,
  },
  {
    id: 'satellite',
    labelMy: 'ဂြိုဟ်တုမြေပုံ',
    labelEn: 'Satellite',
    displayLabelMy: 'ဂြိုဟ်တု',
    displayLabelEn: 'Satellite',
    icon: <ImageIcon />,
  },
  {
    id: 'hybrid',
    labelMy: 'ပေါင်းစပ်မြေပုံ',
    labelEn: 'Hybrid',
    displayLabelMy: 'ပေါင်းစပ်',
    displayLabelEn: 'Hybrid',
    icon: <LayersIcon />,
  },
];

export function MapFloatingControls({
  selectedLanguageMode,
  onSelectLanguageMode,
  isSidebarOpen,
  bottomSheetState,
  locationSlot,
  notificationsSlot,
}: MapFloatingControlsProps) {
  const [openPanel, setOpenPanel] = useState<OpenControlsPanel>(null);
  const controlsDockRef = useRef<HTMLDivElement | null>(null);
  const dispatchUtilityAction = useMapUiStore((s) => s.dispatchUtilityAction);
  const mapMode = useMapUiStore((s) => s.mapMode);
  const setMapMode = useMapUiStore((s) => s.setMapMode);
  const transportMode = useMapUiStore((s) => s.transportMode);
  const transportPointsVisible = useMapUiStore((s) => s.transportPointsVisible);
  const transportPathsVisible = useMapUiStore((s) => s.transportPathsVisible);
  const setTransportMode = useMapUiStore((s) => s.setTransportMode);
  const setTransportPointsVisible = useMapUiStore((s) => s.setTransportPointsVisible);
  const setTransportPathsVisible = useMapUiStore((s) => s.setTransportPathsVisible);
  useEffect(() => {
    if (openPanel === null) return;

    const onPointerDown = (event: PointerEvent) => {
      if (controlsDockRef.current?.contains(event.target as Node)) return;
      setOpenPanel(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPanel(null);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openPanel]);

  const selectedMapOption =
    MAP_TYPE_OPTIONS.find((option) => option.id === mapMode) ?? MAP_TYPE_OPTIONS[0];
  const selectedLanguageOption =
    LANGUAGE_OPTIONS.find((option) => option.mode === selectedLanguageMode) ??
    LANGUAGE_OPTIONS[0];
  const martinConfiguration = resolveMartinTileUrl();
  const transportConfigured = martinConfiguration.status === 'configured';

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-20 flex origin-top-right flex-col items-end gap-2 lg:right-4 lg:top-4">
      {notificationsSlot ? (
        <div className="pointer-events-auto lg:hidden">{notificationsSlot}</div>
      ) : null}
      <MapRightControls ref={controlsDockRef}>
        <LayerModeSelect
          selectedOption={selectedMapOption}
          isOpen={openPanel === 'map'}
          selectedMode={mapMode}
          onOpenChange={(nextOpen) => setOpenPanel(nextOpen ? 'map' : null)}
          onSelect={(nextMode) => {
            setMapMode(nextMode);
            setOpenPanel(null);
          }}
        />
        <LanguageModeSelect
          selectedOption={selectedLanguageOption}
          isOpen={openPanel === 'language'}
          selectedMode={selectedLanguageMode}
          onOpenChange={(nextOpen) => setOpenPanel(nextOpen ? 'language' : null)}
          onSelect={(nextMode) => {
            onSelectLanguageMode(nextMode);
            setOpenPanel(null);
          }}
        />
        <TransportLayerControl
          mode={transportMode}
          pointsVisible={transportPointsVisible}
          pathsVisible={transportPathsVisible}
          available={transportConfigured}
          isOpen={openPanel === 'transport'}
          onOpenChange={(nextOpen) => setOpenPanel(nextOpen ? 'transport' : null)}
          onSelectMode={setTransportMode}
          onPointsVisibleChange={setTransportPointsVisible}
          onPathsVisibleChange={setTransportPathsVisible}
        />
        <ZoomControls
          onZoomIn={() => dispatchUtilityAction('zoomIn')}
          onZoomOut={() => dispatchUtilityAction('zoomOut')}
        />
      </MapRightControls>
      {locationSlot ? (
        <div
          className={`pointer-events-none fixed z-20 transition-all duration-300 md:bottom-20 md:left-auto md:right-4 md:top-auto ${locateButtonMobilePositionClass(
            isSidebarOpen,
            bottomSheetState,
          )}`}
        >
          {locationSlot}
        </div>
      ) : null}
    </div>
  );
}

const MapRightControls = forwardRef<HTMLDivElement, { readonly children: ReactNode }>(
  function MapRightControls({ children }, ref) {
    const t = useMapUiText();
    return (
      <div
        ref={ref}
        className="pointer-events-auto flex flex-col items-end gap-2"
        aria-label={t('မြေပုံထိန်းချုပ်ခလုတ်များ', 'Map controls')}
      >
        {children}
      </div>
    );
  },
);

function LayerModeSelect({
  selectedOption,
  selectedMode,
  isOpen,
  onOpenChange,
  onSelect,
}: {
  readonly selectedOption: (typeof MAP_TYPE_OPTIONS)[number];
  readonly selectedMode: MapMode;
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (mode: MapMode) => void;
}) {
  const t = useMapUiText();

  return (
    <CompactControlSelect
      icon={selectedOption.icon}
      label={t(selectedOption.displayLabelMy, selectedOption.displayLabelEn)}
      title={t('မြေပုံပုံစံ', 'Map mode')}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      {MAP_TYPE_OPTIONS.map((option) => {
        const active = option.id === selectedMode;
        const available = isMapModeAvailable(option.id);

        return (
          <ControlOptionButton
            key={option.id}
            label={t(option.displayLabelMy, option.displayLabelEn)}
            icon={option.icon}
            active={active}
            disabled={!available}
            title={
              available
                ? t(option.labelMy, option.labelEn)
                : option.title ??
                  t(
                    `${option.labelMy} မကြာမီ ရရှိနိုင်မည်`,
                    `${option.labelEn} coming soon`,
                  )
            }
            onClick={() => {
              if (!available) return;
              onSelect(option.id);
            }}
          />
        );
      })}
    </CompactControlSelect>
  );
}

function LanguageModeSelect({
  selectedOption,
  selectedMode,
  isOpen,
  onOpenChange,
  onSelect,
}: {
  readonly selectedOption: (typeof LANGUAGE_OPTIONS)[number];
  readonly selectedMode: PlaceLanguageMode;
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (mode: PlaceLanguageMode) => void;
}) {
  const t = useMapUiText();

  return (
    <CompactControlSelect
      icon={<LanguageIcon />}
      label={t(selectedOption.displayLabelMy, selectedOption.displayLabelEn)}
      title={t('ဘာသာစကား', 'Label language')}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      {LANGUAGE_OPTIONS.filter((option) => option.mode !== selectedMode).map((option) => (
        <ControlOptionButton
          key={option.mode}
          label={t(option.displayLabelMy, option.displayLabelEn)}
          icon={option.icon}
          title={t(option.labelMy, option.labelEn)}
          onClick={() => onSelect(option.mode)}
        />
      ))}
    </CompactControlSelect>
  );
}

function CompactControlSelect({
  icon,
  label,
  title,
  isOpen,
  children,
  onOpenChange,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly title: string;
  readonly children: ReactNode;
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        className={`grid h-11 w-11 place-items-center rounded-map-control border text-map-ink shadow-map-control transition-colors duration-150 lg:h-10 lg:w-10 ${
          isOpen
            ? 'border-map-primary/30 bg-map-primary-soft text-map-primary'
            : 'border-map-border/80 bg-map-surface hover:border-map-primary/25 hover:bg-map-primary-soft hover:text-map-primary'
        }`}
        aria-label={title}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        title={title}
        onClick={() => onOpenChange(!isOpen)}
      >
        <span className="grid h-4.5 w-4.5 place-items-center">{icon}</span>
        <span className="sr-only">{label}</span>
      </button>
      {isOpen ? (
        <div
          className="absolute right-full top-0 z-10 mr-2 grid min-w-36 gap-0.5 rounded-map-card border border-map-border bg-map-surface p-1.5 shadow-map-float"
          role="menu"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function TransportLayerControl({
  mode,
  pointsVisible,
  pathsVisible,
  available,
  isOpen,
  onOpenChange,
  onSelectMode,
  onPointsVisibleChange,
  onPathsVisibleChange,
}: {
  readonly mode: TransportBrowseMode | null;
  readonly pointsVisible: boolean;
  readonly pathsVisible: boolean;
  readonly available: boolean;
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelectMode: (mode: TransportBrowseMode | null) => void;
  readonly onPointsVisibleChange: (visible: boolean) => void;
  readonly onPathsVisibleChange: (visible: boolean) => void;
}) {
  const t = useMapUiText();
  const pointLabel =
    mode === 'train'
      ? t('ဘူတာများ', 'Stations')
      : mode === 'express'
        ? t('ဂိတ်များ', 'Terminals')
        : t('မှတ်တိုင်များ', 'Stops');

  const modes: readonly { id: TransportBrowseMode; my: string; en: string }[] = [
    { id: 'bus', my: 'ဘတ်စ်', en: 'Bus' },
    { id: 'train', my: 'ရထား', en: 'Train' },
    { id: 'express', my: 'အဝေးပြေး', en: 'Express' },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        className={`relative grid h-11 w-11 place-items-center rounded-map-control border shadow-map-control transition-colors duration-150 lg:h-10 lg:w-10 ${
          isOpen || mode !== null
            ? 'border-map-primary/30 bg-map-primary-soft text-map-primary'
            : 'border-map-border/80 bg-map-surface text-map-ink hover:border-map-primary/25 hover:bg-map-primary-soft hover:text-map-primary'
        } ${available ? '' : 'opacity-75'}`}
        aria-label={t('အများသုံးယာဉ်အလွှာများ', 'Transit layers')}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title={t('အများသုံးယာဉ်အလွှာများ', 'Transit layers')}
        onClick={() => onOpenChange(!isOpen)}
      >
        <span className="grid h-4.5 w-4.5 place-items-center">
          <TransportIcon />
        </span>
        <span className="sr-only">{t('ယာဉ်လိုင်း', 'Transit')}</span>
        {mode !== null ? (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-400" />
        ) : null}
      </button>

      {isOpen ? (
        <div
          className="absolute right-full top-0 z-10 mr-2 w-60 rounded-xl border border-map-border bg-map-surface p-2 shadow-map-control"
          role="dialog"
          aria-label={t('အများသုံးယာဉ်အလွှာများ', 'Transit layers')}
        >
          <div className="grid grid-cols-3 gap-1" role="group" aria-label={t('ယာဉ်အမျိုးအစား', 'Transport type')}>
            {modes.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={!available}
                aria-pressed={mode === option.id}
                className={`min-h-10 rounded-lg px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  mode === option.id
                    ? 'bg-violet-600 text-white'
                    : 'text-map-muted hover:bg-violet-50 hover:text-violet-700'
                }`}
                onClick={() => onSelectMode(mode === option.id ? null : option.id)}
              >
                {t(option.my, option.en)}
              </button>
            ))}
          </div>

          {mode ? (
            <div className="mt-2 border-t border-map-border pt-2">
              <TransportVisibilityToggle
                label={pointLabel}
                checked={pointsVisible}
                onChange={onPointsVisibleChange}
              />
              <TransportVisibilityToggle
                label={t('လမ်းကြောင်းများ', 'Route paths')}
                checked={pathsVisible}
                onChange={onPathsVisibleChange}
              />
              <p className="px-2 pb-1 pt-1 text-[11px] leading-4 text-map-muted">
                {mode === 'bus' && !pathsVisible
                  ? t(
                      'လမ်းကြောင်းကြည့်ရန် လမ်းကြောင်းများကို ဖွင့်ပါ။',
                      'Turn on Route paths to display bus lines.',
                    )
                  : t(
                      'အသုံးပြုနေသော လမ်းကြောင်းအားလုံးကို မြေပုံချဲ့နှုန်းအလိုက် ပြသသည်။',
                      'All active routes are shown, with detail increasing as you zoom in.',
                    )}
              </p>
            </div>
          ) : !available ? (
            <p className="px-2 py-2 text-xs leading-5 text-map-muted">
              {t('ယာဉ်မြေပုံ မရရှိနိုင်သေးပါ။', 'Transit tiles are unavailable.')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TransportVisibilityToggle({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="flex min-h-10 w-full items-center justify-between rounded-lg px-2 text-left text-sm text-map-ink hover:bg-map-bg"
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <span className={`relative h-5 w-9 rounded-full ${checked ? 'bg-violet-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}

function ZoomControls({
  onZoomIn,
  onZoomOut,
}: {
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
}) {
  const t = useMapUiText();

  return (
    <div
      className="grid overflow-hidden rounded-map-control border border-map-border/80 bg-map-surface shadow-map-control"
      aria-label={t('မြေပုံ အရွယ်အစားထိန်းချုပ်ရန်', 'Map zoom controls')}
    >
      <UtilityButton label={t('ချဲ့ရန်', 'Zoom in')} onClick={onZoomIn}>
        +
      </UtilityButton>
      <Divider />
      <UtilityButton label={t('ချုံ့ရန်', 'Zoom out')} onClick={onZoomOut}>
        -
      </UtilityButton>
    </div>
  );
}

function locateButtonMobilePositionClass(
  isSidebarOpen: boolean,
  bottomSheetState: BottomSheetState,
): string {
  if (!isSidebarOpen) return 'bottom-8 right-3 md:bottom-20 md:right-4';
  if (bottomSheetState === 'collapsed') return 'bottom-[6.5rem] right-3 md:bottom-20 md:right-4';
  if (bottomSheetState === 'expanded') {
    return 'left-3 top-[4.5rem] md:bottom-20 md:left-auto md:right-4 md:top-auto';
  }
  return 'bottom-[calc(48dvh+0.75rem)] right-3 md:bottom-20 md:right-4';
}

function ControlOptionButton({
  label,
  icon,
  active = false,
  disabled = false,
  title = label,
  onClick,
}: {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex h-10 items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 ${
        active
          ? 'bg-map-primary-soft text-map-primary'
          : 'text-map-ink hover:bg-map-bg hover:text-map-ink disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent'
      }`}
      role="menuitemradio"
      aria-checked={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {icon ? <span className="grid h-4 w-4 shrink-0 place-items-center">{icon}</span> : null}
      <span>{label}</span>
    </button>
  );
}

function UtilityButton({
  children,
  label,
  onClick,
}: {
  readonly children: ReactNode;
  readonly label: string;
  readonly onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="grid h-11 w-11 place-items-center text-lg font-medium text-map-ink transition-colors duration-150 hover:bg-map-primary-soft hover:text-map-primary lg:h-10 lg:w-10"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Divider({ className = '' }: { readonly className?: string }) {
  return <span className={`mx-1 h-px bg-map-border/70 ${className}`} aria-hidden="true" />;
}

function MapIcon() {
  return (
    <svg className="h-4.5 w-4.5 lg:h-4 lg:w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m1.8 4 4-1.8 4.4 1.8 4-1.8v9.8l-4 1.8-4.4-1.8-4 1.8V4Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M5.8 2.2V12M10.2 4v9.8" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg className="h-4.5 w-4.5 lg:h-4 lg:w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 3h11A1.5 1.5 0 0 1 15 4.5v7A1.5 1.5 0 0 1 13.5 13h-11A1.5 1.5 0 0 1 1 11.5v-7A1.5 1.5 0 0 1 2.5 3Z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="m2 11 3.2-3 2.4 2.2 1.8-1.7L14 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M11.2 6.3a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" fill="currentColor" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg className="h-4.5 w-4.5 lg:h-4 lg:w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.8 14 5 8 8.2 2 5l6-3.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="m2 8 6 3.2L14 8M2 11l6 3.2L14 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TransportIcon() {
  return (
    <svg className="h-4.5 w-4.5 lg:h-4 lg:w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.5" y="2.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 6.5h9" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 11.5 4.5 14M10.5 11.5l1 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="6" cy="9" r="0.9" fill="currentColor" />
      <circle cx="10" cy="9" r="0.9" fill="currentColor" />
    </svg>
  );
}

function LanguageIcon() {
  return (
    <svg className="h-4.5 w-4.5 lg:h-4 lg:w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
