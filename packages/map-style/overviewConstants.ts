/** MapLibre vector source id for the Myanmar overview PMTiles archive (native z0–z8). */
export const OVERVIEW_VECTOR_SOURCE_ID = 'overview' as const;

/**
 * Native tippecanoe / PMTiles max zoom for overview tiles.
 * Camera may go higher; MapLibre overzooms these z8 tiles.
 */
export const OVERVIEW_NATIVE_MAX_ZOOM = 8;

/** @deprecated Prefer OVERVIEW_NATIVE_MAX_ZOOM */
export const OVERVIEW_MAX_ZOOM = OVERVIEW_NATIVE_MAX_ZOOM;

/**
 * Public map camera max zoom (overzooms overview z8 and regional z16).
 * Keep in sync with packages/map-style/regionalZoomPolicy PUBLIC_MAP_MAX_ZOOM.
 */
export const OVERVIEW_PUBLIC_CAMERA_MAX_ZOOM = 20;

/**
 * Temporary MapLibre maxzoom for Myanmar country fill (imprecise geom hide).
 * Keep visible at national zooms; fully off by ~z9. Relax after QGIS country geom.
 */
export const OVERVIEW_MYANMAR_COUNTRY_FILL_MAX_ZOOM = 9;

/**
 * Temporary MapLibre maxzoom for Myanmar country outline (imprecise geom hide).
 * Fades after fill; fully off by ~z10. Relax after QGIS country geom.
 */
export const OVERVIEW_MYANMAR_COUNTRY_OUTLINE_MAX_ZOOM = 10;

/**
 * @deprecated Prefer OVERVIEW_MYANMAR_COUNTRY_FILL_MAX_ZOOM /
 * OVERVIEW_MYANMAR_COUNTRY_OUTLINE_MAX_ZOOM (temporary high-zoom hide).
 */
export const OVERVIEW_COUNTRY_LAYER_MAX_ZOOM = OVERVIEW_MYANMAR_COUNTRY_OUTLINE_MAX_ZOOM;

/** MapLibre layer maxzoom for non-persistent overview context (optional fade). */
export const OVERVIEW_LAYER_MAX_ZOOM = OVERVIEW_NATIVE_MAX_ZOOM + 1;

/** Public map viewport — locked to the overview PMTiles extent framing. */
export const MYANMAR_OVERVIEW_CENTER: [number, number] = [96.2, 20.5];
export const MYANMAR_OVERVIEW_ZOOM = 4.7;
export const MYANMAR_OVERVIEW_MIN_ZOOM = 4.3;

export const MYANMAR_OVERVIEW_MAX_BOUNDS: readonly [[number, number], [number, number]] = [
  [78.0, 3.0],
  [112.0, 34.0],
];

export const DEFAULT_OVERVIEW_CURRENT_JSON_URL =
  'http://localhost:8080/overview/regions/current.json';

export const OVERVIEW_PMTILES_URL_PLACEHOLDER = '__OVERVIEW_PMTILES_URL__' as const;

export const OVERVIEW_PMTILES_SOURCE_URL_PLACEHOLDER =
  `pmtiles://${OVERVIEW_PMTILES_URL_PLACEHOLDER}` as const;

/**
 * Vector tile layer names in the overview PMTiles archive.
 * Keep in sync with infrastructure/tiles/pmtiles/overview build and styles.
 */
export const OVERVIEW_PMTILES_SOURCE_LAYERS = [
  'land',
  'ocean',
  'coastline',
  'countries',
  'country_boundaries',
  'populated_places',
  'lakes',
  'rivers',
  'myanmar_country',
  'myanmar_state_region',
  'myanmar_state_labels',
] as const;

export const OVERVIEW_MYANMAR_COUNTRY_SOURCE_LAYER = 'myanmar_country' as const;
export const OVERVIEW_MYANMAR_STATE_REGION_SOURCE_LAYER = 'myanmar_state_region' as const;
export const OVERVIEW_MYANMAR_STATE_LABELS_SOURCE_LAYER = 'myanmar_state_labels' as const;

