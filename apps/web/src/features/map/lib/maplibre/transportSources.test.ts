import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addTransportSources,
  removeTransportSources,
  TRANSPORT_SOURCE_BOUNDS,
  TRANSPORT_SOURCE_MAX_ZOOM,
  TRANSPORT_SOURCES,
  transportSourceDefinition,
} from './transportSources.js';
import type { MapEngine } from '../mapEngineTypes.js';

describe('transportSources zoom contract', () => {
  it('requests native Martin tiles through public street zoom', () => {
    assert.equal(TRANSPORT_SOURCE_MAX_ZOOM, 20);
  });

  it('uses six fixed, separately cacheable endpoints inside Myanmar bounds', () => {
    assert.deepEqual(TRANSPORT_SOURCE_BOUNDS, [90, 9, 102, 29]);
    assert.deepEqual(
      TRANSPORT_SOURCES.map(({ mode, kind, endpoint }) => [mode, kind, endpoint]),
      [
        ['bus', 'points', 'transport_bus_stops'],
        ['bus', 'paths', 'transport_bus_route_overview'],
        ['train', 'points', 'transport_train_stations'],
        ['train', 'paths', 'transport_train_routes'],
        ['express', 'points', 'transport_express_terminals'],
        ['express', 'paths', 'transport_express_route_corridors'],
      ],
    );
  });

  it('never resolves an inactive transport type through another mode endpoint', () => {
    assert.equal(transportSourceDefinition('bus', 'points').endpoint, 'transport_bus_stops');
    assert.equal(transportSourceDefinition('train', 'paths').endpoint, 'transport_train_routes');
  });

  it('activates only the selected mode and requested source kinds', () => {
    const sources = new Map<string, unknown>();
    const map = {
      getSource: (id: string) => sources.get(id),
      addSource: (id: string, source: unknown) => sources.set(id, source),
      removeSource: (id: string) => sources.delete(id),
    } as unknown as MapEngine;

    addTransportSources(map, 'https://tiles.example.test', 'bus', { points: true, paths: false });
    assert.deepEqual([...sources.keys()], ['transport-stops-source']);
    assert.match(
      String((sources.get('transport-stops-source') as { tiles: string[] }).tiles[0]),
      /transport_bus_stops/,
    );

    removeTransportSources(map);
    addTransportSources(map, 'https://tiles.example.test', 'train', { points: true, paths: true });
    assert.deepEqual([...sources.keys()].sort(), ['transport-route-paths-source', 'transport-stops-source']);
    assert.doesNotMatch(JSON.stringify([...sources.values()]), /transport_bus_/);
  });

  it('falls back to the existing mixed views while the fixed functions roll out', () => {
    const sources = new Map<string, unknown>();
    const map = {
      getSource: (id: string) => sources.get(id),
      addSource: (id: string, source: unknown) => sources.set(id, source),
      removeSource: (id: string) => sources.delete(id),
    } as unknown as MapEngine;
    const legacyCatalog = new Set([
      'transport_stops_v',
      'transport_terminals_v',
      'transport_route_paths_v',
      'transport_infrastructure_lines_v',
    ]);

    const active = addTransportSources(
      map,
      'https://tiles.example.test',
      'bus',
      { points: true, paths: true },
      legacyCatalog,
    );

    assert.equal(active.points?.sourceLayer, 'transport_stops_v');
    assert.equal(active.points?.legacyModeFilter, 'bus');
    assert.equal(active.paths?.sourceLayer, 'transport_route_paths_v');
    assert.equal(active.paths?.legacyModeFilter, 'bus');
    assert.match(
      String((sources.get('transport-route-paths-source') as { tiles: string[] }).tiles[0]),
      /transport_route_paths_v/,
    );

    removeTransportSources(map);
    const train = addTransportSources(
      map,
      'https://tiles.example.test',
      'train',
      { points: true, paths: true },
      legacyCatalog,
    );
    assert.equal(train.paths?.sourceLayer, 'transport_infrastructure_lines_v');
    assert.equal(train.paths?.legacyModeFilter, 'train');

    removeTransportSources(map);
    const express = addTransportSources(
      map,
      'https://tiles.example.test',
      'express',
      { points: true, paths: false },
      legacyCatalog,
    );
    assert.equal(express.points?.sourceLayer, 'transport_terminals_v');
    assert.equal(express.points?.legacyModeFilter, 'bus');
  });
});
