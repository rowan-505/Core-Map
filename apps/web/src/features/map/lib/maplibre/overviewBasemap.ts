/** Overview PMTiles layers (native z0–z8; country fill/outline overzoom to camera z20). */
import type {
  ExpressionSpecification,
  FillLayerSpecification,
  LayerSpecification,
  LineLayerSpecification,
  SourceSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import {
  OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_COLOR,
  OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_LAYER_ID,
  OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_MAX_ZOOM,
  OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_MIN_ZOOM,
  OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_OPACITY,
  OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_WIDTH,
  OVERVIEW_ADMIN_STATE_REGION_LABEL_FILTER,
  OVERVIEW_ADMIN_STATE_REGION_LABEL_HALO_COLOR,
  OVERVIEW_ADMIN_STATE_REGION_LABEL_HALO_WIDTH,
  OVERVIEW_ADMIN_STATE_REGION_LABEL_MAX_ZOOM,
  OVERVIEW_ADMIN_STATE_REGION_LABEL_MIN_ZOOM,
  OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_COLOR,
  OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_OPACITY,
  OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_PADDING,
  OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_SIZE,
  OVERVIEW_COUNTRY_LABEL_FILTER,
  OVERVIEW_COUNTRY_LABEL_HALO_COLOR,
  OVERVIEW_COUNTRY_LABEL_HALO_WIDTH,
  OVERVIEW_COUNTRY_LABEL_MAX_ZOOM,
  OVERVIEW_COUNTRY_LABEL_MIN_ZOOM,
  OVERVIEW_COUNTRY_LABEL_TEXT_COLOR,
  OVERVIEW_COUNTRY_LABEL_TEXT_SIZE,
  OVERVIEW_EXCLUDE_MMR_COUNTRY_BOUNDARY_FILTER,
  OVERVIEW_LAND_FILL_COLOR,
  OVERVIEW_LAKES_FILTER,
  OVERVIEW_MAJOR_CITY_FILTER,
  OVERVIEW_MYANMAR_COUNTRY_FILL_COLOR,
  OVERVIEW_MYANMAR_COUNTRY_FILL_LAYER_ID,
  OVERVIEW_MYANMAR_COUNTRY_FILL_MAX_ZOOM,
  OVERVIEW_MYANMAR_COUNTRY_FILL_OPACITY,
  OVERVIEW_MYANMAR_COUNTRY_OUTLINE_COLOR,
  OVERVIEW_MYANMAR_COUNTRY_OUTLINE_LAYER_ID,
  OVERVIEW_MYANMAR_COUNTRY_OUTLINE_MAX_ZOOM,
  OVERVIEW_MYANMAR_COUNTRY_OUTLINE_MIN_ZOOM,
  OVERVIEW_MYANMAR_COUNTRY_OUTLINE_OPACITY,
  OVERVIEW_MYANMAR_COUNTRY_OUTLINE_WIDTH,
  OVERVIEW_MYANMAR_COUNTRY_SOURCE_LAYER,
  OVERVIEW_MYANMAR_STATE_LABELS_SOURCE_LAYER,
  OVERVIEW_MYANMAR_STATE_REGION_SOURCE_LAYER,
  OVERVIEW_NATIVE_MAX_ZOOM,
  OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_COLOR,
  OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_LAYER_ID,
  OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_OPACITY,
  OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_WIDTH,
  OVERVIEW_PMTILES_SOURCE_LAYERS,
  OVERVIEW_POPULATED_PLACES_MIN_ZOOM,
  OVERVIEW_RIVERS_FILTER,
} from '../../../../../../../packages/map-style/overviewConstants.js';
import {
  OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_FIELD,
  OVERVIEW_COUNTRY_LABEL_TEXT_FIELD,
  OVERVIEW_POPULATED_PLACES_TEXT_FIELD,
} from './overviewLabelTextFields';
import { OVERVIEW_BOUNDARY_MAX_ZOOM } from './basemapZoomVisibility';

const OVERVIEW_TEXT_FONT = ['NotoSansMyanmar-Regular'] as const;

export const OVERVIEW_SOURCE_ID = 'overview' as const;

/** Context layers may use native+1; country fill/outline use temporary hide maxzooms. */
const CONTEXT_LAYER_MAX_ZOOM = OVERVIEW_NATIVE_MAX_ZOOM + 1;

export const OVERVIEW_LAYER_IDS = [
  'overview-ocean',
  'overview-land',
  'myanmar-country-fill',
  'overview-lakes',
  'overview-rivers',
  'overview-countries-fill',
  'overview-coastline',
  'neighbor-country-boundary-line',
  'myanmar-internal-admin-boundary-line',
  'myanmar-country-outline',
  'overview-country-labels',
  'overview-admin-state-region-labels',
  'overview-populated-places',
] as const;

export type OverviewLayerId = (typeof OVERVIEW_LAYER_IDS)[number];

export const EXPECTED_OVERVIEW_SOURCE_LAYERS = OVERVIEW_PMTILES_SOURCE_LAYERS;

function toPmtilesSchemeUrl(httpUrl: string): string {
  const u = httpUrl.trim();
  if (!u) throw new Error('Empty overview PMTiles URL');
  return u.startsWith('pmtiles://') ? u : `pmtiles://${u}`;
}

/** Vector source — native maxzoom z8; MapLibre overzooms for camera z9–z20. */
export function createOverviewSource(pmtilesHttpUrl: string): SourceSpecification {
  return {
    type: 'vector',
    url: toPmtilesSchemeUrl(pmtilesHttpUrl),
    minzoom: 0,
    maxzoom: OVERVIEW_NATIVE_MAX_ZOOM,
  };
}

export const OVERVIEW_POPULATED_PLACES_FILTER =
  OVERVIEW_MAJOR_CITY_FILTER as unknown as ExpressionSpecification;

export function createOverviewLayers(): LayerSpecification[] {
  const src = OVERVIEW_SOURCE_ID;
  return [
    oceanLayer(src),
    landLayer(src),
    myanmarCountryFillLayer(src),
    lakesLayer(src),
    riversLayer(src),
    countriesFillLayer(src),
    coastlineLayer(src),
    countryBoundariesLayer(src),
    myanmarStateBoundariesLayer(src),
    myanmarCountryOutlineLayer(src),
    countryLabelsLayer(src),
    myanmarStateLabelsLayer(src),
    populatedPlacesLayer(src),
  ];
}

export function createOverviewBasemapStyle(pmtilesHttpUrl: string): StyleSpecification {
  return {
    version: 8,
    name: 'CoreMap Myanmar Overview',
    metadata: {
      'local-map:purpose': 'CoreMap Myanmar overview — Core country geom + NE world context.',
      'local-map:native-maxzoom': OVERVIEW_NATIVE_MAX_ZOOM,
      'local-map:country-fill-maxzoom': OVERVIEW_MYANMAR_COUNTRY_FILL_MAX_ZOOM,
      'local-map:country-outline-maxzoom': OVERVIEW_MYANMAR_COUNTRY_OUTLINE_MAX_ZOOM,
      'local-map:country-hide-note':
        'Temporary: imprecise country geom fades out by z9/z10; relax after QGIS replace.',
      'local-map:source-layers': OVERVIEW_PMTILES_SOURCE_LAYERS.join(','),
    },
    glyphs: '/fonts/{fontstack}/{range}.pbf',
    sources: {
      [OVERVIEW_SOURCE_ID]: createOverviewSource(pmtilesHttpUrl),
    },
    layers: createOverviewLayers(),
  };
}

function oceanLayer(source: string): FillLayerSpecification {
  return {
    id: 'overview-ocean',
    type: 'fill',
    source,
    'source-layer': 'ocean',
    maxzoom: CONTEXT_LAYER_MAX_ZOOM,
    paint: { 'fill-color': '#b8ddea', 'fill-opacity': 1 },
  };
}

function landLayer(source: string): FillLayerSpecification {
  return {
    id: 'overview-land',
    type: 'fill',
    source,
    'source-layer': 'land',
    maxzoom: CONTEXT_LAYER_MAX_ZOOM,
    paint: { 'fill-color': OVERVIEW_LAND_FILL_COLOR, 'fill-opacity': 1 },
  };
}

function myanmarCountryFillLayer(source: string): FillLayerSpecification {
  return {
    id: OVERVIEW_MYANMAR_COUNTRY_FILL_LAYER_ID,
    type: 'fill',
    source,
    'source-layer': OVERVIEW_MYANMAR_COUNTRY_SOURCE_LAYER,
    minzoom: 0,
    maxzoom: OVERVIEW_MYANMAR_COUNTRY_FILL_MAX_ZOOM,
    metadata: {
      'local-map:role': 'myanmar-country-fill',
      'local-map:note':
        'Core country geom tint. Temporary: fade out by z9 while geom is imprecise (style-only hide).',
    },
    paint: {
      'fill-color': OVERVIEW_MYANMAR_COUNTRY_FILL_COLOR,
      'fill-opacity': OVERVIEW_MYANMAR_COUNTRY_FILL_OPACITY as unknown as ExpressionSpecification,
    },
  };
}

function lakesLayer(source: string): FillLayerSpecification {
  return {
    id: 'overview-lakes',
    type: 'fill',
    source,
    'source-layer': 'lakes',
    minzoom: 6,
    maxzoom: CONTEXT_LAYER_MAX_ZOOM,
    filter: OVERVIEW_LAKES_FILTER as unknown as ExpressionSpecification,
    paint: {
      'fill-color': '#b9e2f4',
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.45, 7, 0.62, 8, 0.72],
    },
  };
}

