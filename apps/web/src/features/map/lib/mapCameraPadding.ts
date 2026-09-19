import {
  MAP_DESKTOP_BREAKPOINT_PX,
  MAP_DESKTOP_COLLAPSED_LEFT_PADDING_PX,
  MAP_DESKTOP_OPEN_LEFT_PADDING_PX,
  MAP_SIDEBAR_WIDTH_PX,
  MAP_TABLET_BREAKPOINT_PX,
} from './mapChromeLayout';

export type MapCameraPadding = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

export type MapCameraLayout = {
  readonly isSidebarOpen: boolean;
  readonly bottomSheetState: 'collapsed' | 'half' | 'expanded';
};

export const DEFAULT_MAP_CAMERA_LAYOUT: MapCameraLayout = {
  isSidebarOpen: true,
  bottomSheetState: 'half',
};

const DESKTOP_BREAKPOINT_PX = MAP_DESKTOP_BREAKPOINT_PX;
const DESKTOP_OPEN_LEFT_PADDING_PX = MAP_DESKTOP_OPEN_LEFT_PADDING_PX;
const DESKTOP_COLLAPSED_LEFT_PADDING_PX = MAP_DESKTOP_COLLAPSED_LEFT_PADDING_PX;

export function visibleMapCameraPadding(
  layout: MapCameraLayout,
  container: HTMLElement | null,
): MapCameraPadding {
  const width = container?.clientWidth ?? windowWidthFallback();
  const height = container?.clientHeight ?? windowHeightFallback();

  if (width >= DESKTOP_BREAKPOINT_PX) {
    return {
      top: 40,
      right: 80,
      bottom: 40,
      left: layout.isSidebarOpen
        ? DESKTOP_OPEN_LEFT_PADDING_PX
        : DESKTOP_COLLAPSED_LEFT_PADDING_PX,
    };
  }

  if (width >= MAP_TABLET_BREAKPOINT_PX) {
    return {
      top: 76,
      right: 80,
      bottom: 40,
      left: layout.isSidebarOpen ? MAP_SIDEBAR_WIDTH_PX + 16 : 24,
    };
  }

  return {
    top: 72,
    right: 24,
    bottom: mobileBottomPadding(layout, height),
    left: 24,
  };
}

function mobileBottomPadding(layout: MapCameraLayout, height: number): number {
  if (!layout.isSidebarOpen) return 32;

  const sheetHeight =
    layout.bottomSheetState === 'expanded'
      ? height * 0.86
      : layout.bottomSheetState === 'collapsed'
        ? 76
        : height * 0.48;

  // Leave at least a narrow map viewport above the bottom sheet for camera fitting.
  return Math.min(sheetHeight + 24, Math.max(96, height - 160));
}

function windowWidthFallback(): number {
  if (typeof window === 'undefined') return DESKTOP_BREAKPOINT_PX;
  return window.innerWidth;
}

function windowHeightFallback(): number {
  if (typeof window === 'undefined') return 800;
  return window.innerHeight;
}
