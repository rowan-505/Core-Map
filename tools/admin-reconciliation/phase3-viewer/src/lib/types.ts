export type DecisionCode =
  | "match_existing"
  | "selective_merge"
  | "selective_merge_union" // legacy alias → treated as selective_merge + geom union
  | "create_new"
  | "keep_both"
  | "merge_confirmed_duplicate"
  | "reject_source_error"
  | "defer"
  | "";

export type NameSource = "coremap" | "mimu" | "";
export type GeometryPolicy = "coremap" | "mimu" | "union" | "";

export type QueueTab = "local" | "village" | "merge";

export type DecisionRow = {
  review_id: string;
  source_key: string;
  review_decision: DecisionCode;
  selected_core_id: string;
  losing_core_ids: string;
  name_source: NameSource;
  geometry_policy: GeometryPolicy;
  review_note: string;
  updated_at: string;
};

export type Candidate = {
  id: string;
  index: number;
  name: string;
  nameMm: string;
  nameEn: string;
  parent: string;
  type: string;
  overlapPercent: number | null;
  distanceM: number | null;
  verification: string;
  dependencySummary: string;
};

export type ReviewItem = {
  reviewId: string;
  queue: QueueTab;
  entityType: string;
  nameMm: string;
  nameEn: string;
  parent: string;
  township: string;
  previewPath: string;
  candidates: Candidate[];
  nameEvidence: string;
  recommendedAction: string;
  reviewReason: string;
  survivorId: string;
  loserIds: string[];
  repointPlan: string;
  preserveSurvivorGeometry: string;
  hardDelete: string;
  raw: Record<string, string>;
};

function splitSemi(value: string): string[] {
  return (value || "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
}

function splitPipe(value: string): string[] {
  return (value || "")
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseNumList(value: string): Array<number | null> {
  if (!value) return [];
  return value.split(";").map((part) => {
    const n = Number(part.trim());
    return Number.isFinite(n) ? n : null;
  });
}

function townshipFromParent(parent: string): string {
  const parts = parent.split(">").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[2];
  if (parts.length >= 2) return parts[1];
  return parts[0] || "";
}

function parseCandidateNames(raw: string): Array<{ display: string; mm: string; en: string }> {
  return splitPipe(raw).map((chunk) => {
    const m = chunk.match(/^(.*?)\s*\[(.*?)\s*\/\s*(.*)\]\s*$/);
    if (m) {
      return { display: chunk, en: m[2].trim(), mm: m[3].trim() };
    }
    return { display: chunk, en: "", mm: chunk };
  });
}

function parseDeps(raw: string): Map<string, { verification: string; summary: string }> {
  const map = new Map<string, { verification: string; summary: string }>();
  for (const part of (raw || "").split("||").map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+):\{(.*)\}$/);
    if (!m) continue;
    const summary = m[2];
    const ver = summary.match(/verification=([^|]+)/)?.[1] || "";
    map.set(m[1], { verification: ver, summary });
  }
  return map;
}

export function parseLocalOrVillageRow(row: Record<string, string>, queue: "local" | "village"): ReviewItem {
  const ids = splitSemi(row.candidate_core_ids);
  const names = parseCandidateNames(row.candidate_names);
  const parents = splitPipe(row.candidate_parents);
  const types = splitPipe(row.candidate_types);
  const overlaps = parseNumList(row.overlap_percent);
  const distances = parseNumList(row.distance_m);
  const deps = parseDeps(row.dependency_counts);

  const candidates: Candidate[] = ids.map((id, i) => {
    const nameInfo = names[i] || { display: id, mm: "", en: "" };
    const dep = deps.get(id);
    return {
      id,
      index: i + 1,
      name: nameInfo.display,
      nameMm: nameInfo.mm,
      nameEn: nameInfo.en,
      parent: parents[i] || "",
      type: types[i] || "",
      overlapPercent: overlaps[i] ?? null,
      distanceM: distances[i] ?? null,
      verification: dep?.verification || "",
      dependencySummary: dep?.summary || "",
    };
  });

  return {
    reviewId: row.source_key,
    queue,
    entityType: row.entity_type || "",
    nameMm: row.source_name_mm || "",
    nameEn: row.source_name_en || "",
    parent: row.source_parent || "",
    township: townshipFromParent(row.source_parent || ""),
    previewPath: row.source_geometry_preview_path || "",
    candidates,
    nameEvidence: row.name_evidence || "",
    recommendedAction: row.recommended_action || "",
    reviewReason: row.review_note || row.recommended_action || "",
    survivorId: "",
    loserIds: [],
    repointPlan: "",
    preserveSurvivorGeometry: "true",
    hardDelete: "false",
    raw: row,
  };
}