function riversLayer(source: string): LineLayerSpecification {
  return {
    id: 'overview-rivers',
    type: 'line',
    source,
    'source-layer': 'rivers',
    minzoom: 6,
    maxzoom: CONTEXT_LAYER_MAX_ZOOM,
    filter: OVERVIEW_RIVERS_FILTER as unknown as ExpressionSpecification,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#8fd3ec',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 7, 0.58, 8, 0.7],
      'line-width': ['interpolate', ['exponential', 1.2], ['zoom'], 6, 0.4, 8, 0.9],
    },
  };
}

function countriesFillLayer(source: string): FillLayerSpecification {
  return {
    id: 'overview-countries-fill',
    type: 'fill',
    source,
    'source-layer': 'countries',
    maxzoom: OVERVIEW_BOUNDARY_MAX_ZOOM,
    filter: ['!=', ['upcase', ['coalesce', ['get', 'ADM0_A3'], '']], 'MMR'],
    paint: {
      'fill-color': '#e4e2dc',
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.16, 4, 0.2, 8, 0.26],
    },
  };
}

function coastlineLayer(source: string): LineLayerSpecification {
  return {
    id: 'overview-coastline',
    type: 'line',
    source,
    'source-layer': 'coastline',
    minzoom: 0,
    maxzoom: OVERVIEW_BOUNDARY_MAX_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#9bb8c4',
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.2, 5, 0.3, 8, 0.25],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.35, 6, 0.45, 8, 0.35],
    },
  };
}

