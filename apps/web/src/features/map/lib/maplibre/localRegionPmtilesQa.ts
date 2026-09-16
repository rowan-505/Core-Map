/**
 * DEV-only local PMTiles QA.
 *
 * Default (parity): same composition as production —
 *   localhost overview PMTiles + viewport-relevant local regional PMTiles
 *   via the existing region loader (z>=7, max 4).
 *
 * Stress (`?qaPackage=all` or `?qaStress=1`): paint all local packages at once
 *   (optional DEV overload test — not production parity).
 *
 * Impossible to enable in production builds (import.meta.env.DEV gate).
 */
import type { LayerSpecification, PaddingOptions, StyleSpecification } from 'maplibre-gl';
import BaseMapStyle from '../../../../../../../packages/map-style/base-map.json';
import {
  BASEMAP_VECTOR_SOURCE_ID,
  createBasemapVectorSource,
} from '../../../../../../../packages/map-style/basemapSource.js';
import type { BasemapManifest, BasemapPackage } from '../../../../lib/basemaps/manifest';
import type { BBox } from '../../../../lib/basemaps/bbox';
import {
  BASEMAP_ZOOM_VISIBILITY_RULES,
  patchOverviewLayersForProgressiveDetail,
  patchRegionalLayersForProgressiveDetail,
} from './basemapZoomVisibility';
import { composeWebMapStyle } from './composeWebMapStyle';
import {
  OVERVIEW_SOURCE_ID,
  createOverviewLayers,
  createOverviewSource,
} from './overviewBasemap';

export const LOCAL_REGION_PMTILES_QA_BASE_URL = 'http://localhost:8080/regions' as const;
export const LOCAL_PMTILES_QA_MANIFEST_URL =
  'http://localhost:8080/qa/local-packages.json' as const;

/** Match production {@link REGIONAL_MIN_ZOOM} / {@link MAX_LOADED_REGIONS} (regionLoader). */
export const LOCAL_PMTILES_QA_REGIONAL_LOADER_MIN_ZOOM = 7 as const;
export const LOCAL_PMTILES_QA_MAX_LOADED_REGIONS = 4 as const;

/**
 * Regional size-audit / v2 builds use tippecanoe `--minimum-zoom=8`.
 * Without a local overview archive, the public map must not start at overview z4
 * or the basemap looks empty.
 */
export const LOCAL_PMTILES_QA_REGIONAL_NATIVE_MIN_ZOOM = 8 as const;
export const LOCAL_PMTILES_QA_REGIONAL_NATIVE_MAX_ZOOM = 16 as const;

/** Myanmar-ish fit for regional-only QA (tighter than production overview framing). */
export const LOCAL_PMTILES_QA_REGIONAL_FIT_BOUNDS: readonly [
  [number, number],
  [number, number],
] = [
  [92.2, 9.6],
  [101.2, 28.5],
];

export type LocalPmtilesQaPackage = {
  key: string;
  version: string;
  url: string;
  filename?: string;
  minZoom?: number;
  maxZoom?: number;
  /** Same production bounds used for viewport selection. */
  bounds?: BBox;
};

export type LocalPmtilesQaManifest = {
  generatedAt?: string;
  baseUrl?: string;
  label?: string;
  packageCount?: number;
  overview?: {
    version?: string;
    url?: string;
    filename?: string;
    bounds?: BBox;
    minZoom?: number;
    maxZoom?: number;
  } | null;
  packages: LocalPmtilesQaPackage[];
};

/** `parity` = overview + viewport loader; `stress` = all packages in the style. */
export type LocalPmtilesQaCompositionMode = 'parity' | 'stress';

/** Last successfully loaded QA manifest (DEV badge / diagnostics). */
let lastLoadedQaManifest: LocalPmtilesQaManifest | null = null;
let lastQaStyleHadOverview = false;
/** Package key filter applied to the last QA style (`null` = all packages). */
let lastQaPackageFilter: string | null = null;
/** All package keys from the last fetched manifest (before filter). */
let lastQaAvailablePackageKeys: string[] = [];
let lastQaCompositionMode: LocalPmtilesQaCompositionMode = 'parity';
/** Viewport-loaded region ids (parity mode). Empty in stress until set. */
let lastQaActiveRegionIds: string[] = [];

