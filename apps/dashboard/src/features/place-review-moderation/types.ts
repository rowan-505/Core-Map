/** Tourism admin types mirrored from the CoreMap tourism API (snake_case DTOs). */

export type PlaceReviewStatus =
  | "pending"
  | "published"
  | "rejected"
  | "hidden"
  | "deleted";

export type PlaceReviewModerationAction = "publish" | "reject" | "hide" | "restore";

export type TourismAuthor = {
  readonly public_id: string;
  readonly display_name: string;
};

export type PlaceReviewListItem = {
  readonly public_id: string;
  readonly place_public_id: string;
  readonly rating: number;
  readonly title: string | null;
  readonly body: string | null;
  readonly status: PlaceReviewStatus;
  readonly created_at: string;
  readonly updated_at: string;
  readonly published_at: string | null;
  readonly author: TourismAuthor;
  readonly moderation_note: string | null;
};

export type TourismModerationEvent = {
  readonly from_status: PlaceReviewStatus;
  readonly to_status: PlaceReviewStatus;
  readonly note: string | null;
  readonly created_at: string;
  readonly actor: TourismAuthor | null;
};

export type PlaceReviewDetail = PlaceReviewListItem & {
  readonly moderation_history: readonly TourismModerationEvent[];
};

export type PlaceReviewPage = {
  readonly items: readonly PlaceReviewListItem[];
  readonly next_cursor: string | null;
};

export type PlaceReviewListFilters = {
  readonly status?: PlaceReviewStatus | "all";
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
  readonly is_public?: boolean;
  readonly created_at?: string;
  readonly updated_at?: string;
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
  readonly tourism_type: string;
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
  readonly tourism_type: string;
  readonly short_description?: string | null;
  readonly price_level?: number | null;
  readonly editor_pick?: boolean;
  readonly is_public?: boolean;
};

export type TourismProfilePatchBody = {
  readonly tourism_type?: string;
  readonly short_description?: string | null;
  readonly price_level?: number | null;
  readonly editor_pick?: boolean;
  readonly is_public?: boolean;
};
