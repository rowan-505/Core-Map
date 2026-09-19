import { apiFetch } from "@/src/lib/api";

import type {
  CommunityAdminCounts,
  CommunityAdminPostDetail,
  CommunityListFilters,
  CommunityModerationAction,
  CommunityPostPage,
} from "./types";

type Signal = Pick<RequestInit, "signal">;

function listPath(filters: CommunityListFilters): string {
  const params = new URLSearchParams();
  if (typeof filters.limit === "number") params.set("limit", String(filters.limit));
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.category) params.set("category", filters.category);
  if (filters.search) params.set("search", filters.search);

  switch (filters.view) {
    case "needs_review":
      params.set("publicationStatus", "published");
      params.set("verificationStatus", "unverified");
      params.set("sort", "published_at_asc");
      break;
    case "live":
      params.set("publicationStatus", "published");
      if (filters.liveVerification && filters.liveVerification !== "all") {
        params.set("verificationStatus", filters.liveVerification);
      }
      params.set("sort", "published_at_desc");
      break;
    case "trusted":
      params.set("publicationStatus", "published");
      params.set("trustedOnly", "true");
      params.set("sort", "published_at_desc");
      break;
    case "closed":
      if (filters.closedStatus && filters.closedStatus !== "all") {
        params.set("publicationStatus", filters.closedStatus);
      } else {
        params.set("closedOnly", "true");
      }
      params.set("sort", "published_at_desc");
      break;
  }

  const qs = params.toString();
  return `/admin/community/posts${qs ? `?${qs}` : ""}`;
}

export function listCommunityModerationPosts(
  filters: CommunityListFilters,
  init?: Signal,
) {
  return apiFetch<CommunityPostPage>(listPath(filters), {
    method: "GET",
    ...init,
  });
}

export function getCommunityModerationCounts(init?: Signal) {
  return apiFetch<CommunityAdminCounts>("/admin/community/posts/counts", {
    method: "GET",
    ...init,
  });
}

export function getCommunityModerationPost(publicId: string, init?: Signal) {
  return apiFetch<CommunityAdminPostDetail>(
    `/admin/community/posts/${encodeURIComponent(publicId)}`,
    { method: "GET", ...init },
  );
}

export function moderateCommunityPost(
  publicId: string,
  action: CommunityModerationAction,
  note?: string,
) {
  return apiFetch<CommunityAdminPostDetail>(
    `/admin/community/posts/${encodeURIComponent(publicId)}/${encodeURIComponent(action)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(note ? { note } : {}),
    },
  );
}
