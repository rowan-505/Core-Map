import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatCommunityBbox,
  shouldOfferCommunityAreaSearch,
} from './communityBbox.ts';

describe('communityBbox', () => {
  it('formats west,south,east,north', () => {
    assert.equal(formatCommunityBbox([96.1, 16.7, 96.3, 16.9]), '96.1,16.7,96.3,16.9');
  });

  it('does not offer search when viewport is nearly unchanged', () => {
    const bbox = [96.1, 16.7, 96.3, 16.9] as const;
    assert.equal(
      shouldOfferCommunityAreaSearch({
        committed: bbox,
        live: bbox,
        committedZoom: 12,
        liveZoom: 12.2,
      }),
      false,
    );
  });

  it('offers search after meaningful center drift', () => {
    assert.equal(
      shouldOfferCommunityAreaSearch({
        committed: [96.1, 16.7, 96.3, 16.9],
        live: [96.2, 16.7, 96.4, 16.9],
        committedZoom: 12,
        liveZoom: 12,
      }),
      true,
    );
  });

  it('offers search after zoom delta', () => {
    const bbox = [96.1, 16.7, 96.3, 16.9] as const;
    assert.equal(
      shouldOfferCommunityAreaSearch({
        committed: bbox,
        live: bbox,
        committedZoom: 11,
        liveZoom: 12.5,
      }),
      true,
    );
  });
});
