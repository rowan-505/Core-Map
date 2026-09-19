/**
 * Community geotag markers as a single GeoJSON source (no clustering yet).
 */
import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl';
import type { MapEngine } from '@/features/map/lib/mapEngineTypes';
import type {
  CommunityPostListItem,
  CommunityVerificationStatus,
} from '../api/communityApi';

export const COMMUNITY_MARKERS_SOURCE_ID = 'community-markers-source' as const;
export const COMMUNITY_MARKERS_LAYER_ID = 'community-markers-circle' as const;
export const COMMUNITY_MARKERS_SELECTED_LAYER_ID = 'community-markers-selected' as const;
export const COMMUNITY_MARKERS_HITBOX_LAYER_ID = 'community-markers-hitbox' as const;

export const COMMUNITY_MARKER_LAYER_IDS = [
  COMMUNITY_MARKERS_HITBOX_LAYER_ID,
  COMMUNITY_MARKERS_LAYER_ID,
  COMMUNITY_MARKERS_SELECTED_LAYER_ID,
] as const;

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

const POINT_RADIUS: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  5,
  14,
  7,
  18,
  9,
];

const SELECTED_RADIUS: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  8,
  14,
  11,
  18,
  14,
];

const MARKER_COLOR: ExpressionSpecification = [
  'match',
  ['get', 'verification_status'],
  'admin_verified',
  '#0f766e',
  'community_confirmed',
  '#1d4ed8',
  '#ea580c',
];

export type CommunityMarkerFeatureProps = {
  readonly public_id: string;
  readonly title: string;
  readonly verification_status: CommunityVerificationStatus;
  readonly selected: 0 | 1;
};

export function communityPostsToGeoJSON(
  posts: readonly CommunityPostListItem[],
  selectedPublicId: string | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const post of posts) {
    if (!post.location) continue;
    features.push({
      type: 'Feature',
      id: post.public_id,
      geometry: {
        type: 'Point',
        coordinates: [post.location.lng, post.location.lat],
      },
      properties: {
        kind: 'community-post',
        public_id: post.public_id,
        title: post.title,
        verification_status: post.verification_status,
        selected: selectedPublicId === post.public_id ? 1 : 0,
      } satisfies CommunityMarkerFeatureProps & { kind: 'community-post' },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function ensureCommunityMarkerLayers(map: MapEngine): boolean {
  if (!map.isStyleLoaded()) return false;

  if (!map.getSource(COMMUNITY_MARKERS_SOURCE_ID)) {
    map.addSource(COMMUNITY_MARKERS_SOURCE_ID, { type: 'geojson', data: EMPTY_FC });
  }

  if (!map.getLayer(COMMUNITY_MARKERS_HITBOX_LAYER_ID)) {
    map.addLayer({
      id: COMMUNITY_MARKERS_HITBOX_LAYER_ID,
      type: 'circle',
      source: COMMUNITY_MARKERS_SOURCE_ID,
      paint: {
        'circle-radius': 16,
        'circle-opacity': 0,
        'circle-color': '#000000',
      },
    });
  }

  if (!map.getLayer(COMMUNITY_MARKERS_LAYER_ID)) {
    map.addLayer({
      id: COMMUNITY_MARKERS_LAYER_ID,
      type: 'circle',
      source: COMMUNITY_MARKERS_SOURCE_ID,
      filter: ['!=', ['get', 'selected'], 1],
      paint: {
        'circle-radius': POINT_RADIUS,
        'circle-color': MARKER_COLOR,
        'circle-opacity': 0.92,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });
  }

  if (!map.getLayer(COMMUNITY_MARKERS_SELECTED_LAYER_ID)) {
    map.addLayer({
      id: COMMUNITY_MARKERS_SELECTED_LAYER_ID,
      type: 'circle',
      source: COMMUNITY_MARKERS_SOURCE_ID,
      filter: ['==', ['get', 'selected'], 1],
      paint: {
        'circle-radius': SELECTED_RADIUS,
        'circle-color': MARKER_COLOR,
        'circle-opacity': 1,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
      },
    });
  }

  return true;
}

export function setCommunityMarkers(
  map: MapEngine,
  collection: GeoJSON.FeatureCollection,
): void {
  if (!ensureCommunityMarkerLayers(map)) return;
  const src = map.getSource(COMMUNITY_MARKERS_SOURCE_ID) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(collection);
}

export function clearCommunityMarkers(map: MapEngine): void {
  const src = map.getSource(COMMUNITY_MARKERS_SOURCE_ID) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(EMPTY_FC);
}

export function readCommunityPostIdFromFeature(
  feature: GeoJSON.Feature | { properties?: GeoJSON.GeoJsonProperties } | null | undefined,
): string | null {
  const raw = feature?.properties?.public_id;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}
