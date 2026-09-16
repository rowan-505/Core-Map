/**
 * Progressive basemap detail for apps/web — overview PMTiles (national z0–z8 archive)
 * plus **one** regional PMTiles source at a time (Yangon today; not all 15 regions).
 *
 * Zoom bands (MapLibre zoom levels):
 * - z4.3–z6.9: overview only — regional vector layers stay off (minzoom gates).
 * - z7+: regional OSM water/admin takes over; overview neighbor lines hidden; Myanmar country fill/outline persist via overzoom.
 * - z10+: overview labels off; regional roads, labels, and buildings dominate.
 *
 * Myanmar national fill/outline use Core `myanmar_country`. While the country
 * geom is imprecise, style maxzoom temporarily hides fill by ~z9 and outline by
 * ~z10 (smooth opacity fade). Do not apply the neighbor handoff maxzoom (z7).
 * Regional country/state admin from OSM/core `admin_boundaries` at z7+.
 *
 * Tile URLs are unchanged; only layer minzoom/maxzoom/opacity are adjusted at compose time.
 */
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import {
  OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_MAX_ZOOM,
  OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_LAYER_ID,
  REGIONAL_ADMIN_PRIMARY_BOUNDARY_COLOR,
  REGIONAL_ADMIN_PRIMARY_BOUNDARY_OPACITY,
  REGIONAL_ADMIN_PRIMARY_BOUNDARY_WIDTH,
  REGIONAL_ADMIN_PRIMARY_LEVEL_FILTER,
} from '../../../../../../../packages/map-style/overviewConstants.js';
import {
  NATIVE_REGION_TILE_MAX_ZOOM,
  REGIONAL_LAYER_OVERZOOM_MIN_MAX_ZOOM,
  REGIONAL_VECTOR_SOURCE_OVERZOOM_MAX_ZOOM,
} from '../../../../../../../packages/map-style/regionalZoomPolicy.js';
import { PUBLIC_MAP_OVERVIEW_MIN_ZOOM } from '../../config/publicMapViewport';

export {
  NATIVE_REGION_TILE_MAX_ZOOM,
  REGIONAL_LAYER_OVERZOOM_MIN_MAX_ZOOM,
  REGIONAL_VECTOR_SOURCE_OVERZOOM_MAX_ZOOM,
};

/** Lowest zoom the public map allows — overview framing. */
export const OVERVIEW_ONLY_MAX_ZOOM = 6.9;

/** Regional `local-basemap` layers begin appearing (single active region archive). */
export const REGIONAL_BASE_APPEAR_ZOOM = 7;

/**
 * MapLibre layer maxzoom floor for basemap geometry — must stay at or above public z20 (overzoom).
 * @deprecated Prefer {@link REGIONAL_LAYER_OVERZOOM_MIN_MAX_ZOOM}.
 */
export const REGIONAL_OVERZOOM_MAX_ZOOM = REGIONAL_LAYER_OVERZOOM_MIN_MAX_ZOOM;

/** Vector source maxzoom — native regional tiles z16 (camera may overzoom to z20). */
export const REGIONAL_VECTOR_SOURCE_MAX_ZOOM = REGIONAL_VECTOR_SOURCE_OVERZOOM_MAX_ZOOM;

/** Regional source-layers that must stay visible through public max zoom. */
export const REGIONAL_OVERZOOM_SOURCE_LAYERS = [
  'streets',
  'road_labels',
  'buildings',
  'water_polygons',
  'water_lines',
  'landuse',
  'admin_boundaries',
] as const;

const REGIONAL_OVERZOOM_SOURCE_LAYER_SET = new Set<string>(REGIONAL_OVERZOOM_SOURCE_LAYERS);

/** Single regional source (`local-basemap`) or QA clones (`local-basemap-<region>-<version>`). */
export function isRegionalBasemapVectorSource(source: unknown): boolean {
  return (
    source === 'local-basemap' ||
    (typeof source === 'string' && source.startsWith('local-basemap-'))
  );
}

/** Overview symbol layers turn off so regional street/admin labels are not doubled. */
export const OVERVIEW_LABELS_END_ZOOM = 10;

/** Matches overview PMTiles archive max zoom; regional detail intended from z7+. */
export const OVERVIEW_TILE_MAX_ZOOM = 8;

/** Overview admin0 outer border + neighbor lines hidden at z7+ for regional handoff. */
export const OVERVIEW_BOUNDARY_MAX_ZOOM = 7;

