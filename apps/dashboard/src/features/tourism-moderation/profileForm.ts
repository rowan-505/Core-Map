import {
  TOURISM_EDITORIAL_SCORES,
  TOURISM_TYPE_CODES,
  type TourismEditorialScore,
  type TourismProfilePatchBody,
  type TourismProfileUpsertBody,
  type TourismSeasonMode,
  type TourismTypeCode,
} from "./types";

/** UI visitor-cost codes mapped to tourism.place_profiles.price_level. */
export const VISITOR_COST_OPTIONS = [
  { code: "unknown", label: "Unknown", priceLevel: null },
  { code: "free", label: "Free", priceLevel: 0 },
  { code: "1", label: "$", priceLevel: 1 },
  { code: "2", label: "$$", priceLevel: 2 },
  { code: "3", label: "$$$", priceLevel: 3 },
  { code: "4", label: "$$$$", priceLevel: 4 },
] as const;

export type VisitorCostCode = (typeof VISITOR_COST_OPTIONS)[number]["code"];

export function visitorCostCodeFromPriceLevel(
  priceLevel: number | null | undefined,
): VisitorCostCode {
  if (priceLevel === null || priceLevel === undefined) return "unknown";
  if (priceLevel === 0) return "free";
  if (priceLevel === 1) return "1";
  if (priceLevel === 2) return "2";
  if (priceLevel === 3) return "3";
  if (priceLevel === 4) return "4";
  return "unknown";
}

export function priceLevelFromVisitorCostCode(
  code: string,
): { ok: true; priceLevel: number | null } | { ok: false; error: string } {
  const match = VISITOR_COST_OPTIONS.find((option) => option.code === code);
  if (!match) {
    return { ok: false, error: "Select a valid visitor cost." };
  }
  return { ok: true, priceLevel: match.priceLevel };
}

export function editorialLevelLabel(score: string | number): string {
  const value = String(score);
  switch (value) {
    case "20":
      return "Very weak";
    case "35":
      return "Minor";
    case "50":
      return "Normal";
    case "65":
      return "Good";
    case "80":
      return "Major";
    case "95":
      return "Must-see";
    default:
      return value;
  }
}

export type TourismProfileFormValues = {
  readonly tourism_type: string;
  readonly short_description: string;
  /** Visitor cost UI code: unknown | free | 1 | 2 | 3 | 4 */
  readonly price_level: string;
  readonly editor_pick: boolean;
  readonly is_public: boolean;
  readonly editorial_score: string;
  readonly manual_boost: string;
  readonly season_mode: TourismSeasonMode;
  readonly season_start_month: string;
  readonly season_end_month: string;
};

export function defaultTourismProfileForm(
  partial?: Partial<TourismProfileFormValues>,
): TourismProfileFormValues {
  return {
    tourism_type: partial?.tourism_type ?? "",
    short_description: partial?.short_description ?? "",
    price_level: partial?.price_level ?? "unknown",
    editor_pick: partial?.editor_pick ?? false,
    is_public: partial?.is_public ?? true,
    editorial_score: partial?.editorial_score ?? "50",
    manual_boost: partial?.manual_boost ?? "0",
    season_mode: partial?.season_mode ?? "all_year",
    season_start_month: partial?.season_start_month ?? "",
    season_end_month: partial?.season_end_month ?? "",
  };
}

export type TourismProfileFormResult =
  | { readonly ok: true; readonly create: TourismProfileUpsertBody; readonly patch: TourismProfilePatchBody }
  | { readonly ok: false; readonly error: string };

