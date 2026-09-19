import { useRef, type PointerEvent, type ReactNode } from 'react';
import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { PanelEmptyState } from '@/components/ui/sidebarUi';

export type RouteDestination = {
  readonly label: string;
  readonly coordinates: readonly [number, number];
};

export type SidebarMode =
  | 'search'
  | 'placeDetail'
  | 'transportStopDetail'
  | 'address'
  | 'route'
  | 'bus'
  | 'saved'
  | 'reports'
  | 'community'
  | 'tourism'
  | 'foodDrink'
  | 'notifications'
  | 'more'
  | 'account';

type MapSidebarProps = {
  readonly isOpen: boolean;
  readonly activeMode: SidebarMode;
  readonly onCollapse: () => void;
  readonly bottomSheetState?: BottomSheetState;
  readonly onBottomSheetChange?: (state: BottomSheetState) => void;
  readonly searchPanel: ReactNode;
  readonly placeDetailPanel?: ReactNode;
  readonly transportStopDetailPanel?: ReactNode;
  readonly addressPanel?: ReactNode;
  readonly routePanel?: ReactNode;
  readonly routeDestination?: RouteDestination | null;
  /** Overrides the default "Stop details" sidebar title in transport detail mode. */
  readonly transportStopDetailTitle?: string;
  readonly busPanel?: ReactNode;
  readonly savedPanel?: ReactNode;
  readonly reportsPanel?: ReactNode;
  readonly communityPanel?: ReactNode;
  readonly tourismPanel?: ReactNode;
  readonly foodDrinkPanel?: ReactNode;
  readonly notificationsPanel?: ReactNode;
  readonly morePanel?: ReactNode;
  readonly accountPanel?: ReactNode;
};

export type BottomSheetState = 'collapsed' | 'half' | 'expanded';

const SHEET_ORDER: readonly BottomSheetState[] = ['collapsed', 'half', 'expanded'];

export function MapSidebar({
  isOpen,
  activeMode,
  onCollapse,
  bottomSheetState = 'half',
  onBottomSheetChange,
  searchPanel,
  placeDetailPanel = <PlaceDetailEmptyState />,
  transportStopDetailPanel = <TransportStopDetailEmptyState />,
  addressPanel = <AddressPanelEmptyState />,
  routePanel,
  routeDestination = null,
  transportStopDetailTitle,
  busPanel = <BusPanelPlaceholder />,
  savedPanel = <SavedPanelPlaceholder />,
  reportsPanel = null,
  communityPanel = null,
  tourismPanel = null,
  foodDrinkPanel = null,
  notificationsPanel = null,
  morePanel = <MorePanelPlaceholder />,
  accountPanel = null,
}: MapSidebarProps) {
  const t = useMapUiText();
  const meta = sidebarModeMeta(activeMode, t);
  const headerTitle =
    activeMode === 'transportStopDetail' && transportStopDetailTitle
      ? transportStopDetailTitle
      : meta.title;
  const dragStartY = useRef<number | null>(null);

  if (!isOpen) return null;

  const snapSheet = (deltaY: number) => {
    if (!onBottomSheetChange) return;
    const index = SHEET_ORDER.indexOf(bottomSheetState);
    if (deltaY > 48) {
      onBottomSheetChange(SHEET_ORDER[Math.max(0, index - 1)] ?? 'collapsed');
      return;
    }
    if (deltaY < -48) {
      onBottomSheetChange(SHEET_ORDER[Math.min(SHEET_ORDER.length - 1, index + 1)] ?? 'expanded');
    }
  };

  const onHandlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    dragStartY.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onHandlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragStartY.current === null) return;
    snapSheet(event.clientY - dragStartY.current);
    dragStartY.current = null;
  };

  const sheetHeightClass =
    bottomSheetState === 'collapsed'
      ? 'max-md:h-[4.75rem]'
      : bottomSheetState === 'expanded'
        ? 'max-md:h-[min(86dvh,52rem)]'
        : 'max-md:h-[min(48dvh,28rem)]';

  return (
    <>
      <button
        type="button"
        className="pointer-events-auto absolute inset-0 z-20 hidden bg-black/20 md:block lg:hidden"
        aria-label={t('ဘေးဘောင်ကို ပိတ်ရန်', 'Close panel')}
        onClick={onCollapse}
      />
      <div
        className={`pointer-events-auto absolute bottom-0 left-0 right-0 z-30 min-h-0 md:bottom-0 md:left-0 md:right-auto md:top-[4.75rem] md:h-[calc(100%-4.75rem)] md:w-[min(23.75rem,86vw)] lg:left-16 lg:top-0 lg:h-full lg:w-[23.75rem] ${sheetHeightClass}`}
      >
        <aside
          className="flex h-full min-h-0 flex-col overflow-hidden rounded-t-2xl border border-map-border bg-map-surface shadow-map-float md:rounded-r-2xl md:rounded-tl-none md:shadow-map-float lg:rounded-none lg:border-y-0 lg:border-l-0 lg:border-r lg:shadow-none"
          aria-label={t('မြေပုံအကန့်', 'Map panel')}
          aria-expanded={isOpen}
        >
          <div className="shrink-0 border-b border-map-border bg-map-surface px-4 pb-3 pt-1 md:flex md:h-16 md:items-center md:gap-2 md:py-0">
            <button
              type="button"
              className="flex h-7 w-full items-center justify-center md:hidden"
              aria-label={t('အကန့်အရွယ်အစား ပြောင်းရန်', 'Resize panel')}
              onPointerDown={onHandlePointerDown}
              onPointerUp={onHandlePointerUp}
              onClick={() => {
                if (!onBottomSheetChange) return;
                onBottomSheetChange(bottomSheetState === 'expanded' ? 'half' : 'expanded');
              }}
            >
              <span className="h-1 w-10 rounded-full bg-map-border" aria-hidden="true" />
            </button>
            <div className="min-w-0 flex-1">
              <SidebarHeader title={headerTitle} />
            </div>
            <button
              type="button"
              className="hidden h-10 w-10 shrink-0 place-items-center rounded-map-control text-map-muted transition-colors hover:bg-map-bg hover:text-map-ink md:grid lg:hidden"
              aria-label={t('ဘေးဘောင်ကို ပိတ်ရန်', 'Close panel')}
              onClick={onCollapse}
            >
              <CloseIcon />
            </button>
          </div>

          <div
            className={`min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)] [-webkit-overflow-scrolling:touch] ${
              bottomSheetState === 'collapsed' ? 'max-md:hidden' : ''
            }`}
            tabIndex={0}
          >
            <SidebarModeContent
              activeMode={activeMode}
              searchPanel={searchPanel}
              placeDetailPanel={placeDetailPanel}
              transportStopDetailPanel={transportStopDetailPanel}
              addressPanel={addressPanel}
              routePanel={routePanel ?? <RoutePanelPlaceholder destination={routeDestination} />}
              busPanel={busPanel}
              savedPanel={savedPanel}
              reportsPanel={reportsPanel}
              communityPanel={communityPanel}
              tourismPanel={tourismPanel}
              foodDrinkPanel={foodDrinkPanel}
              notificationsPanel={notificationsPanel}
              morePanel={morePanel}
              accountPanel={accountPanel}
            />
          </div>
        </aside>

        <button
          type="button"
          className="absolute right-0 top-8 z-10 hidden h-8 w-8 translate-x-1/2 place-items-center rounded-full border border-map-border bg-map-surface text-map-muted shadow-map-control transition-colors hover:bg-map-primary-soft hover:text-map-primary lg:grid"
          aria-label={t('ဘေးဘောင်ကို ပိတ်ရန်', 'Collapse sidebar')}
          onClick={onCollapse}
        >
          <ChevronLeftIcon />
        </button>
      </div>
    </>
  );
}

