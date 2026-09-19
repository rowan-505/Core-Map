import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useMapUiText } from '@/features/map/i18n/mapUiText';

const LINKS = [
  { to: '/privacy', labelMy: 'ကိုယ်ရေးအချက်အလက်', labelEn: 'Privacy' },
  { to: '/terms', labelMy: 'စည်းကမ်းချက်များ', labelEn: 'Terms' },
  { to: '/contact', labelMy: 'ဆက်သွယ်ရန်', labelEn: 'Contact' },
  { to: '/account-deletion', labelMy: 'အကောင့်ဖျက်ရန်', labelEn: 'Account deletion' },
] as const;

export function LegalFooter() {
  const t = useMapUiText();
  return (
    <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-map-muted">
      {LINKS.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className="underline-offset-2 hover:text-map-primary hover:underline"
        >
          {t(link.labelMy, link.labelEn)}
        </Link>
      ))}
    </nav>
  );
}

export default function LegalLayout() {
  const { pathname } = useLocation();
  const isUtilityPage =
    pathname.startsWith('/auth/') ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password' ||
    pathname === '/account/security';

  useEffect(() => {
    const titles: Record<string, string> = {
      '/privacy': 'Privacy | CoreMap',
      '/terms': 'Terms | CoreMap',
      '/contact': 'Contact | CoreMap',
      '/account-deletion': 'Account deletion | CoreMap',
      '/forgot-password': 'Forgot password | CoreMap',
      '/reset-password': 'Reset password | CoreMap',
      '/auth/callback': 'Sign-in result | CoreMap',
      '/auth/complete-profile': 'Complete profile | CoreMap',
      '/account/security': 'Account security | CoreMap',
    };
    document.title = titles[pathname] ?? 'CoreMap';
    document.documentElement.lang = 'en';
    return () => {
      document.title = 'CoreMap';
    };
  }, [pathname]);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[radial-gradient(circle_at_top_left,rgba(15,104,232,0.11),transparent_32rem),var(--color-map-bg)] text-map-ink">
      <header className="border-b border-map-border/80 bg-map-surface/90 backdrop-blur-lg">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold text-map-ink">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-map-primary text-xs font-bold text-white shadow-map-control">
              CM
            </span>
            <span>CoreMap</span>
          </Link>
          <Link
            to="/"
            className="rounded-map-control border border-map-border bg-white px-3 py-2 text-sm font-semibold text-map-muted transition-colors hover:border-map-primary/30 hover:text-map-primary"
          >
            ← Back to map
          </Link>
        </div>
      </header>
      <main
        className={`mx-auto flex w-full flex-1 px-4 py-6 sm:px-6 sm:py-10 ${
          isUtilityPage ? 'max-w-xl items-start sm:items-center' : 'max-w-3xl items-start'
        }`}
      >
        <div
          className={`w-full ${
            isUtilityPage
              ? 'rounded-3xl border border-white/90 bg-map-surface p-5 shadow-map-card sm:p-8'
              : 'rounded-3xl border border-map-border/80 bg-map-surface p-5 shadow-map-card sm:p-8'
          }`}
        >
          <Outlet />
        </div>
      </main>
      <footer className="border-t border-map-border/80 bg-map-surface/90">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <p className="text-xs text-map-muted">CoreMap — Myanmar map</p>
          <LegalFooter />
        </div>
      </footer>
    </div>
  );
}
