import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  OVERVIEW_COUNTRY_LABEL_TEXT_FIELD,
  OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_FIELD,
  OVERVIEW_POPULATED_PLACES_TEXT_FIELD,
  getOverviewLabelTextField,
  isOverviewLabelLayerId,
} from './overviewLabelTextFields.js';

function expressionUsesGet(expr: unknown, field: string): boolean {
  return JSON.stringify(expr).includes(`"get","${field}"`);
}

describe('overview label text-field map (used by localizedBasemapLabels)', () => {
  it('registers all overview label layer ids', () => {
    assert.ok(isOverviewLabelLayerId('overview-country-labels'));
    assert.ok(isOverviewLabelLayerId('overview-admin-state-region-labels'));
    assert.ok(isOverviewLabelLayerId('overview-populated-places'));
    assert.equal(isOverviewLabelLayerId('overview-ocean'), false);
    assert.equal(isOverviewLabelLayerId('road-labels'), false);
  });

  it('country labels use Natural Earth NAME/ADMIN fields', () => {
    const expr = getOverviewLabelTextField('overview-country-labels');
    assert.deepEqual(expr, OVERVIEW_COUNTRY_LABEL_TEXT_FIELD);
    assert.ok(expressionUsesGet(expr, 'NAME'));
    assert.ok(expressionUsesGet(expr, 'ADMIN'));
    assert.ok(expressionUsesGet(expr, 'NAME_EN'));
    assert.ok(!expressionUsesGet(expr, 'name_mm'));
  });

  it('populated places use Natural Earth NAME/NAMEASCII fields', () => {
    const expr = getOverviewLabelTextField('overview-populated-places');
    assert.deepEqual(expr, OVERVIEW_POPULATED_PLACES_TEXT_FIELD);
    assert.ok(expressionUsesGet(expr, 'NAME'));
    assert.ok(expressionUsesGet(expr, 'NAMEASCII'));
  });

  it('admin_state_region labels prefer overview short aliases / core_id map', () => {
    const expr = getOverviewLabelTextField('overview-admin-state-region-labels');
    assert.deepEqual(expr, OVERVIEW_ADMIN_STATE_REGION_LABEL_TEXT_FIELD);
    assert.ok(expressionUsesGet(expr, 'label_name_mm'));
    assert.ok(expressionUsesGet(expr, 'core_id'));
    assert.ok(expressionUsesGet(expr, 'name_mm'));
    assert.ok(!expressionUsesGet(expr, 'ST'));
    assert.ok(!expressionUsesGet(expr, 'ST_MMR'));
  });
});
