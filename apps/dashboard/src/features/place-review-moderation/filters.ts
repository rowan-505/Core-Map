import type {
  PlaceReviewListFilters,
  PlaceReviewStatus,
} from "./types";
import { PLACE_REVIEW_STATUSES } from "./constants";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function parseTourismStatusFilter(
  value: string | null,
): PlaceReviewStatus | "all" {
  if (!value || value === "all") return "all";
  if ((PLACE_REVIEW_STATUSES as readonly string[]).includes(value)) {
    return value as PlaceReviewStatus;
  }
  return "all";
}

/**
 * Build admin reviews list path.
 * Free-text `q` maps to placeId when it looks like a UUID; otherwise ignored
 * (API has no full-text search on admin reviews).
 */
export function buildAdminPlaceReviewsPath(filters: PlaceReviewListFilters): string {
  const params = new URLSearchParams();
  if (typeof filters.limit === "number") params.set("limit", String(filters.limit));
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.status && filters.status !== "all") params.set("status", filters.status);

  const placeId = filters.placeId?.trim() || undefined;
  const q = filters.q?.trim() || undefined;
  if (placeId && isUuid(placeId)) {
    params.set("placeId", placeId);
  } else if (q && isUuid(q)) {
    params.set("placeId", q);
  }

  if (filters.authorId && isUuid(filters.authorId)) {
    params.set("authorId", filters.authorId.trim());
  }

  const qs = params.toString();
  return `/admin/reviews${qs ? `?${qs}` : ""}`;
}

export function isPermissionDeniedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("403") ||
    message.includes("forbidden") ||
    message.includes("permission") ||
    message.includes("not allowed")
  );
}

export function permissionDeniedMessage(error: unknown): string {
  if (isPermissionDeniedError(error)) {
    return "You do not have permission to perform this action.";
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Request failed";
}

/** Cursor stack helpers for list pagination tests. */
export function pushCursorPage(
  stack: readonly (string | null)[],
  nextCursor: string | null,
): (string | null)[] {
  if (!nextCursor) return [...stack];
  return [...stack, nextCursor];
}

export function popCursorPage(
  stack: readonly (string | null)[],
): (string | null)[] {
  if (stack.length <= 1) return [null];
  return stack.slice(0, -1);
}