/** @deprecated Use OVERVIEW_MYANMAR_COUNTRY_SOURCE_LAYER */
export const OVERVIEW_ADMIN_COUNTRY_SOURCE_LAYER = OVERVIEW_MYANMAR_COUNTRY_SOURCE_LAYER;
/** @deprecated Use OVERVIEW_MYANMAR_STATE_REGION_SOURCE_LAYER */
export const OVERVIEW_ADMIN_STATE_REGION_SOURCE_LAYER = OVERVIEW_MYANMAR_STATE_REGION_SOURCE_LAYER;
/** @deprecated Use OVERVIEW_MYANMAR_STATE_LABELS_SOURCE_LAYER */
export const OVERVIEW_ADMIN_STATE_REGION_LABELS_SOURCE_LAYER =
  OVERVIEW_MYANMAR_STATE_LABELS_SOURCE_LAYER;

export type OverviewPmtilesSourceLayer = (typeof OVERVIEW_PMTILES_SOURCE_LAYERS)[number];

export const OVERVIEW_FORBIDDEN_SOURCE_LAYERS = [
  'landuse',
  'water_polygons',
  'water_lines',
  'admin_boundaries',
  'admin_areas',
  'village_labels',
  'streets',
  'buildings',
  'admin_area_label_points',
  'road_labels',
  'admin_country',
  'admin_country_outline',
  'admin_country_land_border',
  'admin_state_region',
  'admin_state_region_boundaries',
  'admin_state_region_labels',
  'myanmar_coastline',
  'myanmar_major_islands',
  'mmr_admin0',
  'mmr_admin0_z0_2',
  'mmr_admin0_z3_4',
  'mmr_admin0_z5_6',
  'mmr_admin0_overview',
  'mmr_admin1',
  'mmr_country_highlight',
] as const;

export const OVERVIEW_COUNTRY_LABEL_MIN_ZOOM = 3;
export const OVERVIEW_COUNTRY_LABEL_MAX_ZOOM = 6.5;
export const OVERVIEW_ADMIN_STATE_REGION_LABEL_MIN_ZOOM = 4;
/** State labels stay through regional handoff start; fade by z9–z10. */
export const OVERVIEW_ADMIN_STATE_REGION_LABEL_MAX_ZOOM = 9;
export const OVERVIEW_POPULATED_PLACES_MIN_ZOOM = 7;

/** Exclude Natural Earth Myanmar segments from neighbor country_boundaries. */
export const OVERVIEW_EXCLUDE_MMR_COUNTRY_BOUNDARY_FILTER = [
  '!',
  [
    'any',
    ['==', ['upcase', ['coalesce', ['get', 'ADM0_A3_L'], '']], 'MMR'],
    ['==', ['upcase', ['coalesce', ['get', 'ADM0_A3_R'], '']], 'MMR'],
    ['==', ['upcase', ['coalesce', ['get', 'SOV_A3_L'], '']], 'MMR'],
    ['==', ['upcase', ['coalesce', ['get', 'SOV_A3_R'], '']], 'MMR'],
    ['==', ['upcase', ['coalesce', ['get', 'BRK_A3_L'], '']], 'MMR'],
    ['==', ['upcase', ['coalesce', ['get', 'BRK_A3_R'], '']], 'MMR'],
    ['==', ['upcase', ['coalesce', ['get', 'ADM0_LEFT'], '']], 'MYANMAR'],
    ['==', ['upcase', ['coalesce', ['get', 'ADM0_RIGHT'], '']], 'MYANMAR'],
  ],
] as const;

export const OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_LAYER_ID = 'neighbor-country-boundary-line' as const;
export const OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_LAYER_ID =
  'myanmar-internal-admin-boundary-line' as const;
export const OVERVIEW_MYANMAR_COUNTRY_FILL_LAYER_ID = 'myanmar-country-fill' as const;
export const OVERVIEW_MYANMAR_COUNTRY_OUTLINE_LAYER_ID = 'myanmar-country-outline' as const;

/** @deprecated Prefer OVERVIEW_MYANMAR_COUNTRY_OUTLINE_LAYER_ID */
export const OVERVIEW_ADMIN_COUNTRY_BOUNDARY_LINE_LAYER_ID =
  OVERVIEW_MYANMAR_COUNTRY_OUTLINE_LAYER_ID;
/** @deprecated casing removed in v2 simple pipeline */
export const OVERVIEW_ADMIN_COUNTRY_BOUNDARY_CASING_LAYER_ID =
  'myanmar-admin-country-boundary-casing' as const;