export function getLastLoadedLocalPmtilesQaManifest(): LocalPmtilesQaManifest | null {
  return lastLoadedQaManifest;
}

/** Package keys available in the QA manifest (for the DEV selector). */
export function getLocalPmtilesQaAvailablePackageKeys(): readonly string[] {
  return lastQaAvailablePackageKeys;
}

/** True when the active QA style includes a local overview PMTiles source. */
export function localPmtilesQaHasOverview(): boolean {
  return lastQaStyleHadOverview;
}

/** `null` means all packages; otherwise the selected package key (e.g. `yangon`). */
export function getLocalPmtilesQaPackageFilter(): string | null {
  return lastQaPackageFilter;
}

export function getLocalPmtilesQaCompositionMode(): LocalPmtilesQaCompositionMode {
  return lastQaCompositionMode;
}

/** Active regional package count for the badge (viewport-loaded in parity; all in stress). */
export function getLocalPmtilesQaActivePackageCount(): number {
  if (lastQaCompositionMode === 'stress') {
    return lastLoadedQaManifest?.packages.length ?? 0;
  }
  return lastQaActiveRegionIds.length;
}

export function getLocalPmtilesQaActiveRegionIds(): readonly string[] {
  return lastQaActiveRegionIds;
}

/** Updated by MapView when the production region loader syncs (parity mode). */
export function setLocalPmtilesQaActiveRegionIds(ids: readonly string[]): void {
  lastQaActiveRegionIds = [...ids];
}

/**
 * DEV-only `?qaPackage=<key>` filter.
 * Empty / missing → no filter (parity uses all packages for viewport selection).
 * `all` / `*` → stress mode (handled by {@link readLocalPmtilesQaCompositionMode}).
 * Injectable `search` for unit tests (defaults to `window.location.search`).
 */
export function readLocalPmtilesQaPackageQueryParam(
  search: string | undefined = typeof window !== 'undefined' ? window.location.search : undefined,
): string | null {
  if (!search) return null;
  const raw = new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get('qaPackage');
  if (raw == null) return null;
  const key = raw.trim().toLowerCase();
  if (!key || key === 'all' || key === '*') return null;
  return key;
}

/**
 * Default = production parity (overview + viewport regions).
 * Stress = paint every local package at once (`?qaStress=1` or `?qaPackage=all`).
 */
export function readLocalPmtilesQaCompositionMode(
  search: string | undefined = typeof window !== 'undefined' ? window.location.search : undefined,
): LocalPmtilesQaCompositionMode {
  if (!search) return 'parity';
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const stress = params.get('qaStress');
  if (stress === '1' || stress === 'true') return 'stress';
  const pkg = params.get('qaPackage');
  if (pkg != null) {
    const key = pkg.trim().toLowerCase();
    if (key === 'all' || key === '*') return 'stress';
  }
  return 'parity';
}

/** Filter manifest packages for single-package QA. Throws if key is unknown. */
export function filterLocalPmtilesQaPackages(
  packages: readonly LocalPmtilesQaPackage[],
  packageKey: string | null,
): LocalPmtilesQaPackage[] {
  if (!packageKey) {
    return [...packages];
  }
  const matched = packages.filter((pkg) => pkg.key.toLowerCase() === packageKey.toLowerCase());
  if (!matched.length) {
    const available = packages.map((pkg) => pkg.key).join(', ');
    throw new Error(
      `[pmtiles-qa] unknown qaPackage=${packageKey}. Available: ${available || '(none)'}`,
    );
  }
  return matched;
}

/**
 * Map `local-basemap-<package>-<version>` or `region-<package>` → package key.
 * Returns null when the source id is not a QA regional source.
 */
