export const TOURISM_FOOD_TYPES = [
  "dish",
  "snack",
  "dessert",
  "drink",
  "specialty",
  "other",
] as const;

export const TOURISM_FOOD_LABELS = [
  "signature",
  "must_try",
  "popular",
  "traditional",
  "local_specialty",
  "street_food",
  "seasonal",
] as const;

export const TOURISM_GUIDE_TYPES = [
  "culture",
  "craft",
  "local_product",
  "food_culture",
  "etiquette",
  "visitor_tip",
  "practical_info",
  "other",
] as const;

export const TOURISM_ADVISORY_TYPES = [
  "access",
  "seasonal",
  "closure",
  "safety",
  "etiquette",
  "transport",
  "weather",
  "payment",
  "visitor_requirement",
  "other",
] as const;

export const TOURISM_ADVISORY_SEVERITIES = ["info", "caution", "important"] as const;

export type TourismFoodPlaceLink = {
  place_public_id: string;
  place_name: string;
  lat: number | null;
  lng: number | null;
  availability_note: string | null;
  is_signature_here: boolean;
  is_verified: boolean;
  source_url: string | null;
  verified_at: string | null;
};

export type TourismFoodAdmin = {
  public_id: string;
  name: string;
  name_en: string | null;
  name_mm: string | null;
  short_description: string | null;
  food_type: string;
  labels: string[];
  admin_area_id: string;
  admin_area_name: string;
  is_active: boolean;
  is_verified: boolean;
  source_url: string | null;
  verified_at: string | null;
  places: TourismFoodPlaceLink[];
  created_at: string;
  updated_at: string;
};

export type TourismFoodListFilters = {
  admin_area_id?: string;
  food_type?: string;
  label?: string;
  is_active?: boolean;
  is_verified?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
};

export type TourismGuideAdmin = {
  public_id: string;
  admin_area_id: string;
  admin_area_name: string;
  place_public_id: string | null;
  place_name: string | null;
  guide_type: string;
  title: string;
  short_description: string | null;
  content: string;
  is_active: boolean;
  is_verified: boolean;
  source_url: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TourismGuideListFilters = {
  admin_area_id?: string;
  place_public_id?: string;
  guide_type?: string;
  is_active?: boolean;
  is_verified?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
};

export type TourismAdvisoryAdmin = {
  public_id: string;
  admin_area_id: string;
  admin_area_name: string;
  place_public_id: string | null;
  place_name: string | null;
  activity_public_id: string | null;
  activity_name: string | null;
  event_public_id: string | null;
  event_name: string | null;
  advisory_type: string;
  title: string;
  description: string;
  severity: string;
  effective_from: string | null;
  effective_until: string | null;
  is_active: boolean;
  is_verified: boolean;
  source_url: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TourismAdvisoryListFilters = {
  admin_area_id?: string;
  place_public_id?: string;
  activity_public_id?: string;
  event_public_id?: string;
  advisory_type?: string;
  severity?: string;
  is_active?: boolean;
  is_verified?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
};
