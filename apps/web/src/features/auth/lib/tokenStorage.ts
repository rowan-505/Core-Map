/**
 * Access-token storage for the public web app.
 *
 * Refresh tokens live in an HttpOnly cookie on the API origin. The short-lived
 * access token stays in memory only. A leftover localStorage refresh token from
 * the old MVP is cleared on load.
 */

const ACCESS_TOKEN_KEY = 'accessToken';
const LEGACY_REFRESH_TOKEN_KEY = 'refreshToken';

let memoryAccessToken: string | null = null;

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

function clearLegacyStorage(): void {
  if (!hasWindow() || typeof window.localStorage === 'undefined') return;
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);
}

export function getAccessToken(): string | null {
  return memoryAccessToken;
}

export function setAccessToken(accessToken: string): void {
  memoryAccessToken = accessToken;
  clearLegacyStorage();
}

export function clearTokens(): void {
  memoryAccessToken = null;
  clearLegacyStorage();
}

export function hasStoredSession(): boolean {
  return memoryAccessToken !== null;
}

/** @deprecated Refresh tokens are cookie-only for browsers. */
export function getRefreshToken(): string | null {
  return null;
}

export function setTokens(tokens: { accessToken: string; refreshToken?: string }): void {
  setAccessToken(tokens.accessToken);
  void tokens.refreshToken;
}