function countryBoundariesLayer(source: string): LineLayerSpecification {
  return {
    id: OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_LAYER_ID,
    type: 'line',
    source,
    'source-layer': 'country_boundaries',
    minzoom: 0,
    maxzoom: OVERVIEW_BOUNDARY_MAX_ZOOM,
    filter: OVERVIEW_EXCLUDE_MMR_COUNTRY_BOUNDARY_FILTER as unknown as ExpressionSpecification,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    metadata: {
      'local-map:role': 'neighbor-country-boundaries',
      'local-map:note': 'NE neighbors only; Myanmar national edge is myanmar-country-outline.',
    },
    paint: {
      'line-color': OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_COLOR,
      'line-width': OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_WIDTH as unknown as ExpressionSpecification,
      'line-opacity':
        OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_OPACITY as unknown as ExpressionSpecification,
    },
  };
}

function myanmarStateBoundariesLayer(source: string): LineLayerSpecification {
  return {
    id: OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_LAYER_ID,
    type: 'line',
    source,
    'source-layer': OVERVIEW_MYANMAR_STATE_REGION_SOURCE_LAYER,
    minzoom: OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_MIN_ZOOM,
    maxzoom: OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_MAX_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    metadata: {
      'local-map:role': 'myanmar-internal-admin-boundaries',
      'local-map:note': 'Secondary to myanmar-country-outline; fades by z14.',
    },
    paint: {
      'line-color': OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_COLOR,
      'line-width': OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_WIDTH as unknown as ExpressionSpecification,
      'line-opacity':
        OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_OPACITY as unknown as ExpressionSpecification,
    },
  };
}