export const OVERVIEW_LAND_FILL_COLOR = '#e8ebe0' as const;
/** Subtle Myanmar country tint vs surrounding NE land. */
export const OVERVIEW_MYANMAR_COUNTRY_FILL_COLOR = '#dfe8d6' as const;
/** Temporary fade — hide imprecise country fill by ~z9 (style only; PMTiles unchanged). */
export const OVERVIEW_MYANMAR_COUNTRY_FILL_OPACITY = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  0.14,
  4,
  0.11,
  7,
  0.08,
  8.5,
  0.03,
  9,
  0,
] as const;

export const OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_COLOR = '#b8b4c7';
export const OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_OPACITY = [
  'interpolate',
  ['linear'],
  ['zoom'],
  0,
  0.28,
  3,
  0.4,
  6,
  0.52,
] as const;
export const OVERVIEW_NEIGHBOR_COUNTRY_BOUNDARY_WIDTH = [
  'interpolate',
  ['linear'],
  ['zoom'],
  0,
  0.45,
  3,
  0.65,
  6,
  0.85,
] as const;

export const OVERVIEW_MYANMAR_COUNTRY_OUTLINE_COLOR = '#4a5568';
export const OVERVIEW_MYANMAR_COUNTRY_OUTLINE_MIN_ZOOM = 2;
/** Temporary fade — hide imprecise country outline by ~z10 (style only; PMTiles unchanged). */
export const OVERVIEW_MYANMAR_COUNTRY_OUTLINE_OPACITY = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3,
  0.8,
  6,
  0.75,
  8.5,
  0.7,
  9.5,
  0.35,
  10,
  0,
] as const;
export const OVERVIEW_MYANMAR_COUNTRY_OUTLINE_WIDTH = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  0.8,
  4,
  1.05,
  6,
  1.3,
  8,
  1.5,
  10,
  1.55,
] as const;

/** @deprecated */
export const OVERVIEW_ADMIN_COUNTRY_BOUNDARY_LINE_COLOR = OVERVIEW_MYANMAR_COUNTRY_OUTLINE_COLOR;
/** @deprecated — temporary outline maxzoom until precise country geom */
export const OVERVIEW_ADMIN_COUNTRY_OVERVIEW_MAX_ZOOM = OVERVIEW_MYANMAR_COUNTRY_OUTLINE_MAX_ZOOM;
export const OVERVIEW_ADMIN_COUNTRY_BOUNDARY_MIN_ZOOM = OVERVIEW_MYANMAR_COUNTRY_OUTLINE_MIN_ZOOM;
export const OVERVIEW_ADMIN_COUNTRY_BOUNDARY_LINE_OPACITY = OVERVIEW_MYANMAR_COUNTRY_OUTLINE_OPACITY;
export const OVERVIEW_ADMIN_COUNTRY_BOUNDARY_LINE_WIDTH = OVERVIEW_MYANMAR_COUNTRY_OUTLINE_WIDTH;
export const OVERVIEW_ADMIN_COUNTRY_BOUNDARY_CASING_COLOR = '#f6f5ee';
export const OVERVIEW_ADMIN_COUNTRY_BOUNDARY_CASING_OPACITY = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  0.2,
  6,
  0.3,
] as const;
export const OVERVIEW_ADMIN_COUNTRY_BOUNDARY_CASING_WIDTH = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  1.4,
  6,
  2.0,
] as const;

export const REGIONAL_ADMIN_PRIMARY_BOUNDARY_MIN_ZOOM = 7;
export const REGIONAL_ADMIN_PRIMARY_LEVEL_CODES = ['state_region'] as const;
export const REGIONAL_ADMIN_PRIMARY_LEVEL_FILTER = [
  'in',
  ['get', 'admin_level_code'],
  ['literal', [...REGIONAL_ADMIN_PRIMARY_LEVEL_CODES]],
] as const;
export const REGIONAL_ADMIN_PRIMARY_BOUNDARY_COLOR = '#aaa4bd';
export const REGIONAL_ADMIN_PRIMARY_BOUNDARY_WIDTH = [
  'interpolate',
  ['linear'],
  ['zoom'],
  7,
  ['case', REGIONAL_ADMIN_PRIMARY_LEVEL_FILTER, 0.6, 0.35],
  10,
  ['case', REGIONAL_ADMIN_PRIMARY_LEVEL_FILTER, 0.9, 0.55],
] as const;
export const REGIONAL_ADMIN_PRIMARY_BOUNDARY_OPACITY = [
  'interpolate',
  ['linear'],
  ['zoom'],
  7,
  0.35,
  10,
  0.45,
] as const;

