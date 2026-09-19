import { useMapUiText } from '@/features/map/i18n/mapUiText';

type CommunitySearchAreaButtonProps = {
  readonly visible: boolean;
  readonly loading?: boolean;
  readonly onSearch: () => void;
};

/** Floating control shown after meaningful camera movement while Community is open. */
export function CommunitySearchAreaButton({
  visible,
  loading = false,
  onSearch,
}: CommunitySearchAreaButtonProps) {
  const t = useMapUiText();
  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center px-3 lg:left-[27.75rem] lg:right-4 lg:top-4">
      <button
        type="button"
        className="pointer-events-auto rounded-full border border-white/90 bg-map-surface/95 px-4 py-2 text-sm font-semibold text-map-ink shadow-map-float backdrop-blur transition-[opacity,transform] duration-150 hover:bg-white disabled:opacity-60"
        disabled={loading}
        onClick={onSearch}
      >
        {loading
          ? t('ရှာနေသည်…', 'Searching…')
          : t('ဤနေရာကို ရှာရန်', 'Search this area')}
      </button>
    </div>
  );
}
