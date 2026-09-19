import { useMapUiText } from '@/features/map/i18n/mapUiText';
import { useAuth } from '../state/useAuth';

type AccountMenuProps = {
  /** Open the account drawer panel (auth when logged out, profile when logged in). */
  readonly onOpen: () => void;
  /** True when the account drawer panel is the active sidebar mode. */
  readonly active?: boolean;
};

/**
 * Left-rail account button. Guests see a "Sign in" icon; signed-in users see
 * their avatar initial. Clicking opens the account panel inside the left drawer
 * (no centered modal, no map blur).
 */
export function AccountMenu({ onOpen, active = false }: AccountMenuProps) {
  const t = useMapUiText();
  const { user, isAuthenticated, initializing } = useAuth();

  if (initializing) return null;

  if (!isAuthenticated || !user) {
    return (
      <button
        type="button"
        className={`map-rail-tip group grid h-11 w-11 place-items-center rounded-map-control transition-colors duration-150 ${
          active
            ? 'bg-map-primary-soft text-map-primary'
            : 'text-map-muted hover:bg-map-bg hover:text-map-ink'
        }`}
        aria-label={t('အကောင့်ဝင်ရန်', 'Sign in')}
        aria-current={active ? 'page' : undefined}
        title={t('အကောင့်ဝင်ရန်', 'Sign in')}
        data-tooltip={t('အကောင့်ဝင်ရန်', 'Sign in')}
        onClick={onOpen}
      >
        <AccountIcon />
      </button>
    );
  }

  const initial = (user.display_name.trim().charAt(0) || '?').toUpperCase();

  return (
    <button
      type="button"
      className={`map-rail-tip grid h-11 w-11 place-items-center rounded-map-control transition-colors duration-150 ${
        active ? 'bg-map-primary-soft text-map-primary' : 'hover:bg-map-bg'
      }`}
      aria-label={t('အကောင့်', 'Account')}
      aria-current={active ? 'page' : undefined}
      title={user.display_name}
      data-tooltip={user.display_name}
      onClick={onOpen}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-map-primary text-xs font-bold text-white">
        {initial}
      </span>
    </button>
  );
}

function AccountIcon() {
  return (
    <svg className="h-5 w-5 lg:h-4.5 lg:w-4.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="5" r="2.6" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M2.8 13.4a5.2 5.2 0 0 1 10.4 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
