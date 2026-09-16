import { Link, Outlet } from 'react-router-dom';

const LINKS = [
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
  { to: '/contact', label: 'Contact' },
  { to: '/account-deletion', label: 'Account deletion' },
] as const;

export function LegalFooter() {
  return (
    <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-map-muted">
      {LINKS.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className="underline-offset-2 hover:text-map-primary hover:underline"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export default function LegalLayout() {
  return (
    <div className="min-h-screen bg-map-bg text-map-ink">
      <header className="border-b border-map-border bg-map-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="text-sm font-semibold text-map-primary hover:underline">
            ← CoreMap
          </Link>
          <LegalFooter />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-map-border bg-map-surface">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <p className="text-xs text-map-muted">CoreMap — Myanmar map</p>
          <LegalFooter />
        </div>
      </footer>
    </div>
  );
}