export function SidebarHeader({
  title,
}: {
  readonly title: string;
}) {
  return (
    <div className="flex h-10 items-center md:h-full">
      <h1 className="map-clamp-1 text-[20px] font-semibold leading-[1.4] text-map-ink md:text-[21px]">
        {title}
      </h1>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronLeftIcon() {
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

export function RoutePanelPlaceholder({
  destination = null,
}: {
  readonly destination?: RouteDestination | null;
}) {
  const t = useMapUiText();
  return (
    <PlaceholderPanel
      title={t('မကြာမီ ရရှိမည်', 'Coming soon')}
      body={
        destination
          ? t(`သွားရာ: ${destination.label}`, `Destination: ${destination.label}`)
          : t('လမ်းညွှန်စနစ် ပြင်ဆင်နေသည်။', 'Routing is being prepared.')
      }
    />
  );
}

export function BusPanelPlaceholder() {
  const t = useMapUiText();
  return (
    <PlaceholderPanel
      title={t('မကြာမီ ရရှိမည်', 'Coming soon')}
      body={t('ဘတ်စ်လမ်းကြောင်းနှင့် မှတ်တိုင်များ။', 'Bus routes and stops.')}
    />
  );
}

export function SavedPanelPlaceholder() {
  const t = useMapUiText();
  return (
    <PlaceholderPanel
      title={t('မကြာမီ ရရှိမည်', 'Coming soon')}
      body={t('နှစ်သက်သောနေရာများကို သိမ်းပါ။', 'Save favorite places.')}
    />
  );
}

export function MorePanelPlaceholder() {
  const t = useMapUiText();
  return (
    <PlaceholderPanel
      title={t('နောက်ထပ် ကိရိယာများ', 'More tools')}
      body={t('မြေပုံအလွှာများနှင့် ဆက်တင်များ။', 'Layers and settings.')}
    />
  );
}

export function SidebarModeContent({
  activeMode,
  searchPanel,
  placeDetailPanel,
  transportStopDetailPanel,
  addressPanel,
  routePanel,
  busPanel,
  savedPanel,
  reportsPanel,
  communityPanel,
  tourismPanel,
  foodDrinkPanel,
  notificationsPanel,
  morePanel,
  accountPanel,
}: {
  readonly activeMode: SidebarMode;
  readonly searchPanel: ReactNode;
  readonly placeDetailPanel: ReactNode;
  readonly transportStopDetailPanel: ReactNode;
  readonly addressPanel: ReactNode;
  readonly routePanel: ReactNode;
  readonly busPanel: ReactNode;
  readonly savedPanel: ReactNode;
  readonly reportsPanel: ReactNode;
  readonly communityPanel: ReactNode;
  readonly tourismPanel: ReactNode;
  readonly foodDrinkPanel: ReactNode;
  readonly notificationsPanel: ReactNode;
  readonly morePanel: ReactNode;
  readonly accountPanel: ReactNode;
}) {
  if (activeMode === 'placeDetail') return placeDetailPanel;
  if (activeMode === 'transportStopDetail') return transportStopDetailPanel;
  if (activeMode === 'address') return addressPanel;
  if (activeMode === 'route') return routePanel;
  if (activeMode === 'bus') return busPanel;
  if (activeMode === 'saved') return savedPanel;
  if (activeMode === 'reports') return reportsPanel;
  if (activeMode === 'community') return communityPanel;
  if (activeMode === 'tourism') return tourismPanel;
  if (activeMode === 'foodDrink') return foodDrinkPanel;
  if (activeMode === 'notifications') return notificationsPanel;
  if (activeMode === 'more') return morePanel;
  if (activeMode === 'account') return accountPanel;
  return searchPanel;
}

function sidebarModeMeta(
  mode: SidebarMode,
  t: (myanmar: string, english: string) => string,
): {
  readonly eyebrow: string;
  readonly title: string;
} {
  switch (mode) {
    case 'placeDetail':
      return { eyebrow: t('နေရာ', 'Place'), title: t('နေရာအချက်အလက်', 'Place details') };
    case 'transportStopDetail':
      return {
        eyebrow: t('အများသုံးယာဉ်', 'Transit'),
        title: t('မှတ်တိုင်အချက်အလက်', 'Stop details'),
      };
    case 'address':
      return { eyebrow: t('တည်နေရာ', 'Location'), title: t('တည်နေရာစစ်ဆေးရန်', 'Inspect location') };
    case 'route':
      return { eyebrow: t('လမ်းညွှန်', 'Directions'), title: t('လမ်းညွှန်', 'Directions') };
    case 'bus':
      return { eyebrow: t('ဘတ်စ်', 'Bus'), title: t('ဘတ်စ်နှင့် အများသုံးယာဉ်', 'Bus and transit') };
    case 'saved':
      return { eyebrow: t('သိမ်းထားသည်', 'Saved'), title: t('သိမ်းထားသောနေရာများ', 'Saved places') };
    case 'reports':
      return { eyebrow: t('တိုင်ကြားချက်များ', 'Reports'), title: t('ကျွန်ုပ်၏ တိုင်ကြားချက်များ', 'My reports') };
    case 'community':
      return {
        eyebrow: t('လူမှုအသိုင်းအဝိုင်း', 'Community'),
        title: t('လူမှုအသိုင်းအဝိုင်း', 'Community'),
      };
    case 'tourism':
      return { eyebrow: t('ခရီးသွား', 'Tourism'), title: t('ခရီးသွားနေရာများ', 'Tourism') };
    case 'foodDrink':
      return {
        eyebrow: t('အစားအသောက်', 'Food & Drink'),
        title: t('စားသောက်ဆိုင်များ', 'Food & Drink'),
      };
    case 'notifications':
      return {
        eyebrow: t('အသိပေးချက်များ', 'Notifications'),
        title: t('အသိပေးချက်များ', 'Notifications'),
      };
    case 'more':
      return { eyebrow: t('နောက်ထပ်', 'More'), title: t('နောက်ထပ်', 'More') };
    case 'account':
      return { eyebrow: t('အကောင့်', 'Account'), title: t('သင့်အကောင့်', 'Your account') };
    case 'search':
    default:
      return { eyebrow: t('မြေပုံ', 'Map'), title: t('မြန်မာမြေပုံ', 'Myanmar map') };
  }
}

function TransportStopDetailEmptyState() {
  const t = useMapUiText();
  return (
    <PlaceholderPanel
      title={t('မှတ်တိုင်ရွေးပါ', 'Select a stop')}
      body={t('မြေပုံမှ မှတ်တိုင်ရွေးပါ။', 'Choose a stop on the map.')}
    />
  );
}

function AddressPanelEmptyState() {
  const t = useMapUiText();
  return (
    <PlaceholderPanel
      title={t('မြေပုံပေါ်တွင် နှိပ်ပါ', 'Click anywhere on the map')}
      body={t('လိပ်စာနှင့် ကိုဩဒိနိတ်ကြည့်ပါ။', 'View address and coordinates.')}
    />
  );
}

function PlaceDetailEmptyState() {
  const t = useMapUiText();
  return (
    <PlaceholderPanel
      title={t('နေရာရွေးပါ', 'Select a place')}
      body={t('စာရင်း သို့မဟုတ် မြေပုံမှ ရွေးပါ။', 'Choose from the list or map.')}
    />
  );
}

function PlaceholderPanel({
  title,
  body,
}: {
  readonly title: string;
  readonly body: string;
}) {
  return <PanelEmptyState title={title} body={body} />;
}
