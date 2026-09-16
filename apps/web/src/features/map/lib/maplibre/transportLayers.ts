/** Martin transport overlay layers. Sources are registered in `transportSources.ts`. */
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { MAP_SYMBOL_TEXT_FONT } from '../../config';
import type { TransportBrowseMode } from '../../state/mapUiStore';
import type { MapEngine } from '../mapEngineTypes';
import type { ActiveTransportSources } from './transportSources';
import {
  TRANSPORT_FERRY_LANDINGS_LAYER_ID,
  TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID,
  TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
  TRANSPORT_INFRASTRUCTURE_LINES_LAYER_ID,
  TRANSPORT_LAYER_IDS,
  TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
  TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID,
  TRANSPORT_ROUTE_LABELS_LAYER_ID,
  TRANSPORT_ROUTE_PATHS_LAYER_ID,
  TRANSPORT_STOP_HIGHLIGHT_LAYER_IDS,
  TRANSPORT_STOP_LABELS_LAYER_ID,
  TRANSPORT_STOPS_LAYER_ID,
  TRANSPORT_STOPS_HITBOX_LAYER_ID,
} from './publicMapMarkerLayerIds';
import { TRANSPORT_POINT_HITBOX_LAYER_IDS } from './publicMapClickableLayerRegistry';
import { applyMapLayerStackBottomToTop } from './mapLayerStack';
import { PUBLIC_MAP_OVERLAY_STACK_BOTTOM_TO_TOP } from './publicMapMarkerStackOrder';
import {
  LABEL_SORT_KEY,
  LABEL_ZOOM,
  labelFadeInOpacity,
  linearZoomTextSize,
  TEXT_SIZE_TRANSPORT_DENSE_STOP,
  TEXT_SIZE_TRANSPORT_MAJOR_STOP,
  TEXT_SIZE_TRANSPORT_ROUTE,
  TEXT_SIZE_TRANSPORT_TERMINAL,
} from './publicMapLabelPolicy';
import {
  TRANSPORT_MARKER_COLORS,
  transportPointHitboxRadius,
} from './publicMapMarkerStyles';
import {
  clearTransportStopHighlights,
  setTransportHighlightLayersVisible,
} from './transportStopHighlight';
import {
  transportModeColorExpression,
} from './transportModeStyle';
import {
  TRANSPORT_PATH_DEFAULT_OPACITY,
  transportRouteLinePaint,
} from './transportRoutePaint';

export {
  TRANSPORT_FERRY_LANDINGS_LAYER_ID,
  TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID,
  TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
  TRANSPORT_INFRASTRUCTURE_LINES_LAYER_ID,
  TRANSPORT_LAYER_IDS,
  TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
  TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID,
  TRANSPORT_POINT_LAYER_IDS,
  TRANSPORT_ROUTE_LABELS_LAYER_ID,
  TRANSPORT_ROUTE_PATHS_LAYER_ID,
  TRANSPORT_STOP_LABELS_LAYER_ID,
  TRANSPORT_STOPS_LAYER_ID,
  TRANSPORT_STOPS_HITBOX_LAYER_ID,
} from './publicMapMarkerLayerIds';

export {
  TRANSPORT_POINT_HITBOX_LAYER_IDS,
  TRANSPORT_POINT_HIT_LAYER_IDS,
  TRANSPORT_SELECTED_POINT_CLICK_LAYER_IDS,
} from './publicMapClickableLayerRegistry';

/** Every transport overlay layer (incl. labels + hitboxes + selected/hover) — visibility toggling. */
export const TRANSPORT_OVERLAY_LAYER_IDS = [
  ...TRANSPORT_LAYER_IDS,
  ...TRANSPORT_STOP_HIGHLIGHT_LAYER_IDS,
  TRANSPORT_ROUTE_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID,
  TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID,
  TRANSPORT_STOP_LABELS_LAYER_ID,
  ...TRANSPORT_POINT_HITBOX_LAYER_IDS,
] as const;