export function buildTourismProfilePayload(
  values: TourismProfileFormValues,
  options: { readonly mode: "create" | "update"; readonly previous?: TourismProfileFormValues },
): TourismProfileFormResult {
  const tourismType = values.tourism_type.trim() as TourismTypeCode;
  if (!(TOURISM_TYPE_CODES as readonly string[]).includes(tourismType)) {
    return { ok: false, error: "Tourism type is required." };
  }

  const visitorCost = priceLevelFromVisitorCostCode(values.price_level.trim() || "unknown");
  if (!visitorCost.ok) {
    return visitorCost;
  }
  const priceLevel = visitorCost.priceLevel;

  const editorialScore = Number(values.editorial_score);
  if (
    !Number.isInteger(editorialScore) ||
    !(TOURISM_EDITORIAL_SCORES as readonly number[]).includes(editorialScore)
  ) {
    return { ok: false, error: "Select a valid editorial score." };
  }

  const manualBoost = Number(values.manual_boost);
  if (!Number.isInteger(manualBoost) || manualBoost < -10 || manualBoost > 10) {
    return { ok: false, error: "Manual boost must be an integer from -10 to 10." };
  }

  const usesMonths =
    values.season_mode === "best_months" || values.season_mode === "poor_months";
  const parseMonth = (raw: string): number | null => {
    if (raw.trim() === "") return null;
    const month = Number(raw);
    return Number.isInteger(month) && month >= 1 && month <= 12 ? month : Number.NaN;
  };
  const seasonStartMonth = usesMonths ? parseMonth(values.season_start_month) : null;
  const seasonEndMonth = usesMonths ? parseMonth(values.season_end_month) : null;
  if (
    Number.isNaN(seasonStartMonth) ||
    Number.isNaN(seasonEndMonth) ||
    ((seasonStartMonth === null) !== (seasonEndMonth === null))
  ) {
    return {
      ok: false,
      error: "Select both season months, or leave both months empty.",
    };
  }

  const shortDescription =
    values.short_description.trim() === "" ? null : values.short_description.trim();
  if (shortDescription && shortDescription.length > 1000) {
    return { ok: false, error: "Short description is too long." };
  }

  const create: TourismProfileUpsertBody = {
    tourism_type: tourismType,
    short_description: shortDescription,
    price_level: priceLevel,
    editor_pick: values.editor_pick,
    is_public: values.is_public,
    editorial_score: editorialScore as TourismEditorialScore,
    manual_boost: manualBoost,
    season_mode: values.season_mode,
    season_start_month: seasonStartMonth,
    season_end_month: seasonEndMonth,
  };

  if (options.mode === "create") {
    return { ok: true, create, patch: create };
  }

  const previous = options.previous ?? defaultTourismProfileForm();
  const previousPrice = priceLevelFromVisitorCostCode(previous.price_level.trim() || "unknown");
  const previousPriceLevel = previousPrice.ok ? previousPrice.priceLevel : null;

  const patch: TourismProfilePatchBody = {
    ...(tourismType !== previous.tourism_type.trim()
      ? { tourism_type: tourismType }
      : {}),
    ...((shortDescription ?? "") !== previous.short_description.trim()
      ? { short_description: shortDescription }
      : {}),
    ...(priceLevel !== previousPriceLevel ? { price_level: priceLevel } : {}),
    ...(values.editor_pick !== previous.editor_pick
      ? { editor_pick: values.editor_pick }
      : {}),
    ...(values.is_public !== previous.is_public ? { is_public: values.is_public } : {}),
    ...(values.editorial_score !== previous.editorial_score
      ? { editorial_score: editorialScore as TourismEditorialScore }
      : {}),
    ...(values.manual_boost !== previous.manual_boost
      ? { manual_boost: manualBoost }
      : {}),
    ...(values.season_mode !== previous.season_mode
      ? { season_mode: values.season_mode }
      : {}),
    ...(seasonStartMonth !== parseMonth(previous.season_start_month)
      ? { season_start_month: seasonStartMonth }
      : {}),
    ...(seasonEndMonth !== parseMonth(previous.season_end_month)
      ? { season_end_month: seasonEndMonth }
      : {}),
  };

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No changes to save." };
  }

  return { ok: true, create, patch };
}

/** Featured-by-CoreMap toggle PATCH for list pages. */
export function buildEditorPickPatch(editorPick: boolean): TourismProfilePatchBody {
  return { editor_pick: editorPick };
}
