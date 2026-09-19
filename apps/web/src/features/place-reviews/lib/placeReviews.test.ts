import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isDuplicatePlaceReviewError,
  validatePlaceReviewInput,
} from './validatePlaceReview.ts';
import {
  resolveAuthorReviewView,
  shouldShowCreateReviewForm,
} from './placeReviewStatus.ts';
import {
  filterPublishedReviewsOnly,
  flattenPlaceReviewPages,
  resolvePlaceReviewsUiState,
} from './placeReviewListState.ts';
import type { PlaceReviewOwner, PlaceReviewPublic } from '../api/placeReviewsApiTypes.ts';

function review(
  overrides: Partial<PlaceReviewPublic> & Pick<PlaceReviewPublic, 'public_id' | 'status'>,
): PlaceReviewPublic {
  return {
    public_id: overrides.public_id,
    place_public_id: 'place-1',
    rating: overrides.rating ?? 4,
    title: overrides.title ?? null,
    body: overrides.body ?? null,
    status: overrides.status,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    published_at: overrides.status === 'published' ? '2026-09-01T00:00:00.000Z' : null,
    author: { public_id: 'user-1', display_name: 'Ada' },
  };
}

function owner(
  overrides: Partial<PlaceReviewOwner> & Pick<PlaceReviewOwner, 'public_id' | 'status'>,
): PlaceReviewOwner {
  return { ...review(overrides), moderation_note: overrides.moderation_note ?? null };
}

describe('universal place review validation and ownership', () => {
  it('allows one authenticated review and validates rating', () => {
    assert.equal(shouldShowCreateReviewForm({
      isAuthenticated: true,
      myReview: null,
      isEditing: false,
    }), true);
    assert.equal(validatePlaceReviewInput({ rating: 5, title: 'Great', body: '' }).ok, true);
    assert.equal(validatePlaceReviewInput({ rating: 9, title: '', body: '' }).ok, false);
    assert.equal(isDuplicatePlaceReviewError({ status: 409 }), true);
  });

  it('does not show create when an owned review exists', () => {
    const myReview = owner({ public_id: 'r1', status: 'pending' });
    assert.equal(shouldShowCreateReviewForm({
      isAuthenticated: true,
      myReview,
      isEditing: false,
    }), false);
    assert.equal(resolveAuthorReviewView(myReview).kind, 'owned');
  });
});

describe('universal published place reviews', () => {
  it('deduplicates pages and filters unpublished reviews', () => {
    const items = filterPublishedReviewsOnly(flattenPlaceReviewPages([
      { items: [review({ public_id: 'a', status: 'published' }), review({ public_id: 'b', status: 'pending' })] },
      { items: [review({ public_id: 'a', status: 'published' }), review({ public_id: 'c', status: 'published' })] },
    ]));
    assert.deepEqual(items.map((item) => item.public_id), ['a', 'c']);
    assert.equal(resolvePlaceReviewsUiState({
      isLoading: false,
      isError: false,
      errorMessage: '',
      items,
      hasMore: false,
      loadingMore: false,
    }).kind, 'ready');
  });
});
