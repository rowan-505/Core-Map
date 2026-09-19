/**
 * Shared public-map chrome sizes. Keep rail, sidebar, and camera padding in sync.
 * Presentation only — no map or API behavior.
 */

export const MAP_RAIL_WIDTH_PX = 64;
export const MAP_SIDEBAR_WIDTH_PX = 380;
export const MAP_HEADER_HEIGHT_PX = 64;
export const MAP_CONTROL_SIZE_PX = 40;
export const MAP_DESKTOP_BREAKPOINT_PX = 1024;
export const MAP_TABLET_BREAKPOINT_PX = 768;

/** Left padding when the desktop sidebar is open: rail + sidebar. */
export const MAP_DESKTOP_OPEN_LEFT_PADDING_PX = MAP_RAIL_WIDTH_PX + MAP_SIDEBAR_WIDTH_PX;

/** Left padding when only the rail is visible. */
export const MAP_DESKTOP_COLLAPSED_LEFT_PADDING_PX = MAP_RAIL_WIDTH_PX + 16;