/** Route label: human route name first, else the route code. */
const TRANSPORT_ROUTE_LABEL_TEXT_FIELD: ExpressionSpecification = [
  'coalesce',
  ['get', 'public_name'],
  ['get', 'route_code'],
];

/** Only label route features that actually carry a public name or route code. */
const TRANSPORT_ROUTE_LABEL_FILTER: ExpressionSpecification = [
  'any',
  ['to-boolean', ['get', 'public_name']],
  ['to-boolean', ['get', 'route_code']],
];

/**
 * A name field is a real, user-safe name when it is present AND not a generated OSM fallback.
 * Generated import names (e.g. `ferry_terminal osm:N:...`, `osm:W:123`) all contain the
 * `osm:` token, so a single substring test mirrors the `transportDisplayName` helpers without
 * regex (MapLibre `index-of`). Empty/absent fields coalesce to '' → treated as not-a-name.
 */
function realNameFieldExpression(field: string): ExpressionSpecification {
  return [
    'all',
    ['!=', ['coalesce', ['get', field], ''], ''],
    ['==', ['index-of', 'osm:', ['coalesce', ['get', field], '']], -1],
  ] as ExpressionSpecification;
}

/** True when any of name_mm / name_en / name is a real (non-blank, non-generated) name. */
const HAS_REAL_TRANSPORT_NAME: ExpressionSpecification = [
  'any',
  realNameFieldExpression('name_mm'),
  realNameFieldExpression('name_en'),
  realNameFieldExpression('name'),
];

/**
 * Label text = the FIRST real name among name_mm → name_en → name, else '' (no label).
 * Unlike a plain `coalesce`, this never falls through to a generated `osm:` value: a field
 * is only chosen when it passes `realNameFieldExpression`, so generated/blank names can never
 * be rendered as a map label even if the layer filter changes. Used by stop AND terminal labels.
 */
const REAL_TRANSPORT_NAME_TEXT_FIELD: ExpressionSpecification = [
  'case',
  realNameFieldExpression('name_mm'),
  ['get', 'name_mm'],
  realNameFieldExpression('name_en'),
  ['get', 'name_en'],
  realNameFieldExpression('name'),
  ['get', 'name'],
  '',
] as ExpressionSpecification;

const TERMINAL_IS_FERRY: ExpressionSpecification = ['==', ['get', 'mode'], 'ferry'];

/** Reviewed (review_status present and not the OSM import default) OR high confidence (≥80). */
const TERMINAL_IS_REVIEWED_OR_HIGH_CONFIDENCE: ExpressionSpecification = [
  'any',
  [
    'all',
    ['!=', ['coalesce', ['get', 'review_status'], ''], ''],
    ['!=', ['coalesce', ['get', 'review_status'], ''], 'imported_unreviewed'],
  ],
  ['>=', ['coalesce', ['get', 'confidence_score'], 0], 80],
];

/** A ferry that has earned a real name AND review/high-confidence is promoted to major. */
const FERRY_PROMOTED_TO_MAJOR: ExpressionSpecification = [
  'all',
  HAS_REAL_TRANSPORT_NAME,
  TERMINAL_IS_REVIEWED_OR_HIGH_CONFIDENCE,
];

/**
 * Major terminals: named, non-generated. Non-ferry modes (bus/train/air) qualify on a real
 * name alone; ferries only qualify once reviewed/high-confidence. Unnamed and generated-name
 * terminals are excluded entirely.
 */
const MAJOR_TERMINALS_FILTER: ExpressionSpecification = [
  'all',
  HAS_REAL_TRANSPORT_NAME,
  ['any', ['!', TERMINAL_IS_FERRY], TERMINAL_IS_REVIEWED_OR_HIGH_CONFIDENCE],
];

