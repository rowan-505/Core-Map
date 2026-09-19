import type { ReactNode } from 'react';

/**
 * Shared visual system for the public map sidebar surfaces (search, place
 * detail, result rows, chips, sections). Presentation only — no data,
 * search, or map logic lives here. Keep this small and lightweight.
 *
 * Class tokens and class helpers live in ./sidebarTokens so this file only
 * exports components.
 */

/** Card section header with an optional trailing hint (count / loading text). */
export function SidebarSectionTitle({
  children,
  trailing,
  className = '',
}: {
  readonly children: ReactNode;
  readonly trailing?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <h2 className="text-[15px] font-semibold leading-[1.55] text-map-ink">{children}</h2>
      {trailing ? (
        <span className="shrink-0 text-xs font-normal text-map-muted">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}

/** Compact action button: neutral by default, slightly stronger when primary. */
export function ActionButton({
  children,
  disabled = false,
  primary = false,
  title,
  onClick,
}: {
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly primary?: boolean;
  readonly title?: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      className={`flex min-h-10 items-center justify-center rounded-map-control border px-3 text-sm font-semibold transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 disabled:opacity-55 ${
        primary
          ? 'border-map-primary bg-map-primary text-white hover:bg-map-primary-hover'
          : 'border-map-border bg-map-surface text-map-ink hover:border-map-primary/40 hover:bg-map-primary-soft'
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Pill chip used for category and result-type filters. */
export function Chip({
  selected,
  onClick,
  children,
}: {
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`shrink-0 min-h-10 rounded-full border px-3 py-1.5 text-sm font-medium transition-[color,background-color,border-color] duration-150 ${
        selected
          ? 'border-map-primary/20 bg-map-primary-soft text-map-primary'
          : 'border-map-border bg-map-surface text-map-muted hover:border-map-primary/30 hover:bg-map-primary-soft hover:text-map-primary'
      }`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Horizontally scrollable row for chips (scrollbar hidden). */
export function ChipRow({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label?: string;
}) {
  return (
    <div
      className="map-chip-row -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pr-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label={label}
    >
      {children}
    </div>
  );
}

/** Vertical list of metadata rows separated by subtle dividers. */
export function MetadataList({ children }: { readonly children: ReactNode }) {
  return (
    <dl className="divide-y divide-map-border/70 border-t border-map-border/70">{children}</dl>
  );
}

/** Label/value metadata row. Supports stacked layout, mono values, and muted text. */
export function MetadataRow({
  label,
  children,
  stacked = false,
  mono = false,
  muted = false,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly stacked?: boolean;
  readonly mono?: boolean;
  readonly muted?: boolean;
}) {
  const rowLabelClass = 'map-kicker text-map-muted';
  const valueClass = `text-sm leading-6 ${mono ? 'font-mono text-sm' : ''} ${
    muted ? 'text-map-muted/70' : 'text-map-ink/85'
  }`;

  if (stacked) {
    return (
      <div className="px-4 py-2.5">
        <dt className={rowLabelClass}>{label}</dt>
        <dd className={`mt-1 wrap-break-word ${valueClass}`}>{children}</dd>
      </div>
    );
  }

  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <dt className={`${rowLabelClass} shrink-0`}>{label}</dt>
      <dd className={`min-w-0 text-right ${valueClass}`}>{children}</dd>
    </div>
  );
}

/**
 * Selectable result/list row used by both search results and the visible-places
 * list. The caller provides leading (badge/avatar), title, subtitle, and an
 * optional trailing slot; layout, padding, and selected/hover states are shared.
 */
export function ResultRow({
  selected = false,
  onClick,
  leading,
  title,
  subtitle,
  trailing,
  align = 'start',
  disabled = false,
}: {
  readonly selected?: boolean;
  readonly onClick: () => void;
  readonly leading?: ReactNode;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly trailing?: ReactNode;
  readonly align?: 'start' | 'center';
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      className={`map-focus-inset flex min-h-16 w-full gap-3 px-4 py-3 text-left transition-colors duration-150 focus-visible:bg-map-primary-soft disabled:cursor-default ${
        align === 'center' ? 'items-center' : 'items-start'
      } ${
        selected
          ? 'bg-map-primary-soft shadow-[inset_3px_0_0_#0f68e8]'
          : 'hover:bg-map-primary-soft/70'
      }`}
      onClick={onClick}
    >
      {leading}
      <span className="min-w-0 flex-1">
        {title}
        {subtitle}
      </span>
      {trailing}
    </button>
  );
}

/** Compact search input used at the top of discovery and search screens. */
export function SearchField({
  value,
  onChange,
  onClear,
  placeholder,
  label,
  clearLabel,
  loading = false,
  leading,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onClear?: () => void;
  readonly placeholder: string;
  readonly label: string;
  readonly clearLabel?: string;
  readonly loading?: boolean;
  readonly leading?: ReactNode;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-map-muted">
        {leading ?? <DefaultSearchIcon />}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-map-control border border-map-border bg-map-surface py-2 pl-11 pr-16 text-[15px] text-map-ink transition-colors placeholder:text-map-muted focus:border-map-primary lg:h-10"
        autoComplete="off"
        aria-label={label}
      />
      {loading ? (
        <span
          className="absolute right-10 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-map-border border-t-map-primary"
          aria-hidden="true"
        />
      ) : null}
      {value.length > 0 && onClear ? (
        <button
          type="button"
          className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-map-muted transition-colors hover:bg-map-bg hover:text-map-ink"
          aria-label={clearLabel ?? label}
          onClick={onClear}
        >
          <ClearIcon />
        </button>
      ) : null}
    </div>
  );
}

/** Compact empty / error / sign-in state without a nested card. */
export function PanelEmptyState({
  title,
  body,
  action,
  tone = 'neutral',
}: {
  readonly title: string;
  readonly body?: string;
  readonly action?: ReactNode;
  readonly tone?: 'neutral' | 'error';
}) {
  return (
    <div className="px-4 py-8 text-center">
      <h2
        className={`text-[15px] font-semibold leading-[1.55] ${
          tone === 'error' ? 'text-map-error' : 'text-map-ink'
        }`}
      >
        {title}
      </h2>
      {body ? (
        <p className="mx-auto mt-1 max-w-72 text-sm leading-6 text-map-muted">{body}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Equal-width segmented tabs for filters such as Latest / Trusted / Mine. */
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  readonly items: readonly { readonly id: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (id: T) => void;
  readonly label?: string;
}) {
  return (
    <div
      className="grid gap-0.5 rounded-map-control bg-map-bg p-0.5"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      role="tablist"
      aria-label={label}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`min-h-10 rounded-[8px] px-2 text-sm font-semibold transition-colors duration-150 ${
              selected
                ? 'bg-map-surface text-map-ink shadow-map-control'
                : 'text-map-muted hover:text-map-ink'
            }`}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/** Settings-style navigation row: icon, label, optional value, chevron. */
export function SettingsRow({
  icon,
  label,
  value,
  onClick,
}: {
  readonly icon?: ReactNode;
  readonly label: string;
  readonly value?: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-map-primary-soft/60"
      onClick={onClick}
    >
      {icon ? (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-map-control bg-map-bg text-map-muted">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="map-clamp-1 block text-[15px] font-medium text-map-ink">{label}</span>
        {value ? (
          <span className="map-clamp-1 mt-0.5 block text-sm text-map-muted">{value}</span>
        ) : null}
      </span>
      <ChevronRightIcon />
    </button>
  );
}

/** Placeholder rows while a list is loading. */
export function ListSkeleton({ rows = 4 }: { readonly rows?: number }) {
  return (
    <div className="divide-y divide-map-border/70" role="status">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex min-h-16 items-center gap-3 px-4 py-3" aria-hidden="true">
          <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-map-border/60" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-3.5 w-2/3 animate-pulse rounded bg-map-border/70" />
            <span className="block h-3 w-1/2 animate-pulse rounded bg-map-border/45" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Compact verification / success / warning pill. */
export function StatusPill({
  children,
  tone = 'neutral',
}: {
  readonly children: ReactNode;
  readonly tone?: 'neutral' | 'success' | 'warning' | 'primary';
}) {
  const toneClass =
    tone === 'success'
      ? 'bg-teal-50 text-teal-800'
      : tone === 'warning'
        ? 'bg-amber-50 text-amber-800'
        : tone === 'primary'
          ? 'bg-map-primary-soft text-map-primary'
          : 'bg-map-bg text-map-muted';

  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${toneClass}`}>
      {children}
    </span>
  );
}

/** Compact round compose action for the community panel. */
export function ComposeFab({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="absolute bottom-4 right-4 z-10 grid h-11 w-11 place-items-center rounded-full bg-map-primary text-white shadow-map-control transition-colors hover:bg-map-primary-hover"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <PlusIcon />
    </button>
  );
}

function DefaultSearchIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M9 15.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM13.8 13.8 18 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m4.5 4.5 7 7M11.5 4.5l-7 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="h-4 w-4 shrink-0 text-map-muted" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m6 3.5 4.5 4.5L6 12.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
