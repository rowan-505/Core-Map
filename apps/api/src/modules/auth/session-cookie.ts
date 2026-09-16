import type { FastifyReply, FastifyRequest } from "fastify";

import { getApiEnv } from "../../config/env.js";

const DEV_COOKIE = "cm_rt";
const PROD_COOKIE = "__Host-cm_rt";
const MFA_COOKIE_DEV = "cm_mfa";
const MFA_COOKIE_PROD = "__Host-cm_mfa";
const OAUTH_COOKIE_DEV = "cm_oauth";
const OAUTH_COOKIE_PROD = "__Host-cm_oauth";

function isProduction(): boolean {
    return process.env.NODE_ENV === "production";
}

export function refreshCookieName(): string {
    return isProduction() ? PROD_COOKIE : DEV_COOKIE;
}

export function mfaCookieName(): string {
    return isProduction() ? MFA_COOKIE_PROD : MFA_COOKIE_DEV;
}

export function oauthStateCookieName(): string {
    return isProduction() ? OAUTH_COOKIE_PROD : OAUTH_COOKIE_DEV;
}

function cookieOptions(maxAgeSeconds: number) {
    return {
        path: "/",
        httpOnly: true,
        sameSite: "lax" as const,
        secure: isProduction(),
        signed: false,
        maxAge: maxAgeSeconds,
    };
}

export function setRefreshCookie(reply: FastifyReply, token: string, maxAgeSeconds: number): void {
    void reply.setCookie(refreshCookieName(), token, cookieOptions(maxAgeSeconds));
}

export function clearRefreshCookie(reply: FastifyReply): void {
    void reply.clearCookie(refreshCookieName(), { path: "/" });
}

export function readRefreshCookie(request: FastifyRequest): string | null {
    const value = request.cookies?.[refreshCookieName()];
    return value && value.length > 0 ? value : null;
}

export function setOauthStateCookie(reply: FastifyReply, state: string): void {
    void reply.setCookie(oauthStateCookieName(), state, cookieOptions(600));
}

export function readOauthStateCookie(request: FastifyRequest): string | null {
    const value = request.cookies?.[oauthStateCookieName()];
    return value && value.length > 0 ? value : null;
}

export function clearOauthStateCookie(reply: FastifyReply): void {
    void reply.clearCookie(oauthStateCookieName(), { path: "/" });
}

export function isBrowserCredentialedRequest(request: FastifyRequest): boolean {
    const origin = request.headers.origin;
    if (!origin || typeof origin !== "string") {
        return false;
    }
    try {
        return browserOriginAllowlist().includes(new URL(origin).origin);
    } catch {
        return false;
    }
}

export function browserOriginAllowlist(): string[] {
    const env = getApiEnv();
    const origins = new Set<string>();
    if (env.auth.webAppUrl) origins.add(env.auth.webAppUrl.replace(/\/+$/, ""));
    if (env.auth.dashboardAppUrl) origins.add(env.auth.dashboardAppUrl.replace(/\/+$/, ""));
    const configured = process.env.CORS_ORIGIN?.split(",") ?? [];
    for (const origin of configured) {
        const trimmed = origin.trim().replace(/\/+$/, "");
        if (trimmed) origins.add(trimmed);
    }
    if (process.env.NODE_ENV !== "production") {
        origins.add("http://localhost:5173");
        origins.add("http://localhost:3000");
    }
    return [...origins];
}

/**
 * Fail-closed Origin check for browser cookie mutations (refresh/logout with cookie).
 * Missing, malformed, or untrusted Origin → 403.
 */
export function assertCsrfOrigin(request: FastifyRequest): void {
    const origin = request.headers.origin;
    if (!origin || typeof origin !== "string") {
        const error = new Error("Missing request origin") as Error & { statusCode: number; code: string };
        error.statusCode = 403;
        error.code = "csrf_origin";
        throw error;
    }
    let normalized: string;
    try {
        normalized = new URL(origin).origin;
    } catch {
        const error = new Error("Invalid request origin") as Error & { statusCode: number; code: string };
        error.statusCode = 403;
        error.code = "csrf_origin";
        throw error;
    }
    if (!browserOriginAllowlist().includes(normalized)) {
        const error = new Error("Invalid request origin") as Error & { statusCode: number; code: string };
        error.statusCode = 403;
        error.code = "csrf_origin";
        throw error;
    }
}

/**
 * Login CSRF: when Origin is present it must be allowlisted (reject evil browsers).
 * Missing Origin is allowed for native clients that do not send Origin.
 */
export function assertLoginCsrfOrigin(request: FastifyRequest): void {
    if (!request.headers.origin) {
        return;
    }
    assertCsrfOrigin(request);
}

/**
 * Refresh/logout CSRF: cookie-authenticated browser flows require allowlisted Origin.
 * Native body-token clients (no refresh cookie) skip Origin when it is absent.
 */
export function assertCookieMutationCsrf(request: FastifyRequest): void {
    if (readRefreshCookie(request)) {
        assertCsrfOrigin(request);
        return;
    }
    if (request.headers.origin) {
        assertCsrfOrigin(request);
    }
}

export function REFRESH_COOKIE_MAX_AGE_SECONDS(): number {
    return 30 * 24 * 60 * 60;
}
