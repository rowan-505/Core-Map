import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CommunityPostListItem } from '../api/communityApi.ts';
import {
  COMMUNITY_MARKERS_SOURCE_ID,
  clearCommunityMarkers,
  communityPostsToGeoJSON,
  ensureCommunityMarkerLayers,
  setCommunityMarkers,
} from './communityMarkersOnMap.ts';

function post(
  overrides: Partial<CommunityPostListItem> & Pick<CommunityPostListItem, 'public_id'>,
): CommunityPostListItem {
  return {
    title: 'Flood update',
    description_preview: 'Flood update preview',
    category: 'local_update',
    publication_status: 'published',
    verification_status: 'community_confirmed',
    trust_score: 10,
    published_at: '2026-09-17T00:00:00.000Z',
    has_location: true,
    location: { lng: 96.2, lat: 16.8, label: null },
    author: { public_id: 'a0000000-0000-4000-8000-000000000001', display_name: 'A' },
    reaction_counts: { confirm: 1, helpful: 0, incorrect: 0 },
    ...overrides,
  };
}

function createMockMap() {
  const sources = new Map<string, { data: GeoJSON.FeatureCollection; setData: (data: GeoJSON.FeatureCollection) => void }>();
  const layers = new Set<string>();

  return {
    isStyleLoaded: () => true,
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, input: { data: GeoJSON.FeatureCollection }) => {
      sources.set(id, {
        data: input.data,
        setData(data: GeoJSON.FeatureCollection) {
          this.data = data;
        },
      });
    },
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    addLayer: (layer: { id: string }) => {
      layers.add(layer.id);
    },
    sources,
    layers,
  };
}

describe('communityMarkersOnMap', () => {
  it('builds point features only for geotagged posts and marks selection', () => {
    const fc = communityPostsToGeoJSON(
      [
        post({ public_id: 'b441f97a-3a4b-43cb-8a16-1ce88869a1aa' }),
        post({
          public_id: 'b441f97a-3a4b-43cb-8a16-1ce88869a1ab',
          has_location: false,
          location: null,
        }),
      ],
      'b441f97a-3a4b-43cb-8a16-1ce88869a1aa',
    );

    assert.equal(fc.features.length, 1);
    assert.equal(fc.features[0]?.properties?.selected, 1);
  });

  it('ensures layers once and updates source data', () => {
    const map = createMockMap();
    assert.equal(ensureCommunityMarkerLayers(map as never), true);
    assert.equal(ensureCommunityMarkerLayers(map as never), true);
    assert.equal(map.layers.size, 3);

    setCommunityMarkers(
      map as never,
      communityPostsToGeoJSON(
        [post({ public_id: 'b441f97a-3a4b-43cb-8a16-1ce88869a1aa' })],
        null,
      ),
    );
    const source = map.sources.get(COMMUNITY_MARKERS_SOURCE_ID);
    assert.equal(source?.data.features.length, 1);

    clearCommunityMarkers(map as never);
    assert.equal(source?.data.features.length, 0);
  });
});