/** Ferry landings: every ferry that has NOT been promoted to a major terminal. */
const FERRY_LANDINGS_FILTER: ExpressionSpecification = [
  'all',
  TERMINAL_IS_FERRY,
  ['!', FERRY_PROMOTED_TO_MAJOR],
];

/**
 * Transport overlay palette tokens — see `publicMapMarkerStyles.ts`.
 */
const TRANSPORT_STOP_LABEL_COLOR = TRANSPORT_MARKER_COLORS.label;

let selectedTransportStopId: string | null = null;
let activePointSourceLayer = 'transport_bus_stops';
let activePathSourceLayer = 'transport_bus_route_overview';
let activePointMinZoom = 11;
let activePathMinZoom = 11;
let activePointModeFilter: ExpressionSpecification | null = null;
let activePathModeFilter: ExpressionSpecification | null = null;

function excludeSelectedPointFilter(
  baseFilter: ExpressionSpecification | undefined,
  selectedId: string | null,
): ExpressionSpecification {
  if (!selectedId) {
    return baseFilter ?? (['has', 'id'] as ExpressionSpecification);
  }
  const excludeSelected: ExpressionSpecification = [
    'all',
    ['!=', ['to-string', ['coalesce', ['get', 'id'], '']], selectedId],
    ['!=', ['to-string', ['coalesce', ['get', 'public_id'], '']], selectedId],
  ];
  if (!baseFilter) return ['all', ['has', 'id'], excludeSelected];
  return ['all', baseFilter, excludeSelected];
}

/** Hides the tile stop/terminal dot under the selected pin overlay. */
export function setTransportSelectedStopId(map: MapEngine, selectedId: string | null): void {
  selectedTransportStopId = selectedId;
  applyTransportPointSelectionFilters(map);
}

function applyTransportPointSelectionFilters(map: MapEngine): void {
  if (map.getLayer(TRANSPORT_STOPS_LAYER_ID)) {
    map.setFilter(
      TRANSPORT_STOPS_LAYER_ID,
      excludeSelectedPointFilter(activePointModeFilter ?? undefined, selectedTransportStopId),
    );
  }
  if (map.getLayer(TRANSPORT_STOPS_HITBOX_LAYER_ID)) {
    map.setFilter(
      TRANSPORT_STOPS_HITBOX_LAYER_ID,
      excludeSelectedPointFilter(activePointModeFilter ?? undefined, selectedTransportStopId),
    );
  }
  if (map.getLayer(TRANSPORT_MAJOR_TERMINALS_LAYER_ID)) {
    map.setFilter(
      TRANSPORT_MAJOR_TERMINALS_LAYER_ID,
      excludeSelectedPointFilter(activePointModeFilter ?? undefined, selectedTransportStopId),
    );
  }
  if (map.getLayer(TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID)) {
    map.setFilter(
      TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
      excludeSelectedPointFilter(activePointModeFilter ?? undefined, selectedTransportStopId),
    );
  }
  if (map.getLayer(TRANSPORT_FERRY_LANDINGS_LAYER_ID)) {
    map.setFilter(
      TRANSPORT_FERRY_LANDINGS_LAYER_ID,
      excludeSelectedPointFilter(FERRY_LANDINGS_FILTER, selectedTransportStopId),
    );
  }
  if (map.getLayer(TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID)) {
    map.setFilter(
      TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
      excludeSelectedPointFilter(FERRY_LANDINGS_FILTER, selectedTransportStopId),
    );
  }
}

// Label placement priority. MapLibre places/draws features with the LOWER symbol-sort-key first,
// so the most important transport labels get the smallest values and win collisions against the
// less important ones (and over basemap labels, which carry no transport sort-key). Labels are
// collision-managed (no forced overlap) for a clean, professional look.
const TRANSPORT_MAJOR_LABEL_SORT_KEY = LABEL_SORT_KEY.transportTerminal;
const TRANSPORT_MAJOR_STOP_LABEL_SORT_KEY = LABEL_SORT_KEY.transportMajorStop;
const TRANSPORT_ROUTE_LABEL_SORT_KEY = LABEL_SORT_KEY.transportRoute;
const TRANSPORT_STOP_LABEL_SORT_KEY = LABEL_SORT_KEY.transportDenseStop;