export const OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_COLOR = '#8a9099';
export const OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_MIN_ZOOM = 4;
/** Internal state lines fade when regional detail takes over. */
export const OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_MAX_ZOOM = 14;
export const OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_OPACITY = [
  'interpolate',
  ['linear'],
  ['zoom'],
  4,
  0.25,
  6,
  0.35,
  10,
  0.3,
  14,
  0.15,
] as const;
export const OVERVIEW_ADMIN_STATE_REGION_BOUNDARY_WIDTH = [
  'interpolate',
  ['linear'],
  ['zoom'],
  4,
  0.35,
  6,
  0.5,
  10,
  0.6,
  14,
  0.45,
] as const;

/** Optional very subtle state fill — kept off by default in style (opacity 0). */
export const OVERVIEW_ADMIN_STATE_REGION_FILL_COLOR = [
  'interpolate',
  ['linear'],
  ['%', ['to-number', ['coalesce', ['get', 'core_id'], 0]], 16],
  0,
  '#eef3f6',
  8,
  '#eef4ef',
  15,
  '#f3eef3',
] as const;

export const OVERVIEW_COUNTRY_LABEL_TEXT_COLOR = '#5a5f66';
export const OVERVIEW_COUNTRY_LABEL_HALO_COLOR = '#f4f3ec';
export const OVERVIEW_COUNTRY_LABEL_HALO_WIDTH = 1.2;
export const OVERVIEW_COUNTRY_LABEL_TEXT_SIZE = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3,
  11,
  5,
  13,
  6.5,
  12,
] as const;

export const OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_COLOR = '#6a6f78';
export const OVERVIEW_ADMIN_STATE_REGION_LABEL_HALO_COLOR = '#f4f3ec';
export const OVERVIEW_ADMIN_STATE_REGION_LABEL_HALO_WIDTH = 1.05;
export const OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_SIZE = [
  'interpolate',
  ['linear'],
  ['zoom'],
  4,
  10,
  6,
  11,
  8,
  11.5,
] as const;
/** Tight padding so all 15 short state names can place; still no allow-overlap. */
export const OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_PADDING = 3;
export const OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_OPACITY = [
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
  10,
  0,
] as const;

export const OVERVIEW_ADMIN_STATE_REGION_LABEL_FILTER = [
  'all',
  [
    '!=',
    [
      'coalesce',
      ['get', 'label_name_mm'],
      ['get', 'name_mm'],
      ['get', 'label_name_en'],
      ['get', 'name_en'],
      ['get', 'name'],
      '',
    ],
    '',
  ],
] as const;

export const OVERVIEW_COUNTRY_LABEL_FILTER = [
  'all',
  ['!=', ['coalesce', ['get', 'TINY'], 0], 1],
  ['<=', ['coalesce', ['get', 'LABELRANK'], 10], 5],
  ['!=', ['upcase', ['coalesce', ['get', 'ADM0_A3'], '']], 'MMR'],
] as const;

export const OVERVIEW_LAKES_FILTER = ['all'] as const;
export const OVERVIEW_RIVERS_FILTER = ['all'] as const;
export const OVERVIEW_MAJOR_CITY_FILTER = [
  'any',
  ['==', ['coalesce', ['get', 'ADM0CAP'], 0], 1],
  ['<=', ['coalesce', ['get', 'SCALERANK'], 10], 4],
] as const;

/**
 * Overview state labels: prefer export aliases when present (after rebuild),
 * else map core_id → short Myanmar name so current v2 tiles work without waiting.
 */
export const OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_FIELD = [
  'coalesce',
  ['get', 'label_name_mm'],
  [
    'match',
    ['to-number', ['coalesce', ['get', 'core_id'], 0]],
    13,
    'ရန်ကုန်',
    5089,
    'မွန်',
    5879,
    'ကရင်',
    6007,
    'ကယား',
    6031,
    'နေပြည်တော်',
    6329,
    'ရှမ်း',
    6667,
    'ကချင်',
    6703,
    'စစ်ကိုင်း',
    6722,
    'ရခိုင်',
    6744,
    'ချင်း',
    6832,
    'မန္တလေး',
    7027,
    'မကွေး',
    7169,
    'ပဲခူး',
    7279,
    'ဧရာဝတီ',
    7449,
    'တနင်္သာရီ',
    ['coalesce', ['get', 'name_mm'], ''],
  ],
  ['get', 'label_name_en'],
  ['get', 'name_en'],
  ['get', 'name'],
  '',
] as const;
