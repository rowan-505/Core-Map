import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBasemapVectorSource } from './basemapSource.js';
import {
  NATIVE_REGION_TILE_MAX_ZOOM,
  PUBLIC_MAP_MAX_ZOOM,
  RECOMMENDED_REGIONAL_MAP_MAX_ZOOM,
  REGIONAL_LAYER_OVERZOOM_MIN_MAX_ZOOM,
  REGIONAL_VECTOR_SOURCE_OVERZOOM_MAX_ZOOM,
  clampRegionalVectorSourceMaxZoom,
} from './regionalZoomPolicy.js';

describe('regionalZoomPolicy', () => {
  it('separates native z16 archives from public camera z20', () => {
    assert.equal(NATIVE_REGION_TILE_MAX_ZOOM, 16);
    assert.equal(PUBLIC_MAP_MAX_ZOOM, 20);
    assert.equal(RECOMMENDED_REGIONAL_MAP_MAX_ZOOM, 20);
    // Source maxzoom must be native so MapLibre overzooms instead of fetching z17–z20.
    assert.equal(REGIONAL_VECTOR_SOURCE_OVERZOOM_MAX_ZOOM, NATIVE_REGION_TILE_MAX_ZOOM);
    // Layers stay visible through the camera max while the source overzooms.
    assert.equal(REGIONAL_LAYER_OVERZOOM_MIN_MAX_ZOOM, PUBLIC_MAP_MAX_ZOOM);
  });

  it('clamps declared source maxzoom so z17–z20 are not requested', () => {
    assert.equal(clampRegionalVectorSourceMaxZoom(20), 16);
    assert.equal(clampRegionalVectorSourceMaxZoom(16), 16);
    assert.equal(clampRegionalVectorSourceMaxZoom(14), 14);
    assert.equal(clampRegionalVectorSourceMaxZoom(undefined), 16);
  });

  it('createBasemapVectorSource uses native maxzoom for overzoom', () => {
    const src = createBasemapVectorSource('https://cdn.example/yangon.pmtiles');
    assert.equal(src.maxzoom, 16);
    assert.equal(src.minzoom, 0);
    assert.ok(src.url.startsWith('pmtiles://'));
  });
});
