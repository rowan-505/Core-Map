import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import BaseMapStyle from '../../../../../../../packages/map-style/base-map.json';

import { createOverviewLayers } from './overviewBasemap.js';
import {
  OVERVIEW_BOUNDARY_MAX_ZOOM,
  OVERVIEW_LABELS_END_ZOOM,
  REGIONAL_BASE_APPEAR_ZOOM,
  patchOverviewLayersForProgressiveDetail,
  patchRegionalLayersForProgressiveDetail,
} from './basemapZoomVisibility.js';

describe('patchRegionalLayersForProgressiveDetail', () => {
  it('raises early regional fills to z7', () => {
    const layers = patchRegionalLayersForProgressiveDetail(
      BaseMapStyle.layers as never,
    );
    assert.equal(
      layers.find((l) => l.id === 'water-polygons')?.minzoom,
      REGIONAL_BASE_APPEAR_ZOOM,
    );
    assert.equal(
      layers.find((l) => l.id === 'water-lines')?.minzoom,
      REGIONAL_BASE_APPEAR_ZOOM,
    );
    assert.equal(layers.find((l) => l.id === 'road-major-fill')?.minzoom, 8);
    assert.equal(layers.find((l) => l.id === 'road-medium-fill')?.minzoom, 10);
    assert.equal(layers.find((l) => l.id === 'road-local-fill')?.minzoom, 13);
    assert.equal(layers.find((l) => l.id === 'road-minor-fill')?.minzoom, 14);
  });
});

describe('patchOverviewLayersForProgressiveDetail', () => {
  it('keeps country labels low-zoom only and caps admin1/places at z10', () => {
    const layers = patchOverviewLayersForProgressiveDetail(createOverviewLayers());
    const country = layers.find((l) => l.id === 'overview-country-labels');
    const admin1 = layers.find((l) => l.id === 'overview-admin-state-region-labels');
    const places = layers.find((l) => l.id === 'overview-populated-places');
    assert.equal(country?.maxzoom, 6.5);
    assert.equal(admin1?.maxzoom, OVERVIEW_LABELS_END_ZOOM);
    assert.equal(places?.maxzoom, OVERVIEW_LABELS_END_ZOOM);
    assert.ok(country?.paint && 'text-opacity' in country.paint);
  });

  it('leaves overview land/ocean layers unchanged', () => {
    const before = createOverviewLayers();
    const after = patchOverviewLayersForProgressiveDetail(before);
    assert.equal(after.find((l) => l.id === 'overview-ocean')?.maxzoom, before[0]?.maxzoom);
    assert.equal(after.find((l) => l.id === 'overview-land')?.maxzoom, before[1]?.maxzoom);
  });

  it('hides neighbor/coastline at z7; country fill/outline keep temporary z9/z10 hide', () => {
    const before = createOverviewLayers();
    const layers = patchOverviewLayersForProgressiveDetail(before);
    assert.equal(OVERVIEW_BOUNDARY_MAX_ZOOM, 7);
    for (const id of ['neighbor-country-boundary-line', 'overview-coastline'] as const) {
      assert.equal(layers.find((l) => l.id === id)?.maxzoom, OVERVIEW_BOUNDARY_MAX_ZOOM);
    }
    assert.equal(
      layers.find((l) => l.id === 'myanmar-internal-admin-boundary-line')?.maxzoom,
      14,
    );
    assert.equal(layers.find((l) => l.id === 'myanmar-country-fill')?.maxzoom, 9);
    assert.equal(layers.find((l) => l.id === 'myanmar-country-outline')?.maxzoom, 10);
    assert.equal(
      layers.find((l) => l.id === 'myanmar-country-fill')?.maxzoom,
      before.find((l) => l.id === 'myanmar-country-fill')?.maxzoom,
    );
    assert.equal(
      layers.find((l) => l.id === 'myanmar-country-outline')?.maxzoom,
      before.find((l) => l.id === 'myanmar-country-outline')?.maxzoom,
    );
    assert.equal(
      layers.find((l) => l.id === 'neighbor-country-boundary-line')?.minzoom,
      0,
    );
    assert.equal(layers.find((l) => l.id === 'myanmar-country-outline')?.minzoom, 2);
    assert.equal(layers.find((l) => l.id === 'myanmar-internal-admin-boundary-line')?.minzoom, 4);
    const ids = layers.map((l) => l.id);
    assert.ok(
      ids.indexOf('myanmar-internal-admin-boundary-line') <
        ids.indexOf('myanmar-country-outline'),
      'internal admin boundaries below Myanmar country outline',
    );
  });

  it('patches regional country/state admin boundaries at z7', () => {
    const layers = patchRegionalLayersForProgressiveDetail(BaseMapStyle.layers as never);
    const admin = layers.find((l) => l.id === 'admin-boundaries');
    assert.equal(admin?.minzoom, REGIONAL_BASE_APPEAR_ZOOM);
    const width = admin?.paint?.['line-width'] as unknown[];
    const opacity = admin?.paint?.['line-opacity'] as unknown[];
    const color = JSON.stringify(admin?.paint?.['line-color']);
    assert.equal(width?.[0], 'interpolate');
    assert.equal(opacity?.[0], 'interpolate');
    assert.equal(JSON.stringify(width).includes('"zoom"'), true);
    assert.equal(JSON.stringify(width).match(/case.*interpolate.*zoom/s), null);
    assert.equal(JSON.stringify(opacity).match(/case.*interpolate.*zoom/s), null);
    const widthJson = JSON.stringify(width);
    assert.ok(widthJson.includes('0.6') && widthJson.includes('0.9'));
    assert.ok(widthJson.includes('state_region'));
    assert.ok(JSON.stringify(opacity).includes('0.45'));
    assert.ok(color.includes('aaa4bd'));
  });
});
