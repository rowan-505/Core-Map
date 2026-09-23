/**
 * Access-token storage for the dashboard.
 *
 * Refresh tokens live in an HttpOnly Secure cookie on the API origin.
 * The short-lived access JWT stays in JavaScript memory only — never
 * localStorage or sessionStorage.
 *
 * New tabs cannot see memory from the first tab. Same-origin tabs share
 * the token through BroadcastChannel so "open in new tab" does not force
 * a second login.
 */

const LEGACY_ACCESS_TOKEN_KEY = "accessToken";
const LEGACY_REFRESH_TOKEN_KEY = "refreshToken";
const LEGACY_ALIASES = ["token", "authToken", "jwt"] as const;
const AUTH_CHANNEL_NAME = "coremap-dashboard-auth";
export const DASHBOARD_AUTH_CHANGED_EVENT = "coremap-dashboard-auth-changed";

type AuthChannelMessage =
    | { type: "request" }
    | { type: "token"; accessToken: string | null };

let memoryAccessToken: string | null = null;
let authChannel: BroadcastChannel | null = null;
let channelStarted = false;

function hasWindow(): boolean {
    return typeof window !== "undefined";
}

function notifyAuthChanged(): void {
    if (!hasWindow() || typeof window.dispatchEvent !== "function") {
        return;
    }
    window.dispatchEvent(new Event(DASHBOARD_AUTH_CHANGED_EVENT));
}

function postAuthMessage(message: AuthChannelMessage): void {
    ensureAuthChannel();
    try {
        authChannel?.postMessage(message);
    } catch {
        // Channel closed or unsupported.
    }
}

function applyPeerToken(accessToken: string | null): void {
    if (memoryAccessToken === accessToken) {
        return;
    }
    memoryAccessToken = accessToken;
    if (accessToken) {
        clearLegacyStorage();
    }
    notifyAuthChanged();
}

function onAuthChannelMessage(event: MessageEvent<AuthChannelMessage>): void {
    const data = event.data;
    if (!data || typeof data !== "object") {
        return;
    }
    if (data.type === "request") {
        postAuthMessage({ type: "token", accessToken: memoryAccessToken });
        return;
    }
    if (data.type === "token") {
        applyPeerToken(typeof data.accessToken === "string" ? data.accessToken : null);
    }
}

function getBroadcastChannelCtor(): typeof BroadcastChannel | null {
    if (!hasWindow()) {
        return null;
    }
    const ctor = (window as unknown as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
    return typeof ctor === "function" ? ctor : null;
}

export function ensureAuthChannel(): void {
    if (channelStarted) {
        return;
    }
    const Ctor = getBroadcastChannelCtor();
    if (!Ctor) {
        return;
    }
    channelStarted = true;
    try {
        authChannel = new Ctor(AUTH_CHANNEL_NAME);
        authChannel.addEventListener("message", onAuthChannelMessage);
    } catch {
        authChannel = null;
        channelStarted = false;
    }
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
    ensureAuthChannel();
    return memoryAccessToken;
}

export function setAccessToken(accessToken: string): void {
    ensureAuthChannel();
    const changed = memoryAccessToken !== accessToken;
    memoryAccessToken = accessToken;
    clearLegacyStorage();
    if (changed) {
        postAuthMessage({ type: "token", accessToken });
        notifyAuthChanged();
    }
}

export function clearAuthTokens(): void {
    ensureAuthChannel();
    const changed = memoryAccessToken !== null;
    memoryAccessToken = null;
    clearLegacyStorage();
    if (changed) {
        postAuthMessage({ type: "token", accessToken: null });
        notifyAuthChanged();
    }
}

/**
 * Ask other same-origin dashboard tabs for the in-memory access token.
 * Used when a new tab has no JWT yet. Does not write web storage.
 */
export function restoreAccessTokenFromOtherTabs(timeoutMs = 250): Promise<string | null> {
    ensureAuthChannel();
    if (memoryAccessToken) {
        return Promise.resolve(memoryAccessToken);
    }
    const channel = authChannel;
    if (!channel) {
        return Promise.resolve(null);
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (token: string | null) => {
            if (settled) {
                return;
            }
            settled = true;
            globalThis.clearTimeout(timer);
            channel.removeEventListener("message", onReply);
            resolve(token);
        };

        const onReply = (event: MessageEvent<AuthChannelMessage>) => {
            const data = event.data;
            if (data?.type === "token" && typeof data.accessToken === "string" && data.accessToken) {
                applyPeerToken(data.accessToken);
                finish(data.accessToken);
            }
        };

        channel.addEventListener("message", onReply);
        postAuthMessage({ type: "request" });
        const timer = globalThis.setTimeout(() => finish(memoryAccessToken), timeoutMs);
    });
}

/** Test helper — never persist to storage. */
export function __setAccessTokenForTests(accessToken: string | null): void {
    memoryAccessToken = accessToken;
}
