export type NamePairReviewStatus = "pending" | "approved" | "rejected" | "skipped";

export type NamePairEntityType =
  | "place"
  | "settlement"
  | "admin_area"
  | "street"
  | "building"
  | "transport_stop"
  | "transport_terminal";

export type NamePairBucket = "review" | "remain_non_street" | "remain_minor_streets";

export type NamePairReviewItem = {
  public_id: string;
  entity_type: NamePairEntityType | string;
  entity_id: string;
  entity_public_id: string | null;
  direction: string;
  source_name: string;
  proposed_mm: string | null;
  proposed_en: string | null;
  confidence: number;
  reason: string;
  status: NamePairReviewStatus | string;
  fill_run_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
};

export type NamePairGapItem = {
  entity_type: NamePairEntityType | string;
  entity_id: string;
  entity_public_id: string | null;
  source_name: string;
  name_mm: string | null;
  name_en: string | null;
  gap_reason: string;
};

export type NamePairReviewListFilters = {
  status?: string;
  entity_type?: string;
  reason?: string;
  exclude_reason?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export type NamePairBucketSummary = {
  total: number;
  by_entity: Record<string, number>;
};

export type NamePairSummary = {
  review: NamePairBucketSummary & {
    auto_applied?: NamePairBucketSummary;
    other?: NamePairBucketSummary;
  };
  remain_non_street: NamePairBucketSummary;
  remain_minor_streets: NamePairBucketSummary;
  remain_status?: "ready" | "computing" | "missing" | "error";
  remain_computed_at?: string | null;
};

export const NAME_PAIR_REASON_AUTO_APPLIED = "auto_applied_needs_review";