function myanmarCountryOutlineLayer(source: string): LineLayerSpecification {
  return {
    id: OVERVIEW_MYANMAR_COUNTRY_OUTLINE_LAYER_ID,
    type: 'line',
    source,
    'source-layer': OVERVIEW_MYANMAR_COUNTRY_SOURCE_LAYER,
    minzoom: OVERVIEW_MYANMAR_COUNTRY_OUTLINE_MIN_ZOOM,
    maxzoom: OVERVIEW_MYANMAR_COUNTRY_OUTLINE_MAX_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    metadata: {
      'local-map:role': 'myanmar-country-outline',
      'local-map:note':
        'National boundary from Core country geom. Temporary: fade out by z10 while geom is imprecise. Above internal state lines.',
    },
    paint: {
      'line-color': OVERVIEW_MYANMAR_COUNTRY_OUTLINE_COLOR,
      'line-opacity': OVERVIEW_MYANMAR_COUNTRY_OUTLINE_OPACITY as unknown as ExpressionSpecification,
      'line-width': OVERVIEW_MYANMAR_COUNTRY_OUTLINE_WIDTH as unknown as ExpressionSpecification,
    },
  };
}

function countryLabelsLayer(source: string): SymbolLayerSpecification {
  return {
    id: 'overview-country-labels',
    type: 'symbol',
    source,
    'source-layer': 'countries',
    minzoom: OVERVIEW_COUNTRY_LABEL_MIN_ZOOM,
    maxzoom: OVERVIEW_COUNTRY_LABEL_MAX_ZOOM,
    filter: OVERVIEW_COUNTRY_LABEL_FILTER as unknown as ExpressionSpecification,
    layout: {
      'symbol-placement': 'point',
      'text-field': OVERVIEW_COUNTRY_LABEL_TEXT_FIELD,
      'text-font': [...OVERVIEW_TEXT_FONT],
      'text-size': OVERVIEW_COUNTRY_LABEL_TEXT_SIZE as unknown as ExpressionSpecification,
      'text-max-width': 7,
      'text-padding': 52,
      'text-allow-overlap': false,
      'text-optional': true,
      'symbol-sort-key': ['-', ['coalesce', ['get', 'LABELRANK'], 10]],
    },
    paint: {
      'text-color': OVERVIEW_COUNTRY_LABEL_TEXT_COLOR,
      'text-halo-color': OVERVIEW_COUNTRY_LABEL_HALO_COLOR,
      'text-halo-width': OVERVIEW_COUNTRY_LABEL_HALO_WIDTH,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.72, 5, 0.88, 6, 0.8, 6.5, 0.2],
    },
  };
}

function myanmarStateLabelsLayer(source: string): SymbolLayerSpecification {
  return {
    id: 'overview-admin-state-region-labels',
    type: 'symbol',
    source,
    'source-layer': OVERVIEW_MYANMAR_STATE_LABELS_SOURCE_LAYER,
    minzoom: OVERVIEW_ADMIN_STATE_REGION_LABEL_MIN_ZOOM,
    maxzoom: OVERVIEW_ADMIN_STATE_REGION_LABEL_MAX_ZOOM,
    filter: OVERVIEW_ADMIN_STATE_REGION_LABEL_FILTER as unknown as ExpressionSpecification,
    layout: {
      'symbol-placement': 'point',
      'text-field': OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_FIELD,
      'text-font': [...OVERVIEW_TEXT_FONT],
      'text-size': OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_SIZE as unknown as ExpressionSpecification,
      'text-max-width': 6,
      'text-padding': OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_PADDING,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      // Prefer export sort_rank; else core_id map. Lower = higher priority than places (200).
      'symbol-sort-key': [
        'coalesce',
        ['to-number', ['get', 'sort_rank']],
        [
          'match',
          ['to-number', ['coalesce', ['get', 'core_id'], 0]],
          13,
          1,
          7169,
          2,
          7279,
          3,
          6832,
          4,
          7027,
          5,
          6703,
          6,
          7449,
          7,
          6031,
          8,
          6667,
          9,
          6007,
          10,
          5879,
          11,
          6744,
          12,
          5089,
          13,
          6722,
          14,
          6329,
          15,
          50,
        ],
      ],
    },
    metadata: {
      'local-map:role': 'myanmar-state-labels',
      'local-map:note':
        'Overview short aliases (label_name_mm); 15 official states; higher priority than populated places.',
    },
    paint: {
      'text-color': OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_COLOR,
      'text-halo-color': OVERVIEW_ADMIN_STATE_REGION_LABEL_HALO_COLOR,
      'text-halo-width': OVERVIEW_ADMIN_STATE_REGION_LABEL_HALO_WIDTH,
      'text-opacity':
        OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_OPACITY as unknown as ExpressionSpecification,
    },
  };
}

