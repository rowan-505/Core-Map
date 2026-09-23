export type ReverseAddressConfidence =
  | 'exact_nearby'
  | 'street_nearby'
  | 'area_based'
  | 'unknown';

export type ReverseAddressResult = {
  readonly address_line: string;
  readonly plus_code: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly confidence: ReverseAddressConfidence;
};

export type AddressesReverseBody = {
  readonly display_address?: string | null;
  readonly full_address_en?: string | null;
  readonly full_address_my?: string | null;
  readonly result_type?: string | null;
  readonly confidence_score?: number | null;
};

/** Path for the single public-map reverse geocode request. */
export function buildAddressesReversePath(
  lat: number,
  lng: number,
  languageMode: 'my' | 'en' | 'both' = 'my',
): string {
  const search = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    lang: languageMode === 'en' ? 'en' : 'my',
  });
  return `/addresses/reverse?${search.toString()}`;
}

export function confidenceFromAddressesReverse(
  resultType: unknown,
  confidenceScore: unknown,
): ReverseAddressConfidence {
  if (typeof resultType === 'string') {
    switch (resultType) {
      case 'exact_address':
      case 'building_address':
      case 'place_address':
        return 'exact_nearby';
      case 'street_area_address':
      case 'building_partial_address':
        return 'street_nearby';
      case 'locality_partial_address':
      case 'admin_only':
        return 'area_based';
      default:
        break;
    }
  }
  if (typeof confidenceScore === 'number' && Number.isFinite(confidenceScore)) {
    const score = confidenceScore > 1 ? confidenceScore / 100 : confidenceScore;
    if (score >= 0.85) return 'exact_nearby';
    if (score >= 0.55) return 'street_nearby';
    if (score >= 0.25) return 'area_based';
  }
  return 'unknown';
}

export function adaptAddressesReverseResponse(
  body: AddressesReverseBody,
  lat: number,
  lng: number,
  languageMode: 'my' | 'en' | 'both' = 'my',
): ReverseAddressResult {
  const localizedAddress =
    body.display_address ??
    (languageMode === 'en' ? body.full_address_en : body.full_address_my);

  return {
    address_line:
      typeof localizedAddress === 'string' && localizedAddress.trim() !== ''
        ? localizedAddress
        : languageMode === 'en'
          ? 'Myanmar'
          : 'မြန်မာ',
    plus_code: null,
    lat,
    lng,
    confidence: confidenceFromAddressesReverse(body.result_type, body.confidence_score),
  };
}
