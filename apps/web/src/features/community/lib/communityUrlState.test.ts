import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isCommunityPostPublicId,
  readCommunityPostIdFromSearch,
  writeCommunityPostIdToSearch,
} from './communityUrlState.ts';

describe('communityUrlState', () => {
  it('accepts uuid public ids only', () => {
    assert.equal(isCommunityPostPublicId('b441f97a-3a4b-43cb-8a16-1ce88869a1aa'), true);
    assert.equal(isCommunityPostPublicId('not-a-uuid'), false);
  });

  it('reads community id from search', () => {
    assert.equal(
      readCommunityPostIdFromSearch('?community=b441f97a-3a4b-43cb-8a16-1ce88869a1aa&x=1'),
      'b441f97a-3a4b-43cb-8a16-1ce88869a1aa',
    );
    assert.equal(readCommunityPostIdFromSearch('?community=bad'), null);
  });

  it('writes and clears community id without dropping other params', () => {
    const withId = writeCommunityPostIdToSearch(
      '?lang=en',
      'b441f97a-3a4b-43cb-8a16-1ce88869a1aa',
    );
    assert.match(withId, /community=b441f97a-3a4b-43cb-8a16-1ce88869a1aa/);
    assert.match(withId, /lang=en/);

    const cleared = writeCommunityPostIdToSearch(withId, null);
    assert.equal(cleared.includes('community='), false);
    assert.match(cleared, /lang=en/);
  });
});
