import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildTourismPlacesQuery } from '../lib/buildTourismPlacesQuery.ts';

describe('tourismApi query builder', () => {
  it('includes nearby lat/lng and radius only when provided', () => {
    const nearby = buildTourismPlacesQuery({
      mode: 'nearby',
      lat: 16.8,
      lng: 96.15,
      radius_m: 5000,
      limit: 20,
    });
    assert.match(nearby, /mode=nearby/);
    assert.match(nearby, /lat=16\.8/);
    assert.match(nearby, /lng=96\.15/);
    assert.match(nearby, /radius_m=5000/);
  });

  it('supports mode switching across ranking modes', () => {
    for (const mode of [
      'recommended',
      'top_rated',
      'most_reviewed',
      'nearby',
      'editor_picks',
    ] as const) {
      const qs = buildTourismPlacesQuery({ mode, limit: 20 });
      assert.match(qs, new RegExp(`mode=${mode}`));
    }
  });
});
