import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildTourismPlacesQuery } from './buildTourismPlacesQuery.ts';
import {
  TOURISM_PLACE_CARD_CLASS,
  flattenTourismPages,
  resolveTourismListUiState,
  tourismModeNeedsMapCenter,
} from './tourismListState.ts';
import type { TourismRankedPlace } from '../api/tourismApiTypes.ts';

function place(
  overrides: Partial<TourismRankedPlace> & Pick<TourismRankedPlace, 'public_id'>,
): TourismRankedPlace {
  return {
    public_id: overrides.public_id,
    name: overrides.name ?? 'Place',
    name_mm: null,
    name_en: null,
    display_name: null,
    primary_name: null,
    lat: 16.8,
    lng: 96.2,
    is_verified: false,
    tourism_type: overrides.tourism_type ?? 'attraction',
    short_description: null,
    price_level: null,
    editor_pick: false,
    average_rating: overrides.average_rating ?? 4,
    published_review_count: overrides.published_review_count ?? 2,
    distance_meters: null,
  };
}

describe('tourism list / pagination / filters', () => {
  it('builds paginated API query without fetching all places', () => {
    const qs = buildTourismPlacesQuery({
      mode: 'recommended',
      limit: 20,
      cursor: 'cursor-1',
      tourism_type: 'nature',
      lang: 'en',
    });
    assert.match(qs, /mode=recommended/);
    assert.match(qs, /limit=20/);
    assert.match(qs, /cursor=cursor-1/);
    assert.match(qs, /tourism_type=nature/);
    assert.equal(qs.includes('score'), false);
  });

  it('applies type filter in query string when selected', () => {
    const all = buildTourismPlacesQuery({ mode: 'top_rated' });
    const filtered = buildTourismPlacesQuery({
      mode: 'top_rated',
      tourism_type: 'religious',
    });
    assert.equal(all.includes('tourism_type'), false);
    assert.match(filtered, /tourism_type=religious/);
  });

  it('paginates by flattening pages and keeping next cursor behavior', () => {
    const page1 = [place({ public_id: 'a' }), place({ public_id: 'b' })];
    const page2 = [place({ public_id: 'b' }), place({ public_id: 'c' })];
    const flat = flattenTourismPages([{ items: page1 }, { items: page2 }]);
    assert.deepEqual(
      flat.map((item) => item.public_id),
      ['a', 'b', 'c'],
    );

    const ready = resolveTourismListUiState({
      isLoading: false,
      isError: false,
      errorMessage: '',
      items: flat,
      hasMore: true,
      loadingMore: false,
    });
    assert.equal(ready.kind, 'ready');
    if (ready.kind === 'ready') {
      assert.equal(ready.hasMore, true);
      assert.equal(ready.items.length, 3);
    }
  });

  it('shows empty state for zero results', () => {
    const empty = resolveTourismListUiState({
      isLoading: false,
      isError: false,
      errorMessage: '',
      items: [],
      hasMore: false,
      loadingMore: false,
    });
    assert.equal(empty.kind, 'empty');
  });

  it('shows error state on API failure with no items', () => {
    const errored = resolveTourismListUiState({
      isLoading: false,
      isError: true,
      errorMessage: 'Tourism list unavailable',
      items: [],
      hasMore: false,
      loadingMore: false,
    });
    assert.equal(errored.kind, 'error');
    if (errored.kind === 'error') {
      assert.equal(errored.message, 'Tourism list unavailable');
    }
  });

  it('keeps nearby mode gated on map center', () => {
    assert.equal(tourismModeNeedsMapCenter('nearby'), true);
    assert.equal(tourismModeNeedsMapCenter('recommended'), false);
  });

  it('uses mobile-friendly card class contract', () => {
    assert.match(TOURISM_PLACE_CARD_CLASS, /min-h-16/);
    assert.match(TOURISM_PLACE_CARD_CLASS, /w-full/);
    assert.match(TOURISM_PLACE_CARD_CLASS, /p-3/);
    assert.match(TOURISM_PLACE_CARD_CLASS, /rounded-map-card/);
  });
});