export function packageKeyFromQaSourceId(sourceId: string | undefined | null): string | null {
  if (!sourceId || typeof sourceId !== 'string') return null;
  if (sourceId.startsWith('region-')) {
    return sourceId.slice('region-'.length) || null;
  }
  const prefix = `${BASEMAP_VECTOR_SOURCE_ID}-`;
  if (!sourceId.startsWith(prefix)) return null;
  const rest = sourceId.slice(prefix.length);
  // version may contain hyphens (e.g. v2-size-audit); package keys are single tokens.
  const dash = rest.indexOf('-');
  if (dash <= 0) return rest || null;
  return rest.slice(0, dash);
}

function parseTruthyEnvFlag(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

/** Dev-only gate — ignored in production builds even if the env var is set. */
export function isLoadAllLocalRegionPmtilesQaEnabled(): boolean {
  const metaEnv = import.meta.env;
  if (!metaEnv?.DEV) {
    return false;
  }
  return parseTruthyEnvFlag(metaEnv.VITE_LOAD_ALL_LOCAL_REGION_PMTILES);
}

/** True when QA is in production-parity composition (not all-packages stress). */
export function isLocalPmtilesQaParityMode(): boolean {
  return isLoadAllLocalRegionPmtilesQaEnabled() && lastQaCompositionMode === 'parity';
}

export function regionalPmtilesQaSourceId(region: string, version: string): string {
  return `${BASEMAP_VECTOR_SOURCE_ID}-${region}-${version}`;
}

export function regionalPmtilesQaHttpUrl(region: string, version: string): string {
  return `${LOCAL_REGION_PMTILES_QA_BASE_URL}/${region}/${region}-${version}.pmtiles`;
}

export function regionalPmtilesQaLayerIdSuffix(region: string, version: string): string {
  return `${region}-${version}`;
}

export function assertLocalhostPmtilesUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[pmtiles-qa] invalid package URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`[pmtiles-qa] package URL must be http(s): ${url}`);
  }
  const host = parsed.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
    throw new Error(`[pmtiles-qa] package URL must point at localhost (got ${host}): ${url}`);
  }
}

function packageNativeMinZoom(pkg: LocalPmtilesQaPackage): number {
  return typeof pkg.minZoom === 'number' && Number.isFinite(pkg.minZoom)
    ? pkg.minZoom
    : LOCAL_PMTILES_QA_REGIONAL_NATIVE_MIN_ZOOM;
}

function packageNativeMaxZoom(pkg: LocalPmtilesQaPackage): number {
  return typeof pkg.maxZoom === 'number' && Number.isFinite(pkg.maxZoom)
    ? pkg.maxZoom
    : LOCAL_PMTILES_QA_REGIONAL_NATIVE_MAX_ZOOM;
}

function parseOptionalBBox(value: unknown): BBox | undefined {
  if (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    return [value[0], value[1], value[2], value[3]];
  }
  return undefined;
}