/** Station/terminal-class stop types — the "major" stops surfaced earlier than ordinary stops. */
const MAJOR_STOP_TYPES = [
  'station',
  'bus_station',
  'terminal',
  'rail_station',
  'ferry_terminal',
  'airport',
];

/**
 * Major stop = station/terminal-class `stop_type`. The Martin stop tiles carry no
 * `importance_score`, so `stop_type` is the deterministic "major" signal (ordinary `bus_stop`s
 * are the normal tier). Used to split stop labels into an early, sparse major tier and a
 * high-zoom-only ordinary tier.
 */
const MAJOR_STOP_FILTER: ExpressionSpecification = [
  'in',
  ['coalesce', ['get', 'stop_type'], 'bus_stop'],
  ['literal', MAJOR_STOP_TYPES],
];

function withModeFilter(
  filter: ExpressionSpecification | undefined,
  modeFilter: ExpressionSpecification | null,
): ExpressionSpecification | undefined {
  if (!modeFilter) return filter;
  return filter ? ['all', modeFilter, filter] : modeFilter;
}

function legacyModeFilter(mode: string): ExpressionSpecification {
  return ['==', ['get', 'mode'], mode];
}

// Transport overlay layer — transit route paths. Color is mode-driven (bus=violet, rail=teal,
// ferry=blue, other=slate) via `transportModeColorExpression`. Deliberately restrained: thin and
// translucent at low zoom so routes read as a faint network over the roads, growing to a clear
// (but still not overpowering) line when zoomed in.
/** Exported for style-spec regression validation. */
export function buildTransportRoutePathsLayer(): LineLayerSpecification {
  return {
    id: TRANSPORT_ROUTE_PATHS_LAYER_ID,
    type: 'line',
    source: 'transport-route-paths-source',
    'source-layer': activePathSourceLayer,
    minzoom: activePathMinZoom,
    filter: withModeFilter(undefined, activePathModeFilter),
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: transportRouteLinePaint(),
  };
}

// Express terminals. Compact circles keep nearby terminals readable without hiding route lines;
// their source minzoom handles the low-zoom density cutoff.
function majorTerminalsLayer(): CircleLayerSpecification {
  return {
    id: TRANSPORT_MAJOR_TERMINALS_LAYER_ID,
    type: 'circle',
    source: 'transport-terminals-source',
    'source-layer': activePointSourceLayer,
    minzoom: activePointMinZoom,
    filter: withModeFilter(undefined, activePointModeFilter),
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2, 12, 2.8, 16, 4, 19, 5.2],
      'circle-color': TRANSPORT_MARKER_COLORS.majorPoint,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 16, 1.2, 19, 1.5],
      'circle-opacity': 0.92,
      'circle-stroke-opacity': 0.96,
    },
  };
}

// Transport overlay layer — stops. Small mode-colored circles with white stroke; dense-friendly
// at local zooms. Station-class stops are slightly larger while remaining tightly capped.
function stopsLayer(): CircleLayerSpecification {
  return {
    id: TRANSPORT_STOPS_LAYER_ID,
    type: 'circle',
    source: 'transport-stops-source',
    'source-layer': activePointSourceLayer,
    minzoom: activePointMinZoom,
    filter: withModeFilter(undefined, activePointModeFilter),
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        8, ['case', MAJOR_STOP_FILTER, 2.4, 1.4],
        12, ['case', MAJOR_STOP_FILTER, 3, 1.8],
        15, ['case', MAJOR_STOP_FILTER, 4, 2.6],
        18, ['case', MAJOR_STOP_FILTER, 5.2, 3.8],
        20, ['case', MAJOR_STOP_FILTER, 6, 4.6],
      ],
      'circle-color': transportModeColorExpression(),
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 15, 1, 20, 1.3],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.68, 13, 0.82, 16, 0.94],
      'circle-stroke-opacity': 0.95,
    },
  };
}

