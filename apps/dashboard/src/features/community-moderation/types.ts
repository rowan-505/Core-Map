/** Community moderation types mirrored from the CoreMap admin Community API. */

export type CommunityPublicationStatus =
  | "published"
  | "resolved"
  | "expired"
  | "rejected"
  | "removed";

export type CommunityVerificationStatus =
  | "unverified"
  | "community_confirmed"
  | "admin_verified";

export type CommunityModerationAction =
  | "verify"
  | "unverify"
  | "reject"
  | "resolve"
  | "expire"
  | "remove"
  | "reopen";

export type CommunityAuthor = {
  readonly public_id: string;
  readonly display_name: string;
};

export type CommunityLocation = {
  readonly lng: number;
  readonly lat: number;
  readonly label: string | null;
};

export type CommunityReactionCounts = {
  readonly confirm: number;
  readonly helpful: number;
  readonly incorrect: number;
};

export type CommunityPostListItem = {
  readonly public_id: string;
  readonly title: string;
  readonly description_preview: string;
  readonly category: string;
  readonly publication_status: CommunityPublicationStatus;
  readonly verification_status: CommunityVerificationStatus;
  readonly trust_score: number;
  readonly published_at: string;
  readonly has_location: boolean;
  readonly location: CommunityLocation | null;
  readonly author: CommunityAuthor;
  readonly reaction_counts: CommunityReactionCounts;
};

export type CommunityModerationEvent = {
  readonly public_id: string;
  readonly action_code: string;
  readonly from_publication_status: string | null;
  readonly to_publication_status: string | null;
  readonly from_verification_status: string | null;
  readonly to_verification_status: string | null;
  readonly note: string | null;
  readonly created_at: string;
  readonly actor: CommunityAuthor | null;
};

export type CommunityAdminPostDetail = CommunityPostListItem & {
  readonly description: string;
  readonly updated_at: string;
  readonly created_at: string;
  readonly viewer_reaction: "confirm" | "helpful" | "incorrect" | null;
  readonly moderation_history: readonly CommunityModerationEvent[];
};

export type CommunityPostPage = {
  readonly items: readonly CommunityPostListItem[];
  readonly next_cursor: string | null;
};

export type CommunityAdminCounts = {
  readonly needs_review: number;
  readonly live: number;
  readonly trusted: number;
  readonly closed: number;
};

/** Primary workflow tabs. */
export type CommunityQueueView = "needs_review" | "live" | "trusted" | "closed";

export type CommunityLiveVerificationFilter =
  | "all"
  | "unverified"
  | "community_confirmed"
  | "admin_verified";

export type CommunityClosedStatusFilter =
  | "all"
  | "resolved"
  | "expired"
  | "rejected"
  | "removed";

export type CommunityListFilters = {
  readonly view: CommunityQueueView;
  readonly category?: string;
  readonly search?: string;
  readonly liveVerification?: CommunityLiveVerificationFilter;
  readonly closedStatus?: CommunityClosedStatusFilter;
  readonly cursor?: string;
  readonly limit?: number;
};
