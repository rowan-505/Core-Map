/** Lazy, mode-specific Martin sources for the public transport browser. */
import type { VectorSourceSpecification } from 'maplibre-gl';
import type { TransportBrowseMode } from '../../state/mapUiStore';
import type { MapEngine } from '../mapEngineTypes';

export const TRANSPORT_SOURCE_BOUNDS = [90, 9, 102, 29] as const;
export const TRANSPORT_SOURCE_MAX_ZOOM = 20;
export const TRANSPORT_POINTS_SOURCE_ID = 'transport-stops-source';
export const TRANSPORT_TERMINALS_SOURCE_ID = 'transport-terminals-source';
export const TRANSPORT_PATHS_SOURCE_ID = 'transport-route-paths-source';

export type TransportSourceDefinition = {
  readonly mode: TransportBrowseMode;
  readonly kind: 'points' | 'paths';
  readonly endpoint: string;
  readonly sourceId: string;
  readonly minZoom: number;
};

export type ActiveTransportSourceDefinition = TransportSourceDefinition & {
  readonly sourceLayer: string;
  /** Legacy mixed-mode views need a client-side mode filter during migration rollout. */
  readonly legacyModeFilter: string | null;
};

export type ActiveTransportSources = {
  readonly points?: ActiveTransportSourceDefinition;
  readonly paths?: ActiveTransportSourceDefinition;
};

export const TRANSPORT_SOURCES: readonly TransportSourceDefinition[] = [
  { mode: 'bus', kind: 'points', endpoint: 'transport_bus_stops', sourceId: TRANSPORT_POINTS_SOURCE_ID, minZoom: 11 },
  { mode: 'bus', kind: 'paths', endpoint: 'transport_bus_route_overview', sourceId: TRANSPORT_PATHS_SOURCE_ID, minZoom: 9 },
  { mode: 'train', kind: 'points', endpoint: 'transport_train_stations', sourceId: TRANSPORT_POINTS_SOURCE_ID, minZoom: 8 },
  { mode: 'train', kind: 'paths', endpoint: 'transport_train_routes', sourceId: TRANSPORT_PATHS_SOURCE_ID, minZoom: 7 },
  { mode: 'express', kind: 'points', endpoint: 'transport_express_terminals', sourceId: TRANSPORT_TERMINALS_SOURCE_ID, minZoom: 9 },
  { mode: 'express', kind: 'paths', endpoint: 'transport_express_route_corridors', sourceId: TRANSPORT_PATHS_SOURCE_ID, minZoom: 7 },
] as const;

export const TRANSPORT_SOURCE_IDS = [
  TRANSPORT_POINTS_SOURCE_ID,
  TRANSPORT_TERMINALS_SOURCE_ID,
  TRANSPORT_PATHS_SOURCE_ID,
] as const;

const TRANSPORT_SOURCE_ID_SET = new Set<string>(TRANSPORT_SOURCE_IDS);

const LEGACY_ENDPOINTS = {
  points: 'transport_stops_v',
  terminals: 'transport_terminals_v',
  paths: 'transport_route_paths_v',
  infrastructure: 'transport_infrastructure_lines_v',
} as const;

const catalogCache = new Map<string, Promise<ReadonlySet<string> | null>>();

export function transportSourceDefinition(
  mode: TransportBrowseMode,
  kind: 'points' | 'paths',
): TransportSourceDefinition {
  const definition = TRANSPORT_SOURCES.find((entry) => entry.mode === mode && entry.kind === kind);
  if (!definition) throw new Error(`Missing Martin transport source for ${mode}/${kind}`);
  return definition;
}

function vectorSource(baseUrl: string, definition: TransportSourceDefinition): VectorSourceSpecification {
  return {
    type: 'vector',
    tiles: [`${baseUrl.replace(/\/+$/, '')}/${definition.endpoint}/{z}/{x}/{y}`],
    bounds: [...TRANSPORT_SOURCE_BOUNDS],
    minzoom: definition.minZoom,
    maxzoom: TRANSPORT_SOURCE_MAX_ZOOM,
  };
}

