import type { TourismModerationAction, TourismReviewStatus } from "./types";

/**
 * Valid admin actions for the current review status.
 * Mirrors API `resolveTourismAdminTransition` (deleted cannot be restored).
 */
export function availableTourismActions(input: {
  readonly status: TourismReviewStatus;
}): readonly TourismModerationAction[] {
  const { status } = input;

  if (status === "deleted") {
    return [];
  }

  if (status === "hidden") {
    return ["publish", "reject", "restore"];
  }

  if (status === "pending") {
    return ["publish", "reject", "hide"];
  }

  if (status === "published") {
    return ["reject", "hide"];
  }

  if (status === "rejected") {
    return ["publish", "hide"];
  }

  return [];
}

export function primaryTourismAction(
  actions: readonly TourismModerationAction[],
): TourismModerationAction | null {
  if (actions.includes("publish")) return "publish";
  if (actions.includes("restore")) return "restore";
  return actions[0] ?? null;
}

export function secondaryTourismActions(
  actions: readonly TourismModerationAction[],
): readonly TourismModerationAction[] {
  const primary = primaryTourismAction(actions);
  if (!primary) return [];
  return actions.filter((action) => action !== primary);
}

/** Deleted reviews stay excluded — never offer silent restore. */
export function canRestoreTourismReview(status: TourismReviewStatus): boolean {
  return status === "hidden";
}
