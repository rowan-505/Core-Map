import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { transportRouteSelectionFromFeature } from './transportRouteSelection.js';

describe('transportRouteSelectionFromFeature', () => {
  it('requests route details by stable public id rather than tile row id', () => {
    const selection = transportRouteSelectionFromFeature({
      properties: {
        id: 93,
        route_public_id: '0d346c44-17c2-4f8d-b3d0-55b7df5d340a',
        route_code: 'YBS-37',
        public_name: 'YBS 37',
        mode: 'bus',
      },
    });
    assert.equal(selection?.entityId, '0d346c44-17c2-4f8d-b3d0-55b7df5d340a');
    assert.equal(selection?.subtitle, 'YBS-37');
  });

  it('does not fabricate a request when the stable route identity is absent', () => {
    assert.equal(transportRouteSelectionFromFeature({ properties: { route_code: 'YBS-37' } }), null);
  });
});
