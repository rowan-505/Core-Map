import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMMUNITY_CATEGORIES,
  communityCategoryLabel,
  isCommunityCategoryCode,
} from './communityCategories.ts';

describe('communityCategories', () => {
  it('keeps the minimal V2 category set', () => {
    assert.equal(COMMUNITY_CATEGORIES.length, 8);
    assert.equal(isCommunityCategoryCode('local_update'), true);
    assert.equal(isCommunityCategoryCode('unknown'), false);
  });

  it('labels known codes through the bilingual helper', () => {
    assert.equal(
      communityCategoryLabel('transport', (my, en) => en),
      'Transport',
    );
    assert.equal(
      communityCategoryLabel('custom_topic', (my, en) => en),
      'custom_topic',
    );
  });
});
