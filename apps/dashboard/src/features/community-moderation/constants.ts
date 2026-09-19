import type {
  CommunityModerationAction,
  CommunityPublicationStatus,
  CommunityVerificationStatus,
} from "./types";

/** Canonical community category codes (same as public web create form). */
export const COMMUNITY_CATEGORIES = [
  { code: "local_update", label: "Local Update" },
  { code: "transport", label: "Transport" },
  { code: "road_and_access", label: "Road and Access" },
  { code: "public_service", label: "Public Service" },
  { code: "safety", label: "Safety" },
  { code: "event", label: "Event" },
  { code: "business", label: "Business" },
  { code: "other", label: "Other" },
] as const;

export type CommunityCategoryCode = (typeof COMMUNITY_CATEGORIES)[number]["code"];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  COMMUNITY_CATEGORIES.map((item) => [item.code, item.label]),
);

/** Actions that require a non-empty reason note. */
export const ACTIONS_REQUIRING_REASON: ReadonlySet<CommunityModerationAction> = new Set([
  "reject",
  "remove",
  "expire",
]);

/** Destructive actions that must be confirmed in a dialog. */
export const DESTRUCTIVE_ACTIONS: ReadonlySet<CommunityModerationAction> = new Set([
  "reject",
  "remove",
  "expire",
  "unverify",
]);

export function categoryLabel(code: string): string {
  return CATEGORY_LABELS[code] ?? code;
}

export function publicationLabel(status: CommunityPublicationStatus): string {
  switch (status) {
    case "published":
      return "Published";
    case "resolved":
      return "Resolved";
    case "expired":
      return "Expired";
    case "rejected":
      return "Rejected";
    case "removed":
      return "Removed";
  }
}

export function verificationLabel(status: CommunityVerificationStatus): string {
  switch (status) {
    case "unverified":
      return "Unverified";
    case "community_confirmed":
      return "Community Confirmed";
    case "admin_verified":
      return "CoreMap Verified";
  }
}

export function publicationBadgeClass(status: CommunityPublicationStatus): string {
  switch (status) {
    case "published":
      return "bg-emerald-50 text-emerald-800 ring-emerald-200";
    case "resolved":
      return "bg-sky-50 text-sky-800 ring-sky-200";
    case "expired":
      return "bg-neutral-100 text-neutral-700 ring-neutral-200";
    case "rejected":
      return "bg-red-50 text-red-800 ring-red-200";
    case "removed":
      return "bg-neutral-200 text-neutral-800 ring-neutral-300";
  }
}

export function verificationBadgeClass(status: CommunityVerificationStatus): string {
  switch (status) {
    case "admin_verified":
      return "bg-teal-50 text-teal-800 ring-teal-200";
    case "community_confirmed":
      return "bg-blue-50 text-blue-800 ring-blue-200";
    case "unverified":
      return "bg-amber-50 text-amber-800 ring-amber-200";
  }
}

export function moderationActionLabel(action: CommunityModerationAction): string {
  switch (action) {
    case "verify":
      return "Verify";
    case "unverify":
      return "Unverify";
    case "reject":
      return "Reject";
    case "resolve":
      return "Resolve";
    case "expire":
      return "Expire";
    case "remove":
      return "Remove";
    case "reopen":
      return "Reopen";
  }
}

export function formatDateTime(iso: string): string {
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

export function totalReactionCount(counts: {
  readonly confirm: number;
  readonly helpful: number;
  readonly incorrect: number;
}): number {
  return counts.confirm + counts.helpful + counts.incorrect;
}

export function moderationHistoryLabel(actionCode: string): string {
  switch (actionCode) {
    case "verify":
      return "CoreMap Verified";
    case "unverify":
      return "CoreMap Verified removed";
    case "reject":
      return "Rejected";
    case "resolve":
      return "Resolved";
    case "expire":
      return "Expired";
    case "remove":
      return "Removed";
    case "restore":
      return "Reopened";
    case "community_auto_confirm":
      return "Community Confirmed (auto)";
    case "community_auto_unconfirm":
      return "Community Confirmed removed (auto)";
    case "publish":
      return "Published";
    case "migrate_baseline":
      return "Baseline";
    default:
      return actionCode;
  }
}
