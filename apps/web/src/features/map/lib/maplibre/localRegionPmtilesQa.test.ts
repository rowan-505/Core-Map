import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import BaseMapStyle from '../../../../../../../packages/map-style/base-map.json';

import { OVERVIEW_SOURCE_ID } from './overviewBasemap.js';
import {
  assertLocalhostPmtilesUrl,
  composeLocalPmtilesQaParityStyle,
  composeLocalRegionPmtilesQaWebMapStyle,
  filterLocalPmtilesQaPackages,
  isLoadAllLocalRegionPmtilesQaEnabled,
  localPmtilesQaToBasemapManifest,
  normalizeLocalPmtilesQaManifest,
  packageKeyFromQaSourceId,
  readLocalPmtilesQaCompositionMode,
  readLocalPmtilesQaPackageQueryParam,
  regionalPmtilesQaHttpUrl,
  regionalPmtilesQaSourceId,
  type LocalPmtilesQaPackage,
} from './localRegionPmtilesQa.js';
import { composeWebMapStyle } from './composeWebMapStyle.js';

const REGIONAL_LAYER_COUNT = BaseMapStyle.layers.filter(
  (layer) => layer.id !== 'background' && 'source' in layer && layer.source === 'local-basemap',
).length;

/** Fixture packages — versions come from call sites, not hardcoded product constants. */
function samplePackages(count = 3): LocalPmtilesQaPackage[] {
  const keys = ['yangon', 'bago', 'shan', 'mandalay', 'sagaing'];
  return keys.slice(0, count).map((key, i) => ({
    key,
    version: `test-v${i + 1}`,
    url: `http://localhost:8080/regions/${key}/${key}-test-v${i + 1}.pmtiles`,
  }));
}

