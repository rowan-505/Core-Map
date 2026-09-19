export type TourismCatalogType = {
  code: string;
  name_en: string;
  name_mm: string | null;
  sort_order: number;
};

export type TourismScheduleReviewStatus =
  | "none"
  | "current"
  | "due_soon"
  | "overdue";

export type TourismScheduleReviewFilter =
  | "current"
  | "due_soon"
  | "overdue"
  | "needs_review";

export type TourismOccurrenceSummary = {
  public_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
};

export type TourismActivityAdmin = {
  public_id: string;
  name: string;
  short_description: string | null;
  activity_type: string;
  activity_type_name_en: string;
  admin_area_id: string;
  admin_area_name: string;
  primary_place_public_id: string | null;
  primary_place_name: string | null;
  is_active: boolean;
  is_verified: boolean;
  season_mode: string;
  season_start_month: number | null;
  season_end_month: number | null;
  display_priority: number;
  requires_schedule_review: boolean;
  last_schedule_reviewed_at: string | null;
  next_review_due_at: string | null;
  schedule_review_note: string | null;
  review_status: TourismScheduleReviewStatus;
  needs_review: boolean;
  created_at: string;
  updated_at: string;
};

export type TourismEventAdmin = {
  public_id: string;
  name: string;
  short_description: string | null;
  event_type: string;
  event_type_name_en: string;
  admin_area_id: string;
  admin_area_name: string;
  primary_place_public_id: string | null;
  primary_place_name: string | null;
  is_active: boolean;
  is_verified: boolean;
  requires_schedule_review: boolean;
  last_schedule_reviewed_at: string | null;
  next_review_due_at: string | null;
  schedule_review_note: string | null;
  review_status: TourismScheduleReviewStatus;
  needs_review: boolean;
  missing_next_occurrence: boolean;
  next_occurrence: TourismOccurrenceSummary | null;
  last_occurrence: TourismOccurrenceSummary | null;
  created_at: string;
  updated_at: string;
};

export type TourismOccurrenceAdmin = {
  public_id: string;
  event_public_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  schedule_note: string | null;
  source_url: string | null;
  verified_at: string | null;
  derived_state: string;
  duration_seconds: number;
  duration_days: number;
  created_at: string;
  updated_at: string;
};

export type TourismActivityListFilters = {
  admin_area_id?: string;
  activity_type?: string;
  is_active?: boolean;
  is_verified?: boolean;
  q?: string;
  review_status?: TourismScheduleReviewFilter;
  limit?: number;
  offset?: number;
};

export type TourismEventListFilters = {
  admin_area_id?: string;
  event_type?: string;
  is_active?: boolean;
  is_verified?: boolean;
  q?: string;
  tab?: "all" | "upcoming";
  review_status?: TourismScheduleReviewFilter;
  limit?: number;
  offset?: number;
};

export const ACTIVITY_SEASON_MODES = [
  "all_year",
  "best_months",
  "poor_months",
  "temporarily_unavailable",
] as const;

export const OCCURRENCE_STATUSES = [
  "scheduled",
  "confirmed",
  "cancelled",
  "completed",
] as const;

export function reviewStatusLabel(status: TourismScheduleReviewStatus): string {
  switch (status) {
    case "due_soon":
      return "Due soon";
    case "overdue":
      return "Overdue";
    case "current":
      return "Current";
    default:
      return "None";
  }
}