export function parseMergeRow(row: Record<string, string>): ReviewItem {
  const survivor = row.survivor_core_id || "";
  const losers = splitSemi(row.duplicate_core_ids);
  const ids = [survivor, ...losers].filter(Boolean);
  // Prefer real CoreMap names from API enrichment (candidate_names); role is shown separately in UI.
  const names = parseCandidateNames(row.candidate_names || "");
  const types = splitPipe(row.candidate_types || "");
  const candidates: Candidate[] = ids.map((id, i) => {
    const nameInfo = names[i] || { display: "", mm: "", en: "" };
    const hasRealName = Boolean(nameInfo.mm || nameInfo.en || (nameInfo.display && nameInfo.display !== id));
    return {
      id,
      index: i + 1,
      name: hasRealName
        ? nameInfo.display || nameInfo.mm || nameInfo.en
        : id === survivor
          ? `Survivor ${id}`
          : `Duplicate ${id}`,
      nameMm: nameInfo.mm || (hasRealName ? nameInfo.display : ""),
      nameEn: nameInfo.en || "",
      parent: "",
      type: types[i] || row.entity_type || "",
      overlapPercent: null,
      distanceM: null,
      verification: "",
      dependencySummary:
        id === survivor
          ? row.dependency_counts_survivor || ""
          : row.dependency_counts_duplicates || "",
    };
  });

  return {
    reviewId: row.source_key,
    queue: "merge",
    entityType: row.entity_type || "",
    nameMm: "",
    nameEn: row.source_key,
    parent: "",
    township: "",
    previewPath: "",
    candidates,
    nameEvidence: "",
    recommendedAction: row.recommended_decision || "merge_confirmed_duplicate",
    reviewReason: row.repoint_plan || "",
    survivorId: survivor,
    loserIds: losers,
    repointPlan: row.repoint_plan || "",
    preserveSurvivorGeometry: row.preserve_survivor_geometry || "true",
    hardDelete: row.hard_delete || "false",
    raw: row,
  };
}

export function decisionStatus(
  decision: DecisionRow | undefined,
): "undecided" | "decided" | "deferred" {
  if (!decision?.review_decision) return "undecided";
  if (decision.review_decision === "defer") return "deferred";
  return "decided";
}

/** Name-evidence token used as confidence filter (queues have no numeric confidence column). */
export function confidenceLabel(item: ReviewItem): string {
  const ev = (item.nameEvidence || "").trim();
  if (!ev) return "unknown";
  const first = ev.split(/[;|,]/)[0]?.trim() || ev;
  return first || "unknown";
}

export function isDecisionPayloadValid(
  decision: DecisionRow | undefined,
  item: ReviewItem,
): boolean {
  if (!decision?.review_decision) return true;
  const code = decision.review_decision;
  if (code === "match_existing" || code === "selective_merge" || code === "selective_merge_union") {
    if (!decision.selected_core_id) return false;
    if (!item.candidates.some((c) => c.id === decision.selected_core_id)) return false;
  }
  if (code === "selective_merge" || code === "selective_merge_union") {
    if (!decision.name_source || !decision.geometry_policy) return false;
  }
  if (code === "merge_confirmed_duplicate") {
    if (!decision.selected_core_id || !decision.losing_core_ids) return false;
  }
  if (code === "create_new" || code === "reject_source_error") {
    if (decision.selected_core_id) return false;
  }
  return true;
}
