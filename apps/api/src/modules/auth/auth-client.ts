/**
 * Shared auth client labels for CoreMap sessions.
 *
 * One CoreMap user/identity model is shared by all clients.
 * `AuthClientType` is session metadata only — never authorization.
 * Dashboard access still requires CoreMap roles (viewer/admin/super_admin).
 *
 * Future native (android/ios) will issue the same auth_sessions rows and use
 * secure-storage refresh credentials instead of HttpOnly cookies. Do not
 * implement native OAuth here until package/bundle IDs are final.
 */
export const AUTH_CLIENT_TYPES = ["web", "dashboard", "android", "ios"] as const;

export type AuthClientType = (typeof AUTH_CLIENT_TYPES)[number];

/** OAuth browser clients that exist today (subset of AuthClientType). */
export type OAuthBrowserClient = Extract<AuthClientType, "web" | "dashboard">;

export function isAuthClientType(value: unknown): value is AuthClientType {
    return typeof value === "string" && (AUTH_CLIENT_TYPES as readonly string[]).includes(value);
}

export function isOAuthBrowserClient(value: unknown): value is OAuthBrowserClient {
    return value === "web" || value === "dashboard";
}

/**
 * Resolve login session client from trusted route context (Origin allowlist),
 * never from a user-supplied body field.
 */
export function resolveBrowserLoginClientType(isDashboardOrigin: boolean): OAuthBrowserClient {
    return isDashboardOrigin ? "dashboard" : "web";
}

/**
 * Allowlist OAuth return destinations against WEB_APP_URL / DASHBOARD_APP_URL only.
 * Never trust arbitrary redirect URLs from query params.
 */
export function sanitizeReturnTo(
    returnTo: string | null | undefined,
    client: OAuthBrowserClient,
    allowedOrigins: { webAppUrl?: string | null; dashboardAppUrl?: string | null }
): string | null {
    if (!returnTo) return null;
    try {
        const parsed = new URL(returnTo);
        const allowed = [allowedOrigins.webAppUrl, allowedOrigins.dashboardAppUrl].filter(
            (value): value is string => Boolean(value)
        );
        if (!allowed.some((origin) => parsed.origin === new URL(origin).origin)) {
            return null;
        }
        if (client === "dashboard" && allowedOrigins.dashboardAppUrl) {
            const dashboard = new URL(allowedOrigins.dashboardAppUrl);
            if (parsed.origin !== dashboard.origin) return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
}
