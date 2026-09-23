import { tourismPath, coreReviewPath } from "@/src/lib/dashboardPaths";

/** New production form URL with research prefill query param. */
export function tourismNewFormFromResearch(
  entityType: string,
  researchPublicId: string,
): string | null {
  const q = new URLSearchParams({ from_research: researchPublicId });
  switch (entityType) {
    case "food":
      return `${tourismPath("foods/new")}?${q.toString()}`;
    case "local_guide":
      return `${tourismPath("guides/new")}?${q.toString()}`;
    case "advisory":
      return `${tourismPath("advisories/new")}?${q.toString()}`;
    case "activity":
      return `${tourismPath("activities/new")}?${q.toString()}`;
    case "event":
      return `${tourismPath("events/new")}?${q.toString()}`;
    case "attraction":
      return `${tourismPath("places/new")}?${q.toString()}`;
    case "food_place":
      return `${coreReviewPath("places/new")}?${q.toString()}`;
    default:
      return null;
  }
}

/** created_entity_type for POST /added after a successful save. */
export function researchCreatedEntityType(entityType: string): string | null {
  if (
    entityType === "food" ||
    entityType === "local_guide" ||
    entityType === "advisory" ||
    entityType === "activity" ||
    entityType === "event" ||
    entityType === "attraction" ||
    entityType === "food_place" ||
    entityType === "other"
  ) {
    return entityType;
  }
  return null;
}