describe('localRegionPmtilesQa', () => {
  it('is disabled outside Vite DEV even when env flag would be set', () => {
    // Node test runner has no Vite DEV — QA must stay off in non-dev runtimes.
    assert.equal(isLoadAllLocalRegionPmtilesQaEnabled(), false);
  });

  it('builds localhost archive URL helpers from region + version args', () => {
    assert.equal(
      regionalPmtilesQaHttpUrl('yangon', 'v2-size-audit'),
      'http://localhost:8080/regions/yangon/yangon-v2-size-audit.pmtiles',
    );
    assert.equal(
      regionalPmtilesQaSourceId('bago', 'any-version'),
      'local-basemap-bago-any-version',
    );
  });

  it('rejects non-localhost PMTiles URLs', () => {
    assert.throws(() => assertLocalhostPmtilesUrl('https://cdn.example/regions/yangon.pmtiles'), /localhost/);
    assert.throws(() => assertLocalhostPmtilesUrl('pmtiles://bucket/file.pmtiles'), /http/);
    assert.doesNotThrow(() =>
      assertLocalhostPmtilesUrl('http://127.0.0.1:8080/regions/yangon/yangon-v1.pmtiles'),
    );
  });

  it('normalizes a manifest without hardcoded package versions', () => {
    const manifest = normalizeLocalPmtilesQaManifest({
      label: 'from-current-json',
      packages: [
        {
          key: 'yangon',
          version: 'discovered-a',
          url: 'http://localhost:8080/regions/yangon/yangon-discovered-a.pmtiles',
        },
        {
          key: 'chin',
          version: 'discovered-b',
          url: 'http://localhost:8080/regions/chin/chin-discovered-b.pmtiles',
        },
      ],
    });
    assert.equal(manifest.packages.length, 2);
    assert.equal(manifest.packageCount, 2);
    assert.equal(manifest.label, 'from-current-json');
    assert.ok(manifest.packages.every((p) => p.url.includes('localhost')));
    assert.ok(!manifest.packages.some((p) => p.version === 'v2' && p.key === 'yangon'));
  });

  it('rejects R2/CDN URLs inside the QA manifest', () => {
    assert.throws(
      () =>
        normalizeLocalPmtilesQaManifest({
          packages: [
            {
              key: 'yangon',
              version: 'v1',
              url: 'https://tiles.example.com/yangon-v1.pmtiles',
            },
          ],
        }),
      /localhost/,
    );
  });

  it('reuses real base-map.json layer templates for all configured local packages', () => {
    const packages = samplePackages(3);
    const overviewUrl = 'http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles';
    const style = composeLocalRegionPmtilesQaWebMapStyle(packages, overviewUrl, 'fixture');

    assert.equal(style.metadata?.['local-map:qa-mode'], 'load-all-local-region-pmtiles');
    assert.equal(style.metadata?.['local-map:qa-package-count'], 3);
    assert.equal(style.metadata?.['local-map:qa-has-overview'], true);
    assert.ok(style.sources?.[OVERVIEW_SOURCE_ID]);
    assert.equal(
      Object.keys(style.sources ?? {}).filter((id) => id.startsWith('local-basemap-')).length,
      packages.length,
    );
    assert.equal(
      style.layers?.filter(
        (layer) => 'source' in layer && String(layer.source).startsWith('local-basemap-'),
      ).length,
      REGIONAL_LAYER_COUNT * packages.length,
    );
    assert.ok(!style.sources?.['local-basemap']);
    assert.ok(style.layers?.some((layer) => layer.id === 'landuse-yangon-test-v1'));
    // Same paint template as production base-map (layer id prefix from base-map.json).
    const templateLanduse = BaseMapStyle.layers.find((l) => l.id === 'landuse');
    const qaLanduse = style.layers?.find((l) => l.id === 'landuse-yangon-test-v1');
    assert.ok(templateLanduse && qaLanduse && 'paint' in templateLanduse && 'paint' in qaLanduse);
    assert.deepEqual(
      (qaLanduse as { paint?: unknown }).paint,
      (templateLanduse as { paint?: unknown }).paint,
    );
  });

  it('parity style reuses composeWebMapStyle overview handoff without static regions', () => {
    const overviewUrl = 'http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles';
    const style = composeLocalPmtilesQaParityStyle(overviewUrl, 'fixture');
    assert.equal(style.metadata?.['local-map:qa-mode'], 'parity-viewport-regions');
    assert.equal(style.metadata?.['local-map:qa-has-overview'], true);
    assert.equal(style.metadata?.['local-map:qa-max-loaded-regions'], 4);
    assert.equal(style.metadata?.['local-map:qa-regional-min-zoom'], 7);
    assert.ok(style.sources?.[OVERVIEW_SOURCE_ID]);
    assert.equal(
      Object.keys(style.sources ?? {}).filter((id) => id.startsWith('local-basemap')).length,
      0,
    );
    // Same overview layer stack as composeWebMapStyle (production handoff).
    const viaCompose = composeWebMapStyle(
      {
        ...(BaseMapStyle as never),
        sources: {},
        layers: (BaseMapStyle.layers ?? []).filter((l) => l.id === 'background'),
      } as never,
      overviewUrl,
    );
    const parityOverviewIds = (style.layers ?? [])
      .filter((l) => l.id.startsWith('overview-') || l.id.startsWith('myanmar-') || l.id.startsWith('neighbor-'))
      .map((l) => l.id);
    const composeOverviewIds = (viaCompose.layers ?? [])
      .filter((l) => l.id.startsWith('overview-') || l.id.startsWith('myanmar-') || l.id.startsWith('neighbor-'))
      .map((l) => l.id);
    assert.deepEqual(parityOverviewIds, composeOverviewIds);
  });

  it('builds a BasemapManifest for the production viewport loader', () => {
    const packages: LocalPmtilesQaPackage[] = [
      {
        key: 'yangon',
        version: 'v2-water-fix',
        url: 'http://localhost:8080/regions/yangon/yangon-v2-water-fix.pmtiles',
        minZoom: 8,
        maxZoom: 16,
        bounds: [93.07, 13.83, 96.96, 18.02],
      },
    ];
    const qa = normalizeLocalPmtilesQaManifest({
      overview: {
        url: 'http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles',
        version: 'v1',
        bounds: [90, 9, 102, 29],
      },
      packages,
    });
    const basemap = localPmtilesQaToBasemapManifest(qa, packages);
    assert.equal(basemap.overview.url.startsWith('http://localhost:8080/'), true);
    assert.equal(basemap.regions.length, 1);
    assert.equal(basemap.regions[0]?.id, 'yangon');
    assert.equal(basemap.regions[0]?.minZoom, 8);
    assert.equal(basemap.regions[0]?.maxZoom, 16);
  });

  it('uses native regional source zooms and skips overview handoff when overview is absent', () => {
    const packages: LocalPmtilesQaPackage[] = [
      {
        key: 'yangon',
        version: 'v2-size-audit',
        url: 'http://localhost:8080/regions/yangon/yangon-v2-size-audit.pmtiles',
        minZoom: 8,
        maxZoom: 16,
      },
    ];
    const style = composeLocalRegionPmtilesQaWebMapStyle(packages);
    const source = style.sources?.[regionalPmtilesQaSourceId('yangon', 'v2-size-audit')] as {
      minzoom?: number;
      maxzoom?: number;
    };
    assert.equal(source?.minzoom, 8);
    assert.equal(source?.maxzoom, 16);
    assert.equal(style.metadata?.['local-map:qa-has-overview'], false);
    assert.equal(style.metadata?.['local-map:progressive-detail'], 'regional-only-native-zoom');
    assert.ok(!style.sources?.[OVERVIEW_SOURCE_ID]);
  });

  it('can represent every package from an injected 15-package list', () => {
    const packages: LocalPmtilesQaPackage[] = [
      'ayeyarwady',
      'bago',
      'chin',
      'kachin',
      'kayah',
      'kayin',
      'magway',
      'mandalay',
      'mon',
      'naypyitaw',
      'rakhine',
      'sagaing',
      'shan',
      'tanintharyi',
      'yangon',
    ].map((key) => ({
      key,
      version: 'build-x',
      url: `http://localhost:8080/regions/${key}/${key}-build-x.pmtiles`,
    }));
    const style = composeLocalRegionPmtilesQaWebMapStyle(packages);
    assert.equal(style.metadata?.['local-map:qa-package-count'], 15);
    for (const pkg of packages) {
      assert.ok(style.sources?.[regionalPmtilesQaSourceId(pkg.key, pkg.version)]);
      assert.ok(pkg.url.startsWith('http://localhost:8080/'));
    }
  });

  it('keeps overview layers below regional stacks', () => {
    const packages = samplePackages(1);
    const style = composeLocalRegionPmtilesQaWebMapStyle(
      packages,
      'http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles',
    );
    const ids = style.layers?.map((layer) => layer.id) ?? [];
    const bg = ids.indexOf('background');
    const firstOverview = ids.indexOf('overview-ocean');
    const firstRegional = ids.indexOf('landuse-yangon-test-v1');
    assert.equal(bg, 0);
    assert.ok(firstOverview > bg);
    assert.ok(firstRegional > ids.indexOf('overview-populated-places'));
  });

  it('parses ?qaPackage= for single-package filter and composition mode', () => {
    assert.equal(readLocalPmtilesQaPackageQueryParam('?qaPackage=yangon'), 'yangon');
    assert.equal(readLocalPmtilesQaPackageQueryParam('?qaPackage=ALL'), null);
    assert.equal(readLocalPmtilesQaPackageQueryParam(''), null);
    assert.equal(readLocalPmtilesQaCompositionMode(''), 'parity');
    assert.equal(readLocalPmtilesQaCompositionMode('?qaPackage=yangon'), 'parity');
    assert.equal(readLocalPmtilesQaCompositionMode('?qaPackage=all'), 'stress');
    assert.equal(readLocalPmtilesQaCompositionMode('?qaStress=1'), 'stress');
    const packages = samplePackages(3);
    assert.equal(filterLocalPmtilesQaPackages(packages, null).length, 3);
    assert.deepEqual(
      filterLocalPmtilesQaPackages(packages, 'bago').map((p) => p.key),
      ['bago'],
    );
    assert.throws(() => filterLocalPmtilesQaPackages(packages, 'nope'), /unknown qaPackage/);
  });

  it('maps QA source ids back to package keys', () => {
    assert.equal(packageKeyFromQaSourceId('local-basemap-yangon-v2-size-audit'), 'yangon');
    assert.equal(packageKeyFromQaSourceId('local-basemap-naypyitaw-v1'), 'naypyitaw');
    assert.equal(packageKeyFromQaSourceId('region-yangon'), 'yangon');
    assert.equal(packageKeyFromQaSourceId('overview'), null);
  });
});
