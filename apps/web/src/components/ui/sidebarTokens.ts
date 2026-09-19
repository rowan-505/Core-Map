/**
 * Shared class tokens + class helpers for the public map sidebar surfaces.
 * Kept separate from sidebarUi.tsx so the component file only exports
 * components (react-refresh friendly). Presentation only.
 */

/** Quiet inset surface — prefer headings/dividers over nested cards. */
export const sidebarCard =
  'overflow-hidden bg-transparent';

/** Small uppercase muted label used for section titles and row labels. */
export const mutedLabel =
  'map-kicker text-map-muted';

/** Title class for selectable result/list rows (truncates or wraps for bilingual). */
export function resultTitleClass(multiline: boolean): string {
  return multiline
    ? 'map-clamp-2 block wrap-break-word text-[15px] font-medium leading-[1.55] text-map-ink'
    : 'map-clamp-1 block text-[15px] font-medium leading-[1.55] text-map-ink';
}

export const panelPad = 'px-4 py-4';
export const listDivider = 'divide-y divide-map-border/80';
export const controlHeight = 'h-11 lg:h-10';