export function normalizeLocalPmtilesQaManifest(raw: unknown): LocalPmtilesQaManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('[pmtiles-qa] manifest root must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const packagesRaw = obj.packages;
  if (!Array.isArray(packagesRaw) || packagesRaw.length === 0) {
    throw new Error('[pmtiles-qa] manifest.packages must be a non-empty array');
  }
  const packages: LocalPmtilesQaPackage[] = packagesRaw.map((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`[pmtiles-qa] packages[${i}] must be an object`);
    }
    const row = entry as Record<string, unknown>;
    const key = typeof row.key === 'string' ? row.key.trim() : '';
    const version = typeof row.version === 'string' ? row.version.trim() : '';
    const url = typeof row.url === 'string' ? row.url.trim() : '';
    if (!key || !version || !url) {
      throw new Error(`[pmtiles-qa] packages[${i}] needs key, version, url`);
    }
    assertLocalhostPmtilesUrl(url);
    const minZoom =
      typeof row.minZoom === 'number'
        ? row.minZoom
        : typeof row.minzoom === 'number'
          ? row.minzoom
          : undefined;
    const maxZoom =
      typeof row.maxZoom === 'number'
        ? row.maxZoom
        : typeof row.maxzoom === 'number'
          ? row.maxzoom
          : undefined;
    return {
      key,
      version,
      url,
      filename: typeof row.filename === 'string' ? row.filename : undefined,
      minZoom,
      maxZoom,
      bounds: parseOptionalBBox(row.bounds),
    };
  });

  let overview: LocalPmtilesQaManifest['overview'] = null;
  if (obj.overview && typeof obj.overview === 'object') {
    const ov = obj.overview as Record<string, unknown>;
    const url = typeof ov.url === 'string' ? ov.url.trim() : '';
    if (url) {
      assertLocalhostPmtilesUrl(url);
      overview = {
        url,
        version: typeof ov.version === 'string' ? ov.version : undefined,
        filename: typeof ov.filename === 'string' ? ov.filename : undefined,
        bounds: parseOptionalBBox(ov.bounds),
        minZoom: typeof ov.minZoom === 'number' ? ov.minZoom : undefined,
        maxZoom: typeof ov.maxZoom === 'number' ? ov.maxZoom : undefined,
      };
    }
  }

  return {
    generatedAt: typeof obj.generatedAt === 'string' ? obj.generatedAt : undefined,
    baseUrl: typeof obj.baseUrl === 'string' ? obj.baseUrl : undefined,
    label: typeof obj.label === 'string' ? obj.label : undefined,
    packageCount: packages.length,
    overview,
    packages,
  };
}

export async function fetchLocalPmtilesQaManifest(
  manifestUrl: string = LOCAL_PMTILES_QA_MANIFEST_URL,
): Promise<LocalPmtilesQaManifest> {
  assertLocalhostPmtilesUrl(manifestUrl);
  const res = await fetch(manifestUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(
      `[pmtiles-qa] failed to fetch ${manifestUrl} (${res.status}). ` +
        `Run: npm run tiles:qa:manifest && npm run tiles:serve`,
    );
  }
  const json: unknown = await res.json();
  return normalizeLocalPmtilesQaManifest(json);
}

/**
 * Convert the local QA package list into the production {@link BasemapManifest} shape
 * so {@link startRegionalPmtilesLoader} can drive viewport loading unchanged.
 */
export function localPmtilesQaToBasemapManifest(
  qa: LocalPmtilesQaManifest,
  packages: readonly LocalPmtilesQaPackage[],
): BasemapManifest {
  const overviewUrl = qa.overview?.url;
  if (!overviewUrl) {
    throw new Error(
      '[pmtiles-qa] parity mode requires a local overview PMTiles URL. ' +
        'Run: npm run tiles:fetch:overview && npm run tiles:qa:manifest && npm run tiles:serve',
    );
  }
  assertLocalhostPmtilesUrl(overviewUrl);

  const overview: BasemapPackage = {
    id: 'overview',
    version: qa.overview?.version ?? 'v1',
    url: overviewUrl,
    bounds: qa.overview?.bounds ?? [90, 9, 102, 29],
    minZoom: qa.overview?.minZoom ?? 0,
    maxZoom: qa.overview?.maxZoom ?? 8,
  };

  const regions: BasemapPackage[] = packages.map((pkg) => {
    if (!pkg.bounds) {
      throw new Error(
        `[pmtiles-qa] package ${pkg.key} is missing bounds (regenerate qa manifest from production bounds)`,
      );
    }
    assertLocalhostPmtilesUrl(pkg.url);
    return {
      id: pkg.key,
      version: pkg.version,
      url: pkg.url,
      bounds: pkg.bounds,
      minZoom: packageNativeMinZoom(pkg),
      maxZoom: packageNativeMaxZoom(pkg),
    };
  });

  return { overview, regions };
}

/**
 * MapLibre constructor overrides for regional-only QA (no overview archive).
 * Native tiles are z8–z16; camera maxZoom stays 20 so z17–z20 overzoom z16.
 */
