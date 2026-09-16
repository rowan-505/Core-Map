import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';

import { transportRouteLinePaint } from './transportRoutePaint.js';

describe('transport route line style', () => {
  it('uses MapLibre-valid zoom and feature-state expressions', () => {
    const errors = validateStyleMin({
      version: 8,
      sources: {
        'transport-route-paths-source': {
          type: 'vector',
          tiles: ['https://tiles.example.test/{z}/{x}/{y}'],
        },
      },
      layers: [
        {
          id: 'transport-route-paths',
          type: 'line',
          source: 'transport-route-paths-source',
          'source-layer': 'transport_route_paths_v',
          paint: transportRouteLinePaint(),
        },
      ],
    });

    assert.deepEqual(
      errors.map((error) => error.message),
      [],
    );
  });
});