// Transport overlay layer — MAJOR stop labels (z14+). Station/terminal-class stops only.
function majorStopLabelsLayer(): SymbolLayerSpecification {
  return {
    id: TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID,
    type: 'symbol',
    source: 'transport-stops-source',
    'source-layer': activePointSourceLayer,
    minzoom: LABEL_ZOOM.TRANSPORT_MAJOR_STOP_MIN,
    filter: withModeFilter(['all', HAS_REAL_TRANSPORT_NAME, MAJOR_STOP_FILTER], activePointModeFilter),
    layout: {
      visibility: 'none',
      'text-field': REAL_TRANSPORT_NAME_TEXT_FIELD,
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': linearZoomTextSize(TEXT_SIZE_TRANSPORT_MAJOR_STOP),
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      'symbol-sort-key': TRANSPORT_MAJOR_STOP_LABEL_SORT_KEY,
    },
    paint: {
      'text-color': TRANSPORT_STOP_LABEL_COLOR,
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4,
      'text-opacity': labelFadeInOpacity(LABEL_ZOOM.TRANSPORT_MAJOR_STOP_MIN),
    },
  };
}

// Transport overlay layer — ordinary stop labels (z18+ only).
// Transit-tinted text with a white halo; collision-managed (no forced overlap) for a clean map.
// The text-field resolves only to a real name, so generated OSM fallbacks never render.
function stopLabelsLayer(): SymbolLayerSpecification {
  return {
    id: TRANSPORT_STOP_LABELS_LAYER_ID,
    type: 'symbol',
    source: 'transport-stops-source',
    'source-layer': activePointSourceLayer,
    minzoom: LABEL_ZOOM.TRANSPORT_DENSE_STOP_MIN,
    filter: withModeFilter(['all', HAS_REAL_TRANSPORT_NAME, ['!', MAJOR_STOP_FILTER]], activePointModeFilter),
    layout: {
      visibility: 'none',
      'text-field': REAL_TRANSPORT_NAME_TEXT_FIELD,
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': linearZoomTextSize(TEXT_SIZE_TRANSPORT_DENSE_STOP),
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      // Collision-managed: ordinary stop labels yield to each other and to higher-priority labels.
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      'symbol-sort-key': TRANSPORT_STOP_LABEL_SORT_KEY,
    },
    paint: {
      'text-color': TRANSPORT_STOP_LABEL_COLOR,
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4,
      'text-opacity': labelFadeInOpacity(LABEL_ZOOM.TRANSPORT_DENSE_STOP_MIN),
    },
  };
}

// Transport overlay layer — major terminal labels (z12+).
// Filtered to major terminals (named, non-generated) and the text-field only ever resolves to
// a real name (never a generated OSM fallback), so unnamed/generated terminals get no label.
// Point-placed, non-overlapping so they yield to existing basemap labels and each other.
function majorTerminalLabelsLayer(): SymbolLayerSpecification {
  return {
    id: TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID,
    type: 'symbol',
    source: 'transport-terminals-source',
    'source-layer': activePointSourceLayer,
    minzoom: LABEL_ZOOM.TRANSPORT_TERMINAL_MIN,
    filter: withModeFilter(['all', MAJOR_TERMINALS_FILTER, HAS_REAL_TRANSPORT_NAME], activePointModeFilter),
    layout: {
      visibility: 'none',
      'text-field': REAL_TRANSPORT_NAME_TEXT_FIELD,
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': linearZoomTextSize(TEXT_SIZE_TRANSPORT_TERMINAL),
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      // Collision-managed; prioritized over stops/routes via a low sort-key.
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      'symbol-sort-key': TRANSPORT_MAJOR_LABEL_SORT_KEY,
    },
    paint: {
      'text-color': TRANSPORT_STOP_LABEL_COLOR,
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.5,
      'text-opacity': labelFadeInOpacity(LABEL_ZOOM.TRANSPORT_TERMINAL_MIN),
    },
  };
}