export function getLocalPmtilesQaMapLibreInitOverrides(): {
  minZoom: number;
  maxZoom: number;
  zoom: number;
  center: [number, number];
} | null {
  if (!isLoadAllLocalRegionPmtilesQaEnabled()) return null;
  // Parity / overview path uses the normal public overview camera.
  if (lastQaCompositionMode === 'parity' || lastQaStyleHadOverview) {
    return null;
  }
  const overviewConfigured =
    typeof import.meta.env.VITE_OVERVIEW_PMTILES_URL === 'string' &&
    Boolean(import.meta.env.VITE_OVERVIEW_PMTILES_URL.trim());
  if (overviewConfigured) {
    return null;
  }
  return {
    minZoom: LOCAL_PMTILES_QA_REGIONAL_NATIVE_MIN_ZOOM,
    maxZoom: 20,
    zoom: LOCAL_PMTILES_QA_REGIONAL_NATIVE_MIN_ZOOM + 0.4,
    center: [96.2, 19.5],
  };
}

type QaFitMap = {
  resize?: () => void;
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options?: {
      padding?: number | PaddingOptions;
      duration?: number;
      maxZoom?: number;
      minZoom?: number;
    },
  ) => void;
};

/** Startup fit for regional-only QA — lands near z8–z9 so tiles are visible. */
export function fitLocalPmtilesQaRegionalViewport(
  map: QaFitMap,
  padding?: number | PaddingOptions,
): void {
  const [[swLng, swLat], [neLng, neLat]] = LOCAL_PMTILES_QA_REGIONAL_FIT_BOUNDS;
  map.resize?.();
  map.fitBounds(
    [
      [swLng, swLat],
      [neLng, neLat],
    ],
    {
      padding,
      duration: 0,
      // Keep the fit inside the native regional tile band.
      maxZoom: LOCAL_PMTILES_QA_REGIONAL_NATIVE_MIN_ZOOM + 1.2,
      minZoom: LOCAL_PMTILES_QA_REGIONAL_NATIVE_MIN_ZOOM,
    },
  );
}

function cloneRegionalLayersForRegion(
  templateLayers: LayerSpecification[],
  region: string,
  version: string,
): LayerSpecification[] {
  const sourceId = regionalPmtilesQaSourceId(region, version);
  const suffix = regionalPmtilesQaLayerIdSuffix(region, version);

  return templateLayers.map((layer) => {
    const cloned =
      typeof structuredClone === 'function'
        ? structuredClone(layer)
        : (JSON.parse(JSON.stringify(layer)) as LayerSpecification);
    return {
      ...cloned,
      id: `${layer.id}-${suffix}`,
      source: sourceId,
    };
  });
}

function extractRegionalTemplateLayers(style: StyleSpecification): LayerSpecification[] {
  return (style.layers ?? []).filter(
    (layer): layer is LayerSpecification =>
      layer.id !== 'background' &&
      'source' in layer &&
      layer.source === BASEMAP_VECTOR_SOURCE_ID,
  );
}

/**
 * Production-parity style: overview only (same composeWebMapStyle + basemapZoomVisibility
 * handoff). Regional sources/layers are added at runtime by the viewport loader.
 */
