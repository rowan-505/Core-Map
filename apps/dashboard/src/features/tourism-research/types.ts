export const TOURISM_RESEARCH_ENTITY_TYPES = [
  "attraction",
  "activity",
  "event",
  "food",
  "food_place",
  "local_guide",
  "advisory",
  "other",
] as const;

export const TOURISM_RESEARCH_STATUSES = [
  "new",
  "reviewing",
  "added",
  "rejected",
  "needs_research",
] as const;

export type TourismResearchCandidate = {
  public_id: string;
  admin_area_id: string;
  admin_area_name: string;
  entity_type: string;
  name: string;
  research_status: string;
  evidence_confidence: number | null;
  research_provider: string;
  research_run_id: string | null;
  candidate_key: string | null;
  researched_at: string;
  reviewed_by_public_id: string | null;
  reviewed_at: string | null;
  created_entity_type: string | null;
  created_entity_public_id: string | null;
  source_count: number;
  latest_source_date: string | null;
  created_at: string;
  updated_at: string;
};

export type TourismResearchCandidateDetail = TourismResearchCandidate & {
  normalized_payload: Record<string, unknown>;
  evidence: {
    description: string | null;
    short_description: string | null;
    reference_scores: Record<string, number> | null;
    editorial_recommendation: number | null;
    sources: Array<Record<string, unknown>>;
    uncertainties: string[];
    conflicts: string[];
    aliases: string[];
    notes: string | null;
  };
};

export type TourismResearchPrefillResponse = {
  candidate: TourismResearchCandidateDetail;
  prefill: Record<string, unknown>;
  target_form: string;
};

export type TourismResearchListFilters = {
  admin_area_id?: string;
  entity_type?: string;
  research_status?: string;
  evidence_confidence_min?: number;
  evidence_confidence_max?: number;
  q?: string;
  limit?: number;
  offset?: number;
};

export function researchStatusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

export function entityTypeLabel(entityType: string): string {
  if (entityType === "local_guide") return "Local guide";
  if (entityType === "food_place") return "Food place";
  return entityType.replaceAll("_", " ");
}