function populatedPlacesLayer(source: string): SymbolLayerSpecification {
  return {
    id: 'overview-populated-places',
    type: 'symbol',
    source,
    'source-layer': 'populated_places',
    minzoom: OVERVIEW_POPULATED_PLACES_MIN_ZOOM,
    maxzoom: CONTEXT_LAYER_MAX_ZOOM,
    filter: OVERVIEW_POPULATED_PLACES_FILTER,
    layout: {
      'symbol-placement': 'point',
      'text-field': OVERVIEW_POPULATED_PLACES_TEXT_FIELD,
      'text-font': [...OVERVIEW_TEXT_FONT],
      'text-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7,
        ['case', ['==', ['coalesce', ['get', 'ADM0CAP'], 0], 1], 10.5, 9.5],
        8,
        ['case', ['==', ['coalesce', ['get', 'ADM0CAP'], 0], 1], 12, 10.5],
      ],
      'text-padding': 28,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      // Yield to Myanmar state labels (sort_rank 1–15) and country labels.
      'symbol-sort-key': 200,
    },
    paint: {
      'text-color': '#4a4f56',
      'text-halo-color': '#f7f8f6',
      'text-halo-width': 1.1,
    },
  };
}

/** Fast validation of overview layer definitions. */
export function validateOverviewLayers(layers: LayerSpecification[] = createOverviewLayers()): string[] {
  const issues: string[] = [];
  const ids = layers.map((l) => l.id);
  if (ids.join(',') !== OVERVIEW_LAYER_IDS.join(',')) {
    issues.push(`layer id order mismatch: expected ${OVERVIEW_LAYER_IDS.join(', ')}`);
  }
  const fill = layers.find((l) => l.id === OVERVIEW_MYANMAR_COUNTRY_FILL_LAYER_ID);
  const outline = layers.find((l) => l.id === OVERVIEW_MYANMAR_COUNTRY_OUTLINE_LAYER_ID);
  if (fill?.maxzoom !== OVERVIEW_MYANMAR_COUNTRY_FILL_MAX_ZOOM) {
    issues.push(
      `myanmar-country-fill maxzoom must be ${OVERVIEW_MYANMAR_COUNTRY_FILL_MAX_ZOOM} (temporary imprecise-geom hide)`,
    );
  }
  if (outline?.maxzoom !== OVERVIEW_MYANMAR_COUNTRY_OUTLINE_MAX_ZOOM) {
    issues.push(
      `myanmar-country-outline maxzoom must be ${OVERVIEW_MYANMAR_COUNTRY_OUTLINE_MAX_ZOOM} (temporary imprecise-geom hide)`,
    );
  }
  const internalIdx = ids.indexOf(OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_LAYER_ID);
  const outlineIdx = ids.indexOf(OVERVIEW_MYANMAR_COUNTRY_OUTLINE_LAYER_ID);
  if (internalIdx >= 0 && outlineIdx >= 0 && internalIdx > outlineIdx) {
    issues.push('myanmar-country-outline must paint after internal state boundaries');
  }
  return issues;
}

/** @deprecated Prefer {@link validateOverviewLayers} */
export const validateOverviewLayerDefinitions = validateOverviewLayers;
