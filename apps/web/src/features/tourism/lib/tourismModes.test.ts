import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TOURISM_MODE_META,
  TOURISM_RANKING_MODES,
  isTourismRankingMode,
  tourismModeLabel,
} from './tourismModes.ts';

const t = (my: string, en: string) => en;

describe('tourismModes', () => {
  it('lists discovery modes without a “best” label', () => {
    assert.deepEqual([...TOURISM_RANKING_MODES], [
      'recommended',
      'top_rated',
      'most_reviewed',
      'nearby',
      'editor_picks',
    ]);
    for (const meta of TOURISM_MODE_META) {
      assert.equal(meta.labelEn.toLowerCase().includes('best'), false);
      assert.equal(tourismModeLabel(meta.id, t).toLowerCase().includes('best'), false);
    }
    assert.equal(tourismModeLabel('recommended', t), 'Recommended');
    assert.equal(tourismModeLabel('top_rated', t), 'Top rated');
  });

  it('switches mode ids safely', () => {
    assert.equal(isTourismRankingMode('recommended'), true);
    assert.equal(isTourismRankingMode('top_rated'), true);
    assert.equal(isTourismRankingMode('best'), false);
    assert.equal(isTourismRankingMode(''), false);
  });
});