// Transport overlay layer — ferry landing labels (z18+).
// Filtered to ferry landings that have a real name; the text-field never resolves to a
// generated OSM fallback. Smaller text to match the subtle ferry-landing markers. Most ferry
// landings are unnamed/generated, so this labels only the small named subset.
// Transport overlay layer — route labels (z13+). Line-placed along the route and filtered to
// features with a public_name/route_code, so empty routes add no clutter and labels follow the
// path instead of stamping over roads. Non-overlapping to defer to basemap labels.
function routeLabelsLayer(): SymbolLayerSpecification {
  return {
    id: TRANSPORT_ROUTE_LABELS_LAYER_ID,
    type: 'symbol',
    source: 'transport-route-paths-source',
    'source-layer': activePathSourceLayer,
    minzoom: Math.max(activePathMinZoom, LABEL_ZOOM.TRANSPORT_ROUTE_MIN),
    filter: withModeFilter(TRANSPORT_ROUTE_LABEL_FILTER, activePathModeFilter),
    layout: {
      visibility: 'none',
      'symbol-placement': 'line',
      'symbol-spacing': 450,
      'text-field': TRANSPORT_ROUTE_LABEL_TEXT_FIELD,
      'text-font': [...MAP_SYMBOL_TEXT_FONT],
      'text-size': linearZoomTextSize(TEXT_SIZE_TRANSPORT_ROUTE),
      'text-max-angle': 35,
      'text-padding': 6,
      // Collision-managed: route labels defer to basemap and higher-priority transport labels.
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      'symbol-sort-key': TRANSPORT_ROUTE_LABEL_SORT_KEY,
    },
    paint: {
      'text-color': '#0e7490',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.5,
      'text-opacity': labelFadeInOpacity(LABEL_ZOOM.TRANSPORT_ROUTE_MIN),
    },
  };
}

/** Shared paint for invisible transport click hitboxes (must stay visually imperceptible). */
function transportPointHitboxPaint(): CircleLayerSpecification['paint'] {
  return {
    'circle-radius': transportPointHitboxRadius(),
    'circle-color': '#000000',
    'circle-opacity': 0,
    'circle-stroke-width': 0,
    'circle-stroke-opacity': 0,
  };
}

// Transport overlay layer — invisible click hitbox for all stops (bus_stop + station-class).
// Same source/filter as `transport-stops`; radius is larger than the visual dot (see policy).
function stopsHitboxLayer(): CircleLayerSpecification {
  return {
    id: TRANSPORT_STOPS_HITBOX_LAYER_ID,
    type: 'circle',
    source: 'transport-stops-source',
    'source-layer': activePointSourceLayer,
    minzoom: activePointMinZoom,
    filter: withModeFilter(undefined, activePointModeFilter),
    layout: { visibility: 'none' },
    paint: transportPointHitboxPaint(),
  };
}

function majorTerminalsHitboxLayer(): CircleLayerSpecification {
  // Invisible click target — same source/filter as `transport-major-terminals`.
  return {
    id: TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
    type: 'circle',
    source: 'transport-terminals-source',
    'source-layer': activePointSourceLayer,
    minzoom: activePointMinZoom,
    filter: withModeFilter(undefined, activePointModeFilter),
    layout: { visibility: 'none' },
    paint: transportPointHitboxPaint(),
  };
}

/**
 * Adds every transport overlay layer, all hidden (`visibility: 'none'`).
 * Idempotent: layers that already exist (after a style reload or re-render) are skipped,
 * so it is safe to call from every `load` handler. Sources must be added first.
 */