export function composeLocalPmtilesQaParityStyle(
  overviewPmtilesHttpUrl: string,
  label?: string,
): StyleSpecification {
  assertLocalhostPmtilesUrl(overviewPmtilesHttpUrl);

  const baseStyle = BaseMapStyle as StyleSpecification;
  const background = baseStyle.layers?.find((layer) => layer.id === 'background');
  const regionalShell: StyleSpecification = {
    ...baseStyle,
    sources: {},
    layers: background ? [background] : [],
  };

  const composed = composeWebMapStyle(regionalShell, overviewPmtilesHttpUrl);

  console.info(
    `[pmtiles-qa] parity mode: overview + viewport regions ` +
      `(loader z>=${LOCAL_PMTILES_QA_REGIONAL_LOADER_MIN_ZOOM}, max ${LOCAL_PMTILES_QA_MAX_LOADED_REGIONS})` +
      (label ? ` label=${label}` : ''),
  );

  return {
    ...composed,
    name: 'CoreMap Web — local QA parity (overview + viewport regions)',
    metadata: {
      ...(typeof composed.metadata === 'object' && composed.metadata !== null
        ? composed.metadata
        : {}),
      'local-map:qa-mode': 'parity-viewport-regions',
      'local-map:qa-has-overview': true,
      'local-map:qa-regional-native-zoom': `${LOCAL_PMTILES_QA_REGIONAL_NATIVE_MIN_ZOOM}-${LOCAL_PMTILES_QA_REGIONAL_NATIVE_MAX_ZOOM}`,
      'local-map:qa-max-loaded-regions': LOCAL_PMTILES_QA_MAX_LOADED_REGIONS,
      'local-map:qa-regional-min-zoom': LOCAL_PMTILES_QA_REGIONAL_LOADER_MIN_ZOOM,
      ...(label ? { 'local-map:qa-label': label } : {}),
      'local-map:overview-source': OVERVIEW_SOURCE_ID,
      'local-map:progressive-detail': 'overview-base-regional-handoff',
      'local-map:zoom-rules': JSON.stringify(BASEMAP_ZOOM_VISIBILITY_RULES),
    },
  };
}

/**
 * Stress test: overview (optional) + all regional PMTiles from the QA manifest.
 * Uses the real `base-map.json` layer templates — not a simplified QA style.
 */
export function composeLocalRegionPmtilesQaWebMapStyle(
  packages: readonly LocalPmtilesQaPackage[],
  overviewPmtilesHttpUrl?: string,
  label?: string,
): StyleSpecification {
  if (!packages.length) {
    throw new Error('[pmtiles-qa] no local packages to load');
  }

  const hasOverview = Boolean(overviewPmtilesHttpUrl);

  console.info(
    `[pmtiles-qa] stress mode: loading ${packages.length} local package(s)` +
      (label ? ` (label=${label})` : '') +
      (hasOverview ? ' + overview' : ' (regional-only, native z8+)'),
  );

  const baseStyle = BaseMapStyle as StyleSpecification;
  const background = baseStyle.layers?.find((layer) => layer.id === 'background');
  const extracted = extractRegionalTemplateLayers(baseStyle);
  const regionalTemplate = hasOverview
    ? patchRegionalLayersForProgressiveDetail(extracted)
    : extracted;

  const sources: NonNullable<StyleSpecification['sources']> = {};
  const allRegionalLayers: LayerSpecification[] = [];

  for (const pkg of packages) {
    assertLocalhostPmtilesUrl(pkg.url);
    const sourceId = regionalPmtilesQaSourceId(pkg.key, pkg.version);
    const baseSource = createBasemapVectorSource(pkg.url);
    sources[sourceId] = {
      ...baseSource,
      minzoom: packageNativeMinZoom(pkg),
      maxzoom: packageNativeMaxZoom(pkg),
    };
    allRegionalLayers.push(...cloneRegionalLayersForRegion(regionalTemplate, pkg.key, pkg.version));
    console.info(
      `[pmtiles-qa] loaded ${pkg.key} z${packageNativeMinZoom(pkg)}-${packageNativeMaxZoom(pkg)} ${pkg.url}`,
    );
  }

  const overviewLayers = hasOverview
    ? patchOverviewLayersForProgressiveDetail(createOverviewLayers())
    : [];

  if (overviewPmtilesHttpUrl) {
    assertLocalhostPmtilesUrl(overviewPmtilesHttpUrl);
    sources[OVERVIEW_SOURCE_ID] = createOverviewSource(overviewPmtilesHttpUrl);
  }

  return {
    ...baseStyle,
    name: hasOverview
      ? 'CoreMap Web — overview + all local regions (QA stress)'
      : 'CoreMap Web — all local regions (QA stress, no overview)',
    metadata: {
      ...(typeof baseStyle.metadata === 'object' && baseStyle.metadata !== null
        ? baseStyle.metadata
        : {}),
      'local-map:qa-mode': 'load-all-local-region-pmtiles',
      'local-map:qa-package-count': packages.length,
      'local-map:qa-has-overview': hasOverview,
      'local-map:qa-regional-native-zoom': `${LOCAL_PMTILES_QA_REGIONAL_NATIVE_MIN_ZOOM}-${LOCAL_PMTILES_QA_REGIONAL_NATIVE_MAX_ZOOM}`,
      ...(label ? { 'local-map:qa-label': label } : {}),
      ...(hasOverview
        ? {
            'local-map:overview-source': OVERVIEW_SOURCE_ID,
            'local-map:progressive-detail': 'overview-base-regional-handoff',
            'local-map:zoom-rules': JSON.stringify(BASEMAP_ZOOM_VISIBILITY_RULES),
          }
        : {
            'local-map:progressive-detail': 'regional-only-native-zoom',
          }),
    },
    sources,
    layers: [
      ...(background ? [background] : []),
      ...overviewLayers,
      ...allRegionalLayers,
    ],
  };
}

