import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adaptAddressesReverseResponse,
  buildAddressesReversePath,
  confidenceFromAddressesReverse,
} from './reverseAddressClient.js';

describe('buildAddressesReversePath', () => {
  it('targets only /addresses/reverse (not /search/reverse)', () => {
    const path = buildAddressesReversePath(16.7, 96.29, 'my');
    assert.match(path, /^\/addresses\/reverse\?/);
    assert.doesNotMatch(path, /\/search\/reverse/);
    assert.match(path, /lat=16\.7/);
    assert.match(path, /lng=96\.29/);
    assert.match(path, /lang=my/);
  });

  it('maps en language mode to lang=en', () => {
    assert.match(buildAddressesReversePath(1, 2, 'en'), /lang=en/);
  });
});

describe('confidenceFromAddressesReverse', () => {
  it('maps result_type to UI confidence bands', () => {
    assert.equal(confidenceFromAddressesReverse('exact_address', null), 'exact_nearby');
    assert.equal(confidenceFromAddressesReverse('street_area_address', null), 'street_nearby');
    assert.equal(confidenceFromAddressesReverse('admin_only', null), 'area_based');
  });
});

describe('adaptAddressesReverseResponse', () => {
  it('prefers display_address and preserves coordinates', () => {
    const result = adaptAddressesReverseResponse(
      {
        display_address: 'Near Phayar Ngar Su Pagoda, Thanlyin',
        result_type: 'street_area_address',
        confidence_score: 0.7,
      },
      16.7,
      96.29,
      'en',
    );
    assert.equal(result.address_line, 'Near Phayar Ngar Su Pagoda, Thanlyin');
    assert.equal(result.confidence, 'street_nearby');
    assert.equal(result.lat, 16.7);
    assert.equal(result.lng, 96.29);
    assert.equal(result.plus_code, null);
  });
});