export function addTransportLayers(
  map: MapEngine,
  _mode: TransportBrowseMode,
  visibility: { readonly points: boolean; readonly paths: boolean },
  activeSources: ActiveTransportSources,
): void {
  const points = activeSources.points;
  const paths = activeSources.paths;
  if (points) {
    activePointSourceLayer = points.sourceLayer;
    activePointMinZoom = points.minZoom;
    activePointModeFilter = points.legacyModeFilter
      ? legacyModeFilter(points.legacyModeFilter)
      : null;
  }
  if (paths) {
    activePathSourceLayer = paths.sourceLayer;
    activePathMinZoom = paths.minZoom;
    activePathModeFilter = paths.legacyModeFilter
      ? legacyModeFilter(paths.legacyModeFilter)
      : null;
  }

  const layers: Array<CircleLayerSpecification | LineLayerSpecification | SymbolLayerSpecification> = [];
  if (visibility.paths) layers.push(buildTransportRoutePathsLayer(), routeLabelsLayer());
  if (visibility.points && _mode === 'express') {
    layers.push(majorTerminalsLayer(), majorTerminalLabelsLayer(), majorTerminalsHitboxLayer());
  } else if (visibility.points) {
    layers.push(stopsLayer(), majorStopLabelsLayer(), stopLabelsLayer(), stopsHitboxLayer());
  }

  for (const layer of layers) {
    if (map.getLayer(layer.id)) continue;
    map.addLayer(layer);
    map.setLayoutProperty(layer.id, 'visibility', 'visible');
  }
}

const TRANSPORT_DATA_LAYER_IDS = [
  TRANSPORT_INFRASTRUCTURE_LINES_LAYER_ID,
  TRANSPORT_ROUTE_PATHS_LAYER_ID,
  TRANSPORT_STOPS_LAYER_ID,
  TRANSPORT_FERRY_LANDINGS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_LAYER_ID,
  TRANSPORT_ROUTE_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID,
  TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID,
  TRANSPORT_STOP_LABELS_LAYER_ID,
  TRANSPORT_STOPS_HITBOX_LAYER_ID,
  TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
] as const;

/** Remove mode-specific data layers before swapping their Martin sources. */
export function removeTransportLayers(map: MapEngine): void {
  for (const layerId of [...TRANSPORT_DATA_LAYER_IDS].reverse()) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
}

/** Dim overview paths while the separate selected-route API overlay is visible. */
export function setTransportRouteSelectionActive(map: MapEngine, selected: boolean): void {
  if (!map.getLayer(TRANSPORT_ROUTE_PATHS_LAYER_ID)) return;
  map.setPaintProperty(
    TRANSPORT_ROUTE_PATHS_LAYER_ID,
    'line-opacity',
    selected ? 0.14 : TRANSPORT_PATH_DEFAULT_OPACITY,
  );
}

/**
 * Shows or hides every transport overlay layer. Only flips `visibility` — basemap and
 * other layers are untouched. Missing layers (overlay not configured) are skipped.
 */
export function setTransportOverlayVisible(map: MapEngine, visible: boolean): void {
  const visibility = visible ? 'visible' : 'none';
  for (const layerId of TRANSPORT_OVERLAY_LAYER_IDS) {
    if (!map.getLayer(layerId)) continue;
    map.setLayoutProperty(layerId, 'visibility', visibility);
  }
  setTransportHighlightLayersVisible(map, visible);
  if (!visible) {
    selectedTransportStopId = null;
    applyTransportPointSelectionFilters(map);
    clearTransportStopHighlights(map);
  }
}

/**
 * Restacks transport + all public overlays in {@link PUBLIC_MAP_OVERLAY_STACK_BOTTOM_TO_TOP}.
 * Idempotent — safe after regional PMTiles reload or overlay toggles.
 */
export function moveTransportLayersToTop(map: MapEngine): void {
  applyMapLayerStackBottomToTop(map, PUBLIC_MAP_OVERLAY_STACK_BOTTOM_TO_TOP);
}
