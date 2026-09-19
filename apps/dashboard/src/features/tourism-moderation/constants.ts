import type {
  TourismModerationAction,
  TourismReviewStatus,
} from "./types";

export const TOURISM_REVIEW_STATUSES = [
  "pending",
  "published",
  "rejected",
  "hidden",
  "deleted",
] as const satisfies readonly TourismReviewStatus[];

/** Queue tabs — deleted is filterable for audit but excluded from restore. */
export const TOURISM_STATUS_FILTERS = [
  { id: "all" as const, label: "All" },
  { id: "pending" as const, label: "Pending" },
  { id: "published" as const, label: "Published" },
  { id: "rejected" as const, label: "Rejected" },
  { id: "hidden" as const, label: "Hidden" },
  { id: "deleted" as const, label: "Deleted" },
];

export const TOURISM_PLACE_MODES = [
  { id: "recommended", label: "Recommended" },
  { id: "top_rated", label: "Top rated" },
  { id: "most_reviewed", label: "Most reviewed" },
  { id: "editor_picks", label: "Editor picks" },
] as const;

export const DESTRUCTIVE_TOURISM_ACTIONS: ReadonlySet<TourismModerationAction> = new Set([
  "reject",
  "hide",
]);

export const ACTIONS_REQUIRING_NOTE: ReadonlySet<TourismModerationAction> = new Set([
  "reject",
]);

export function tourismStatusLabel(status: TourismReviewStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "published":
      return "Published";
    case "rejected":
      return "Rejected";
    case "hidden":
      return "Hidden";
    case "deleted":
      return "Deleted";
    default:
      return status;
  }
}

export function tourismStatusBadgeClass(status: TourismReviewStatus): string {
  switch (status) {
    case "pending":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    case "published":
      return "bg-emerald-50 text-emerald-800 ring-emerald-200";
    case "rejected":
      return "bg-red-50 text-red-800 ring-red-200";
    case "hidden":
      return "bg-slate-100 text-slate-700 ring-slate-200";
    case "deleted":
      return "bg-gray-100 text-gray-500 ring-gray-200";
    default:
      return "bg-gray-50 text-gray-700 ring-gray-200";
  }
}

export function tourismModerationActionLabel(action: TourismModerationAction): string {
  switch (action) {
    case "publish":
      return "Publish";
    case "reject":
      return "Reject";
    case "hide":
      return "Hide";
    case "restore":
      return "Restore";
    default:
      return action;
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatLocation(
  lat: number | null | undefined,
  lng: number | null | undefined,
): string {
  if (typeof lat !== "number" || typeof lng !== "number") return "—";
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "—";
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function previewText(value: string | null | undefined, max = 120): string {
  if (!value) return "—";
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function tourismHistoryLabel(
  fromStatus: string,
  toStatus: string,
): string {
  return `${tourismStatusLabel(fromStatus as TourismReviewStatus)} → ${tourismStatusLabel(toStatus as TourismReviewStatus)}`;
}
