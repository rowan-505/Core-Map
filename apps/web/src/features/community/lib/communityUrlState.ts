/**
 * Shareable URL helpers for the selected Community post.
 * Uses `?community=<uuid>` without clearing other unrelated query params.
 */

const COMMUNITY_PARAM = 'community';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCommunityPostPublicId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Read a valid community post public id from the current URL search string. */
export function readCommunityPostIdFromSearch(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get(COMMUNITY_PARAM);
  if (!raw) return null;
  const trimmed = raw.trim();
  return isCommunityPostPublicId(trimmed) ? trimmed : null;
}

/**
 * Build a new search string with community id set or cleared.
 * Returns '' when no params remain (caller can omit `?`).
 */
export function writeCommunityPostIdToSearch(
  search: string,
  publicId: string | null,
): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (publicId && isCommunityPostPublicId(publicId)) {
    params.set(COMMUNITY_PARAM, publicId);
  } else {
    params.delete(COMMUNITY_PARAM);
  }
  return params.toString();
}

/** Replace the current history entry with an updated community query param. */
export function syncCommunityPostIdInUrl(publicId: string | null): void {
  if (typeof window === 'undefined') return;
  const next = writeCommunityPostIdToSearch(window.location.search, publicId);
  const path = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`;
  window.history.replaceState(window.history.state, '', path);
}
