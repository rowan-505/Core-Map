import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TRANSPORT_MODE_DEFAULTS, useMapUiStore } from './mapUiStore.js';

describe('transport browse state', () => {
  it('starts off with no active transport loading state', () => {
    const state = useMapUiStore.getState();
    assert.equal(state.transportMode, null);
    assert.equal(state.transportPointsVisible, false);
    assert.equal(state.transportPathsVisible, false);
  });

  it('uses mode-specific visibility defaults', () => {
    assert.deepEqual(TRANSPORT_MODE_DEFAULTS.bus, { points: true, paths: true });
    assert.deepEqual(TRANSPORT_MODE_DEFAULTS.train, { points: true, paths: true });
    assert.deepEqual(TRANSPORT_MODE_DEFAULTS.express, { points: true, paths: true });
  });

  it('the paths toggle does not change point visibility', () => {
    useMapUiStore.getState().setTransportMode('bus');
    useMapUiStore.getState().setTransportPathsVisible(true);
    assert.equal(useMapUiStore.getState().transportPointsVisible, true);
    assert.equal(useMapUiStore.getState().transportPathsVisible, true);
    useMapUiStore.getState().setTransportMode('train');
    useMapUiStore.getState().setTransportMode('bus');
    assert.equal(useMapUiStore.getState().transportPathsVisible, true);
    useMapUiStore.getState().setTransportMode(null);
  });
});