/** Neighbor/coastline only — internal state/region has a separate lifecycle. */
const OVERVIEW_BOUNDARY_LAYER_IDS = new Set([
  'neighbor-country-boundary-line',
  'overview-coastline',
]);

/**
 * Myanmar country fill + outline — keep style maxzoom (temporary z9/z10 hide).
 * Do not force the neighbor handoff maxzoom (z7) onto these layers.
 */
const OVERVIEW_PERSISTENT_COUNTRY_LAYER_IDS = new Set([
  'myanmar-country-fill',
  'myanmar-country-outline',
]);

/** @deprecated legacy ids — keep ignored by patch if present */
const OVERVIEW_ADMIN_COUNTRY_BOUNDARY_LAYER_IDS = OVERVIEW_PERSISTENT_COUNTRY_LAYER_IDS;

/** Neighbor country fills may fade at regional handoff; never Myanmar country fill. */
const OVERVIEW_ADMIN_FILL_LAYER_IDS = new Set(['overview-countries-fill']);

/**
 * Regional layer ids from `base-map.json` — raise minzoom so nothing draws below z7.
 * Roads (z10+) and building/label layers already start late; left as-is to avoid duplicate OSM detail.
 */
const REGIONAL_LAYER_MIN_ZOOM_FLOOR: Readonly<Record<string, number>> = {
  landuse: REGIONAL_BASE_APPEAR_ZOOM,
  'water-polygons': REGIONAL_BASE_APPEAR_ZOOM,
  'water-lines': REGIONAL_BASE_APPEAR_ZOOM,
  'admin-boundaries': REGIONAL_BASE_APPEAR_ZOOM,
};

const OVERVIEW_LABEL_LAYER_IDS = new Set([
  'overview-country-labels',
  'overview-admin-state-region-labels',
  'overview-populated-places',
]);

/** Fade overview place names out before regional street/POI labels (z10+). */
const OVERVIEW_PLACES_LABEL_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  5,
  0.65,
  8,
  0.82,
  9,
  0.45,
  OVERVIEW_LABELS_END_ZOOM,
  0,
];

/** Neighbor country labels — fade out before state/region labels dominate (z6+). */
const OVERVIEW_COUNTRY_LABEL_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  4,
  0.72,
  5,
  0.88,
  6,
  0.8,
  6.5,
  0.2,
  7,
  0,
];

/** Myanmar state/region labels — short overview names; fade by z9–z10. */
const OVERVIEW_ADMIN_STATE_REGION_LABEL_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  4,
  0.72,
  5,
  0.85,
  6,
  0.9,
  8,
  0.85,
  9,
  0.35,
  OVERVIEW_LABELS_END_ZOOM,
  0,
];

export function patchRegionalLayersForProgressiveDetail(
  layers: LayerSpecification[],
): LayerSpecification[] {
  return layers.map(patchRegionalLayer);
}

export function patchOverviewLayersForProgressiveDetail(
  layers: LayerSpecification[],
): LayerSpecification[] {
  return layers.map(patchOverviewLayerVisibility);
}

function applyRegionalOverzoomMax(layer: LayerSpecification): LayerSpecification {
  const sourceLayer = (layer as { 'source-layer'?: string })['source-layer'];
  const layerSource = 'source' in layer ? layer.source : undefined;
  if (
    !isRegionalBasemapVectorSource(layerSource) ||
    typeof sourceLayer !== 'string' ||
    !REGIONAL_OVERZOOM_SOURCE_LAYER_SET.has(sourceLayer)
  ) {
    return layer;
  }
  const currentMax = layer.maxzoom;
  if (currentMax !== undefined && currentMax >= REGIONAL_LAYER_OVERZOOM_MIN_MAX_ZOOM) {
    return layer;
  }
  // Never cap basemap geometry below public camera max zoom (z20 overzoom).
  if (currentMax === undefined) {
    return layer;
  }
  const { maxzoom: _removed, ...rest } = layer;
  return rest as LayerSpecification;
}

