/**
 * Access-token storage for the dashboard.
 *
 * Refresh tokens live in an HttpOnly Secure cookie on the API origin.
 * The short-lived access JWT stays in JavaScript memory only — never
 * localStorage or sessionStorage.
 */

const LEGACY_ACCESS_TOKEN_KEY = "accessToken";
const LEGACY_REFRESH_TOKEN_KEY = "refreshToken";
const LEGACY_ALIASES = ["token", "authToken", "jwt"] as const;

let memoryAccessToken: string | null = null;

function hasWindow(): boolean {
    return typeof window !== "undefined";
}

function clearLegacyStorage(): void {
    if (!hasWindow() || typeof window.localStorage === "undefined") {
        return;
    }
    window.localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
    window.localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);
    for (const key of LEGACY_ALIASES) {
        window.localStorage.removeItem(key);
    }
    if (typeof window.sessionStorage !== "undefined") {
        window.sessionStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
        window.sessionStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);
    }
}

export function getAccessToken(): string | null {
    return memoryAccessToken;
}

export function setAccessToken(accessToken: string): void {
    memoryAccessToken = accessToken;
    clearLegacyStorage();
}

export function clearAuthTokens(): void {
    memoryAccessToken = null;
    clearLegacyStorage();
}

/** Test helper — never persist to storage. */
export function __setAccessTokenForTests(accessToken: string | null): void {
    memoryAccessToken = accessToken;
}