/**
 * Read Martin's source catalog only after the user activates transit. This lets a rolling
 * deployment use the new fixed endpoints when present. Development can temporarily fall back
 * to existing mixed transport views while the local database migration is pending.
 */
export function loadTransportEndpointCatalog(baseUrl: string): Promise<ReadonlySet<string> | null> {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const cached = catalogCache.get(normalizedBaseUrl);
  if (cached) return cached;

  const request = fetch(`${normalizedBaseUrl}/catalog`)
    .then(async (response) => {
      if (!response.ok) return null;
      const body = (await response.json()) as { tiles?: Record<string, unknown> };
      return new Set(Object.keys(body.tiles ?? {}));
    })
    .catch(() => null);
  catalogCache.set(normalizedBaseUrl, request);
  return request;
}

function activeDefinition(
  definition: TransportSourceDefinition,
  availableEndpoints?: ReadonlySet<string> | null,
): ActiveTransportSourceDefinition {
  if (!availableEndpoints || availableEndpoints.has(definition.endpoint)) {
    return { ...definition, sourceLayer: definition.endpoint, legacyModeFilter: null };
  }

  // Never request mixed legacy tiles in production: even a client-side filter would still
  // transfer unpublished rows to the browser. Production fails closed until migration deploy.
  if (import.meta.env?.PROD === true) {
    return { ...definition, sourceLayer: definition.endpoint, legacyModeFilter: null };
  }

  const endpoint =
    definition.kind === 'paths' && definition.mode === 'train'
      ? LEGACY_ENDPOINTS.infrastructure
      : definition.kind === 'paths'
        ? LEGACY_ENDPOINTS.paths
      : definition.mode === 'express'
        ? LEGACY_ENDPOINTS.terminals
        : LEGACY_ENDPOINTS.points;
  if (!availableEndpoints.has(endpoint)) {
    return { ...definition, sourceLayer: definition.endpoint, legacyModeFilter: null };
  }

  return {
    ...definition,
    endpoint,
    sourceLayer: endpoint,
    legacyModeFilter:
      definition.mode === 'express' && definition.kind === 'points'
        ? 'bus'
        : definition.mode === 'express'
          ? 'express_bus'
          : definition.mode,
  };
}

/** Add only sources that can currently render. Existing same-mode sources are reused. */
export function addTransportSources(
  map: MapEngine,
  martinTileUrl: string,
  mode: TransportBrowseMode,
  visibility: { readonly points: boolean; readonly paths: boolean },
  availableEndpoints?: ReadonlySet<string> | null,
): ActiveTransportSources {
  const active: { points?: ActiveTransportSourceDefinition; paths?: ActiveTransportSourceDefinition } = {};
  if (visibility.points) {
    const points = activeDefinition(transportSourceDefinition(mode, 'points'), availableEndpoints);
    if (!map.getSource(points.sourceId)) map.addSource(points.sourceId, vectorSource(martinTileUrl, points));
    active.points = points;
  }
  if (visibility.paths) {
    const paths = activeDefinition(transportSourceDefinition(mode, 'paths'), availableEndpoints);
    if (!map.getSource(paths.sourceId)) map.addSource(paths.sourceId, vectorSource(martinTileUrl, paths));
    active.paths = paths;
  }
  return active;
}

/** Remove inactive mode sources after their dependent layers have been removed. */
export function removeTransportSources(map: MapEngine): void {
  for (const sourceId of TRANSPORT_SOURCE_IDS) {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }
}

/** Dev-only transport tile diagnostics; production stays silent. */
export function bindTransportTileErrorHandler(map: MapEngine): () => void {
  if (!import.meta.env.DEV) return () => {};
  const handler = (event: { sourceId?: string; error?: Error & { url?: string } }) => {
    if (!event.sourceId || !TRANSPORT_SOURCE_ID_SET.has(event.sourceId)) return;
    console.warn(
      `[map][transport] tile error — source: ${event.sourceId}, error: ${event.error?.message ?? 'unknown error'}`,
    );
  };
  map.on('error', handler);
  return () => map.off('error', handler);
}
