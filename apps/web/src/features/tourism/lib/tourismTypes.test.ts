import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TOURISM_TYPE_FILTERS,
  tourismTypeFilterLabel,
} from './tourismTypes.ts';

const t = (my: string, en: string) => en;

describe('tourismTypes', () => {
  it('filters include All plus the 13 V1 taxonomy codes', () => {
    assert.equal(TOURISM_TYPE_FILTERS[0]?.code, null);
    assert.equal(TOURISM_TYPE_FILTERS.length, 14);
    assert.equal(tourismTypeFilterLabel(null, t), 'All');
    assert.equal(tourismTypeFilterLabel('religious', t), 'Religious');
    assert.equal(tourismTypeFilterLabel('waterfall', t), 'Waterfall');
    assert.equal(tourismTypeFilterLabel('custom_type', t), 'custom_type');
  });

  it('type filter selection clears to null for All', () => {
    const selected = TOURISM_TYPE_FILTERS.find((item) => item.code === 'historical');
    assert.ok(selected);
    const cleared = TOURISM_TYPE_FILTERS.find((item) => item.code === null);
    assert.equal(cleared?.code, null);
  });
});