function patchRegionalLayer(layer: LayerSpecification): LayerSpecification {
  let patched = layer;

  if (layer.id === 'admin-boundaries' && layer.type === 'line') {
    const existingColor = layer.paint?.['line-color'];
    patched = {
      ...layer,
      minzoom: REGIONAL_BASE_APPEAR_ZOOM,
      layout: {
        ...layer.layout,
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        ...layer.paint,
        'line-color': [
          'case',
          REGIONAL_ADMIN_PRIMARY_LEVEL_FILTER,
          REGIONAL_ADMIN_PRIMARY_BOUNDARY_COLOR,
          existingColor ?? '#b8bcb6',
        ] as unknown as ExpressionSpecification,
        'line-width':
          REGIONAL_ADMIN_PRIMARY_BOUNDARY_WIDTH as unknown as ExpressionSpecification,
        'line-opacity':
          REGIONAL_ADMIN_PRIMARY_BOUNDARY_OPACITY as unknown as ExpressionSpecification,
      },
    };
  } else {
    const appearAt = REGIONAL_LAYER_MIN_ZOOM_FLOOR[layer.id];
    if (appearAt !== undefined) {
      patched = { ...layer, minzoom: appearAt };
    }
  }

  return applyRegionalOverzoomMax(patched);
}

function patchOverviewLayerVisibility(layer: LayerSpecification): LayerSpecification {
  if (OVERVIEW_ADMIN_COUNTRY_BOUNDARY_LAYER_IDS.has(layer.id)) {
    return layer;
  }

  if (OVERVIEW_BOUNDARY_LAYER_IDS.has(layer.id)) {
    return { ...layer, maxzoom: OVERVIEW_BOUNDARY_MAX_ZOOM };
  }

  if (layer.id === OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_LAYER_ID) {
    return { ...layer, maxzoom: OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_MAX_ZOOM };
  }

  if (OVERVIEW_ADMIN_FILL_LAYER_IDS.has(layer.id) && layer.type === 'fill') {
    return {
      ...layer,
      maxzoom: OVERVIEW_BOUNDARY_MAX_ZOOM,
      paint: {
        ...layer.paint,
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4,
          0.2,
          6,
          0.34,
          6.9,
          0.38,
          7,
          0.12,
          7.9,
          0,
        ] as ExpressionSpecification,
      },
    };
  }

  if (!OVERVIEW_LABEL_LAYER_IDS.has(layer.id)) {
    return layer;
  }

  if (layer.type !== 'symbol') {
    return { ...layer, maxzoom: OVERVIEW_LABELS_END_ZOOM };
  }

  if (layer.id === 'overview-country-labels') {
    return {
      ...layer,
      paint: {
        ...layer.paint,
        'text-opacity': OVERVIEW_COUNTRY_LABEL_OPACITY,
      },
    };
  }

  if (layer.id === 'overview-admin-state-region-labels') {
    return {
      ...layer,
      maxzoom: OVERVIEW_LABELS_END_ZOOM,
      paint: {
        ...layer.paint,
        'text-opacity': OVERVIEW_ADMIN_STATE_REGION_LABEL_OPACITY,
      },
    };
  }

  if (layer.id === 'overview-populated-places') {
    return {
      ...layer,
      maxzoom: OVERVIEW_LABELS_END_ZOOM,
      paint: {
        ...layer.paint,
        'text-opacity': OVERVIEW_PLACES_LABEL_OPACITY,
      },
    };
  }

  return layer;
}

/** Human-readable rules for docs/tests. */
export const BASEMAP_ZOOM_VISIBILITY_RULES = {
  overviewOnly: `z${PUBLIC_MAP_OVERVIEW_MIN_ZOOM}–z${OVERVIEW_ONLY_MAX_ZOOM}`,
  overviewBoundaries: `Neighbor/NE coastline maxzoom ${OVERVIEW_BOUNDARY_MAX_ZOOM}; Myanmar country fill maxzoom 9 / outline maxzoom 10 (temporary imprecise-geom hide); internal state/region through z${OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_MAX_ZOOM}`,
  regionalBase: `z${REGIONAL_BASE_APPEAR_ZOOM}+ (OSM water + admin_boundaries state_region; country outer border hidden)`,
  overviewLabels: `visible z${PUBLIC_MAP_OVERVIEW_MIN_ZOOM}–z${OVERVIEW_LABELS_END_ZOOM - 0.1}, faded/hidden z${OVERVIEW_LABELS_END_ZOOM}+`,
  regionalDominant: `z${OVERVIEW_LABELS_END_ZOOM}+ (warm road stack: major z8+, medium z10+, local z12.5+, minor z15+ per base-map.json)`,
} as const;