/** Fetch manifest and build the local QA style (parity by default). */
export async function getActiveLocalRegionPmtilesQaStyle(): Promise<StyleSpecification> {
  if (!isLoadAllLocalRegionPmtilesQaEnabled()) {
    throw new Error('[pmtiles-qa] QA mode is disabled (DEV + VITE_LOAD_ALL_LOCAL_REGION_PMTILES required)');
  }

  const mode = readLocalPmtilesQaCompositionMode();
  const manifest = await fetchLocalPmtilesQaManifest();
  const packageFilter = readLocalPmtilesQaPackageQueryParam();
  lastQaAvailablePackageKeys = manifest.packages.map((pkg) => pkg.key);
  const packages = filterLocalPmtilesQaPackages(manifest.packages, packageFilter);

  lastLoadedQaManifest = {
    ...manifest,
    packages,
    packageCount: packages.length,
  };
  lastQaPackageFilter = packageFilter;
  lastQaCompositionMode = mode;
  lastQaActiveRegionIds = mode === 'stress' ? packages.map((pkg) => pkg.key) : [];

  const overviewUrl =
    manifest.overview?.url ||
    (typeof import.meta.env.VITE_OVERVIEW_PMTILES_URL === 'string' &&
    import.meta.env.VITE_OVERVIEW_PMTILES_URL.trim()
      ? import.meta.env.VITE_OVERVIEW_PMTILES_URL.trim()
      : undefined);

  if (overviewUrl) {
    try {
      assertLocalhostPmtilesUrl(overviewUrl);
    } catch (err) {
      console.error('[pmtiles-qa] overview URL rejected (must be localhost):', err);
      throw err;
    }
  }

  lastQaStyleHadOverview = Boolean(overviewUrl);

  const label =
    packageFilter != null
      ? `${manifest.label ?? 'local'} · package=${packageFilter}`
      : manifest.label;

  if (mode === 'parity') {
    if (!overviewUrl) {
      throw new Error(
        '[pmtiles-qa] parity mode needs a local overview archive. ' +
          'Run: npm run tiles:fetch:overview && npm run tiles:qa:manifest && npm run tiles:serve ' +
          '(or open ?qaPackage=all for stress mode without overview)',
      );
    }
    // Validate bounds early so the loader will not fail mid-pan.
    localPmtilesQaToBasemapManifest(manifest, packages);
    if (packageFilter) {
      console.info(`[pmtiles-qa] parity filter: qaPackage=${packageFilter}`);
    } else {
      console.info('[pmtiles-qa] parity mode (default) — viewport region loader');
    }
    return composeLocalPmtilesQaParityStyle(overviewUrl, label);
  }

  if (packageFilter) {
    console.info(`[pmtiles-qa] stress single-package filter: qaPackage=${packageFilter}`);
  } else {
    console.info('[pmtiles-qa] stress mode — all packages in style');
  }

  return composeLocalRegionPmtilesQaWebMapStyle(packages, overviewUrl, label);
}
