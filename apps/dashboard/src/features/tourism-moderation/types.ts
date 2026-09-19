/** Tourism admin types mirrored from the CoreMap tourism API (snake_case DTOs). */

export type TourismReviewStatus =
  | "pending"
  | "published"
  | "rejected"
  | "hidden"
  | "deleted";

export type TourismModerationAction = "publish" | "reject" | "hide" | "restore";

export type TourismAuthor = {
  readonly public_id: string;
  readonly display_name: string;
};

export type TourismReviewListItem = {
  readonly public_id: string;
  readonly place_public_id: string;
  readonly rating: number;
  readonly title: string | null;
  readonly body: string | null;
  readonly status: TourismReviewStatus;
  readonly created_at: string;
  readonly updated_at: string;
  readonly published_at: string | null;
  readonly author: TourismAuthor;
  readonly moderation_note: string | null;
};

export type TourismModerationEvent = {
  readonly from_status: TourismReviewStatus;
  readonly to_status: TourismReviewStatus;
  readonly note: string | null;
  readonly created_at: string;
  readonly actor: TourismAuthor | null;
};

export type TourismReviewDetail = TourismReviewListItem & {
  readonly moderation_history: readonly TourismModerationEvent[];
};

export type TourismReviewPage = {
  readonly items: readonly TourismReviewListItem[];
  readonly next_cursor: string | null;
};

export const TOURISM_TYPE_CODES = [
  "attraction",
  "religious",
  "historical",
  "cultural",
  "nature",
  "museum",
  "viewpoint",
  "beach",
  "waterfall",
  "park",
  "market",
  "recreation",
  "other",
] as const;

export type TourismTypeCode = (typeof TOURISM_TYPE_CODES)[number];

export type TourismTypeReference = {
  readonly code: TourismTypeCode;
  readonly name_en: string;
  readonly name_mm: string | null;
  readonly sort_order: number;
};

export type TourismTypePage = {
  readonly items: readonly TourismTypeReference[];
};

export const TOURISM_EDITORIAL_SCORES = [20, 35, 50, 65, 80, 95] as const;
export type TourismEditorialScore = (typeof TOURISM_EDITORIAL_SCORES)[number];

export type TourismSeasonMode =
  | "all_year"
  | "best_months"
  | "poor_months"
  | "temporarily_closed";

export type TourismReviewListFilters = {
  readonly status?: TourismReviewStatus | "all";
  readonly placeId?: string;
  readonly authorId?: string;
  readonly q?: string;
  readonly cursor?: string;
  readonly limit?: number;
};

export type TourismPlaceProfileAdmin = {
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
  readonly tourism_type: TourismTypeCode;
  readonly short_description: string | null;
  readonly price_level: number | null;
  readonly editor_pick: boolean;
  readonly editorial_score: TourismEditorialScore;
  readonly manual_boost: number;
  readonly season_mode: TourismSeasonMode;
  readonly season_start_month: number | null;
  readonly season_end_month: number | null;
  readonly importance_score: number | null;
  readonly average_rating: number | null;
  readonly published_review_count: number;
  readonly is_public?: boolean;
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly recent_manual_boost_audits?: readonly {
    readonly created_at: string;
    readonly action_type: string;
    readonly manual_boost: number | null;
    readonly reason: string | null;
  }[];
};

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
  readonly tourism_type: TourismTypeCode;
  readonly short_description: string | null;
  readonly price_level: number | null;
  readonly editor_pick: boolean;
  readonly average_rating: number | null;
  readonly published_review_count: number;
  readonly distance_meters: number | null;
};

export type TourismRankedPlacePage = {
  readonly mode: string;
  readonly items: readonly TourismRankedPlace[];
  readonly next_cursor: string | null;
};

export type TourismPlacesListFilters = {
  readonly mode?: string;
  readonly tourism_type?: string;
  readonly q?: string;
  readonly cursor?: string;
  readonly limit?: number;
};

export type TourismProfileUpsertBody = {
  readonly tourism_type: TourismTypeCode;
  readonly short_description?: string | null;
  readonly price_level?: number | null;
  readonly editor_pick?: boolean;
  readonly is_public?: boolean;
  readonly editorial_score: TourismEditorialScore;
  readonly manual_boost: number;
  readonly season_mode: TourismSeasonMode;
  readonly season_start_month: number | null;
  readonly season_end_month: number | null;
};

export type TourismProfilePatchBody = {
  readonly tourism_type?: TourismTypeCode;
  readonly short_description?: string | null;
  readonly price_level?: number | null;
  readonly editor_pick?: boolean;
  readonly is_public?: boolean;
  readonly editorial_score?: TourismEditorialScore;
  readonly manual_boost?: number;
  readonly manual_boost_reason?: string | null;
  readonly season_mode?: TourismSeasonMode;
  readonly season_start_month?: number | null;
  readonly season_end_month?: number | null;
};
