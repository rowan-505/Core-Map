export type TourismRankingMode =
  | 'recommended'
  | 'top_rated'
  | 'most_reviewed'
  | 'nearby'
  | 'editor_picks';

export type TourismRankedPlace = {
  readonly public_id: string;
  readonly name: string;
  readonly name_mm: string | null;
  readonly name_en: string | null;
  readonly display_name: string | null;
  readonly primary_name: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly is_verified: boolean;
  readonly tourism_type: string;
  readonly short_description: string | null;
  readonly price_level: number | null;
  readonly editor_pick: boolean;
  readonly average_rating: number | null;
  readonly published_review_count: number;
  readonly distance_meters: number | null;
};

export type TourismRankedPlacePage = {
  readonly mode: TourismRankingMode;
  readonly items: readonly TourismRankedPlace[];
  readonly next_cursor: string | null;
};

export type TourismPlaceProfile = {
  readonly public_id: string;
  readonly name: string;
  readonly name_mm: string | null;
  readonly name_en: string | null;
  readonly display_name: string | null;
  readonly primary_name: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly category_code: string | null;
  readonly category_name: string | null;
  readonly is_verified: boolean;
  readonly address: {
    readonly full_address: string;
    readonly postal_code: string | null;
  } | null;
  readonly contact: {
    readonly phone: string | null;
    readonly website: string | null;
    readonly facebook_url: string | null;
    readonly opening_hours: string | null;
  } | null;
  readonly tourism_type: string;
  readonly short_description: string | null;
  readonly price_level: number | null;
  readonly editor_pick: boolean;
  readonly average_rating: number | null;
  readonly published_review_count: number;
};

export type TourismPlacesListQuery = {
  readonly mode: TourismRankingMode;
  readonly cursor?: string;
  readonly limit?: number;
  readonly lang?: 'my' | 'en';
  readonly tourism_type?: string;
  readonly lat?: number;
  readonly lng?: number;
  readonly radius_m?: number;
  /** west,south,east,north */
  readonly bbox?: string;
};

