import { z } from "zod";

/** Profiles allowed in ROUTING_PUBLIC_PROFILES (must stay in sync with migration 060 seeds). */
const ROUTING_PUBLIC_PROFILE_ALLOWLIST = ["walk", "car", "motorcycle"] as const;

const routingEngineSchema = z.enum(["valhalla", "otp", "external"]);

/** Local web (Vite) dev origin — used only as a non-production fallback. */
const LOCAL_WEB_APP_URL = "http://localhost:5173";
const LOCAL_API_URL = "http://localhost:3001";
const LOCAL_DASHBOARD_URL = "http://localhost:3000";
const DEFAULT_JWT_AUD = "coremap";
const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;
/** Prefer ≥32 random bytes (e.g. 64 hex chars). Reject short passphrases in production. */
const MIN_PRODUCTION_MFA_KEY_LENGTH = 32;
const EXPECTED_GOOGLE_CALLBACK_PATH = "/auth/oauth/google/callback";

function isSecureProductionOAuthRedirect(
    redirectUri: string,
    apiPublicUrl: string | null
): { ok: true } | { ok: false; reason: string } {
    let parsed: URL;
    try {
        parsed = new URL(redirectUri);
    } catch {
        return { ok: false, reason: "GOOGLE_OAUTH_REDIRECT_URI must be a valid URL." };
    }
    if (parsed.protocol !== "https:") {
        return { ok: false, reason: "GOOGLE_OAUTH_REDIRECT_URI must use https in production." };
    }
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
        return { ok: false, reason: "GOOGLE_OAUTH_REDIRECT_URI must not use localhost in production." };
    }
    if (parsed.pathname !== EXPECTED_GOOGLE_CALLBACK_PATH) {
        return {
            ok: false,
            reason: `GOOGLE_OAUTH_REDIRECT_URI path must be ${EXPECTED_GOOGLE_CALLBACK_PATH}.`,
        };
    }
    if (apiPublicUrl) {
        try {
            const apiHost = new URL(apiPublicUrl).hostname;
            if (parsed.hostname !== apiHost) {
                return {
                    ok: false,
                    reason: "GOOGLE_OAUTH_REDIRECT_URI host must match API_PUBLIC_URL.",
                };
            }
        } catch {
            // API_PUBLIC_URL validated separately.
        }
    }
    return { ok: true };
}

const envBoolean = (defaultValue: boolean) =>
    z.preprocess(
        (value) => {
            if (value === undefined || value === "") {
                return defaultValue ? "true" : "false";
            }
            return value;
        },
        z.enum(["true", "false"], {
            error: "Expected \"true\" or \"false\"",
        })
    ).transform((value) => value === "true");

const optionalTrimmedString = z.preprocess((value) => {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== "string") {
        return value;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
}, z.string().min(1).optional());

const R2_REQUIRED_KEYS = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_ENDPOINT",
    "R2_MEDIA_PRIVATE_BUCKET",
    "R2_MEDIA_PUBLIC_BUCKET",
    "R2_MEDIA_PUBLIC_BASE_URL",
] as const;

function parseCsvList(raw: string): string[] {
    return raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

const apiEnvSchema = z
    .object({
        NODE_ENV: z.string().optional(),
        // Public web app base URL used to build absolute /s/:code share links.
        // Optional in non-production (falls back to the local web dev origin);
        // required in production (enforced below — never falls back to localhost).
        PUBLIC_APP_URL: z.string().url().optional(),
        WEB_APP_URL: z.string().url().optional(),
        DASHBOARD_APP_URL: z.string().url().optional(),
        API_PUBLIC_URL: z.string().url().optional(),
        AUTH_JWT_SECRET: optionalTrimmedString,
        JWT_SECRET: optionalTrimmedString,
        AUTH_JWT_ISS: optionalTrimmedString,
        AUTH_JWT_AUD: optionalTrimmedString,
        AUTH_MFA_ENCRYPTION_KEY: optionalTrimmedString,
        GOOGLE_OAUTH_CLIENT_ID: optionalTrimmedString,
        GOOGLE_OAUTH_CLIENT_SECRET: optionalTrimmedString,
        GOOGLE_OAUTH_REDIRECT_URI: optionalTrimmedString,
        // Explicit flag. Unset defaults to false so API starts without Facebook secrets.
        // Set true only when testing/enabling Facebook OAuth.
        FACEBOOK_OAUTH_ENABLED: envBoolean(false),
        FACEBOOK_OAUTH_APP_ID: optionalTrimmedString,
        FACEBOOK_OAUTH_APP_SECRET: optionalTrimmedString,
        FACEBOOK_OAUTH_REDIRECT_URI: optionalTrimmedString,
        PORT: z.coerce.number().int().min(1).max(65535).default(3001),
        ROUTING_ENABLED: envBoolean(false),
        ROUTING_DEFAULT_ENGINE: routingEngineSchema.default("valhalla"),
        VALHALLA_BASE_URL: z.string().url().default("http://localhost:8002"),
        ROUTING_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(8000),
        ROUTING_PUBLIC_PROFILES: z.string().default("walk,car,motorcycle"),
        RESEND_API_KEY: z.string().optional(),
        EMAIL_FROM: z.string().optional(),
        EMAIL_OTP_SECRET: z.string().optional(),
        EMAIL_OTP_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
        EMAIL_OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
        // Per-IP auth rate limiting. WINDOW is the shared time window (ms) applied to
        // all auth limits; MAX is the strict cap for POST /auth/login. The other auth
        // routes use fixed sensible multiples of these (see authRateLimit below).
        AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(10),
        AUTH_RATE_LIMIT_WINDOW: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
        // R2 media. Optional as a group so unit tests and apps without media still start.
        // If any R2_* value is set, the full set is required. Secrets stay in backend env only.
        R2_ACCOUNT_ID: optionalTrimmedString,
        R2_ACCESS_KEY_ID: optionalTrimmedString,
        R2_SECRET_ACCESS_KEY: optionalTrimmedString,
        R2_ENDPOINT: optionalTrimmedString,
        R2_REGION: optionalTrimmedString,
        R2_MEDIA_PRIVATE_BUCKET: optionalTrimmedString,
        R2_MEDIA_PUBLIC_BUCKET: optionalTrimmedString,
        R2_MEDIA_PUBLIC_BASE_URL: optionalTrimmedString,
    })
    .superRefine((raw, ctx) => {
        const present = R2_REQUIRED_KEYS.filter((key) => Boolean(raw[key]));
        if (present.length === 0) {
            return;
        }
        const missing = R2_REQUIRED_KEYS.filter((key) => !raw[key]);
        if (missing.length > 0) {
            ctx.addIssue({
                code: "custom",
                message: `Incomplete R2 media configuration. Set all of ${R2_REQUIRED_KEYS.join(", ")}. Missing: ${missing.join(", ")}.`,
                path: ["R2_ACCOUNT_ID"],
            });
        }
    })
    .transform((raw) => {
        const publicProfiles = parseCsvList(raw.ROUTING_PUBLIC_PROFILES);
        const allowlist = new Set<string>(ROUTING_PUBLIC_PROFILE_ALLOWLIST);

        for (const profile of publicProfiles) {
            if (!allowlist.has(profile)) {
                throw new Error(
                    `Invalid ROUTING_PUBLIC_PROFILES entry "${profile}". ` +
                        `Allowed: ${ROUTING_PUBLIC_PROFILE_ALLOWLIST.join(", ")}.`
                );
            }
        }

        if (publicProfiles.length === 0) {
            throw new Error("ROUTING_PUBLIC_PROFILES must list at least one profile.");
        }

        const valhallaBaseUrl = raw.VALHALLA_BASE_URL.replace(/\/+$/, "");

        // Resolve the public web base URL. Explicit env always wins (trailing
        // slashes trimmed). Outside production we fall back to the local web dev
        // origin; in production we leave it null so the refine below fails fast
        // rather than ever serving a localhost URL.
        const isProduction = raw.NODE_ENV === "production";
        const explicitWebAppUrl = (raw.WEB_APP_URL ?? raw.PUBLIC_APP_URL)?.replace(/\/+$/, "");
        const publicAppUrl =
            explicitWebAppUrl && explicitWebAppUrl.length > 0
                ? explicitWebAppUrl
                : isProduction
                  ? null
                  : LOCAL_WEB_APP_URL;
        const apiPublicUrl =
            raw.API_PUBLIC_URL?.replace(/\/+$/, "") || (isProduction ? null : LOCAL_API_URL);
        const dashboardAppUrl =
            raw.DASHBOARD_APP_URL?.replace(/\/+$/, "") || (isProduction ? null : LOCAL_DASHBOARD_URL);
        const jwtSecret = raw.AUTH_JWT_SECRET ?? raw.JWT_SECRET ?? "";
        const jwtIss = raw.AUTH_JWT_ISS?.replace(/\/+$/, "") || apiPublicUrl || LOCAL_API_URL;
        const jwtAud = raw.AUTH_JWT_AUD ?? DEFAULT_JWT_AUD;

        return {
            port: raw.PORT,
            publicAppUrl,
            auth: {
                jwtSecret,
                jwtIss,
                jwtAud,
                jwtAlg: "HS256" as const,
                apiPublicUrl,
                webAppUrl: publicAppUrl,
                dashboardAppUrl,
                mfaEncryptionKey: raw.AUTH_MFA_ENCRYPTION_KEY ?? null,
                google: parseOAuthProviderEnv({
                    clientId: raw.GOOGLE_OAUTH_CLIENT_ID,
                    clientSecret: raw.GOOGLE_OAUTH_CLIENT_SECRET,
                    redirectUri: raw.GOOGLE_OAUTH_REDIRECT_URI,
                }),
                // When disabled, ignore Facebook secrets so production can omit them.
                facebookEnabled: raw.FACEBOOK_OAUTH_ENABLED,
                facebook: raw.FACEBOOK_OAUTH_ENABLED
                    ? parseOAuthProviderEnv({
                          clientId: raw.FACEBOOK_OAUTH_APP_ID,
                          clientSecret: raw.FACEBOOK_OAUTH_APP_SECRET,
                          redirectUri: raw.FACEBOOK_OAUTH_REDIRECT_URI,
                      })
                    : null,
            },
            routing: {
                enabled: raw.ROUTING_ENABLED,
                defaultEngine: raw.ROUTING_DEFAULT_ENGINE,
                valhallaBaseUrl,
                requestTimeoutMs: raw.ROUTING_REQUEST_TIMEOUT_MS,
                publicProfiles: publicProfiles as (typeof ROUTING_PUBLIC_PROFILE_ALLOWLIST)[number][],
            },
            email: {
                resendApiKey: raw.RESEND_API_KEY?.trim() || null,
                from: raw.EMAIL_FROM?.trim() || null,
                otpSecret: raw.EMAIL_OTP_SECRET?.trim() || null,
                otpTtlMinutes: raw.EMAIL_OTP_TTL_MINUTES,
                otpMaxAttempts: raw.EMAIL_OTP_MAX_ATTEMPTS,
            },
            authRateLimit: {
                windowMs: raw.AUTH_RATE_LIMIT_WINDOW,
                login: raw.AUTH_RATE_LIMIT_MAX,
                register: 5,
                sendOtp: 3,
                verifyOtp: 10,
                refresh: 30,
                forgotPassword: 5,
                resetPassword: 10,
                oauthStart: 20,
                sensitiveAccount: 10,
            },
            r2: parseR2MediaEnv(raw),
        };
    })
    .superRefine((config, ctx) => {
        if (config.publicAppUrl === null) {
            ctx.addIssue({
                code: "custom",
                message:
                    "WEB_APP_URL or PUBLIC_APP_URL is required in production (e.g. https://map.coremapmm.com). " +
                    "It has no localhost fallback outside development.",
                path: ["WEB_APP_URL"],
            });
        }

        const isProduction = process.env.NODE_ENV === "production";
        if (isProduction) {
            if (!config.auth.jwtSecret || config.auth.jwtSecret.length < MIN_PRODUCTION_JWT_SECRET_LENGTH) {
                ctx.addIssue({
                    code: "custom",
                    message: `AUTH_JWT_SECRET (or JWT_SECRET) must be at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters in production.`,
                    path: ["AUTH_JWT_SECRET"],
                });
            }
            if (!config.auth.apiPublicUrl) {
                ctx.addIssue({
                    code: "custom",
                    message: "API_PUBLIC_URL is required in production (e.g. https://api.coremapmm.com).",
                    path: ["API_PUBLIC_URL"],
                });
            }
            if (!config.auth.dashboardAppUrl) {
                ctx.addIssue({
                    code: "custom",
                    message: "DASHBOARD_APP_URL is required in production (e.g. https://admin.coremapmm.com).",
                    path: ["DASHBOARD_APP_URL"],
                });
            }
            if (!config.email.otpSecret || config.email.otpSecret.trim().length < 16) {
                ctx.addIssue({
                    code: "custom",
                    message: "EMAIL_OTP_SECRET is required in production (random secret, at least 16 characters).",
                    path: ["EMAIL_OTP_SECRET"],
                });
            }
            if (
                !config.auth.mfaEncryptionKey ||
                config.auth.mfaEncryptionKey.length < MIN_PRODUCTION_MFA_KEY_LENGTH
            ) {
                ctx.addIssue({
                    code: "custom",
                    message:
                        `AUTH_MFA_ENCRYPTION_KEY is required in production (≥${MIN_PRODUCTION_MFA_KEY_LENGTH} chars). ` +
                        "Use a cryptographically random secret (≥32 random bytes, e.g. openssl rand -hex 32). " +
                        "Do not derive it from AUTH_JWT_SECRET, passwords, or the app name. " +
                        "scrypt with a fixed app salt remains acceptable because the input key must already be high-entropy.",
                    path: ["AUTH_MFA_ENCRYPTION_KEY"],
                });
            }
            if (!config.auth.google) {
                ctx.addIssue({
                    code: "custom",
                    message:
                        "GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REDIRECT_URI are required in production.",
                    path: ["GOOGLE_OAUTH_CLIENT_ID"],
                });
            } else {
                const redirectCheck = isSecureProductionOAuthRedirect(
                    config.auth.google.redirectUri,
                    config.auth.apiPublicUrl
                );
                if (!redirectCheck.ok) {
                    ctx.addIssue({
                        code: "custom",
                        message: redirectCheck.reason,
                        path: ["GOOGLE_OAUTH_REDIRECT_URI"],
                    });
                }
            }
        }

        if (config.auth.facebookEnabled && !config.auth.facebook) {
            ctx.addIssue({
                code: "custom",
                message:
                    "FACEBOOK_OAUTH_APP_ID, FACEBOOK_OAUTH_APP_SECRET, and FACEBOOK_OAUTH_REDIRECT_URI are required when FACEBOOK_OAUTH_ENABLED=true.",
                path: ["FACEBOOK_OAUTH_APP_ID"],
            });
        }

        if (!config.routing.enabled) {
            return;
        }
        if (config.routing.defaultEngine === "valhalla" && !config.routing.valhallaBaseUrl) {
            ctx.addIssue({
                code: "custom",
                message: "VALHALLA_BASE_URL is required when ROUTING_ENABLED=true and ROUTING_DEFAULT_ENGINE=valhalla.",
                path: ["VALHALLA_BASE_URL"],
            });
        }
    });

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type RoutingEnvConfig = ApiEnv["routing"];
export type EmailEnvConfig = ApiEnv["email"];
export type AuthRateLimitConfig = ApiEnv["authRateLimit"];
export type AuthEnvConfig = ApiEnv["auth"];
export type OAuthProviderEnv = {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
};
export type R2MediaEnvConfig = {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint: string;
    region: string;
    privateBucket: string;
    publicBucket: string;
    publicBaseUrl: string;
};

type R2RawEnv = {
    R2_ACCOUNT_ID?: string;
    R2_ACCESS_KEY_ID?: string;
    R2_SECRET_ACCESS_KEY?: string;
    R2_ENDPOINT?: string;
    R2_REGION?: string;
    R2_MEDIA_PRIVATE_BUCKET?: string;
    R2_MEDIA_PUBLIC_BUCKET?: string;
    R2_MEDIA_PUBLIC_BASE_URL?: string;
};

function parseOAuthProviderEnv(input: {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
}): OAuthProviderEnv | null {
    const clientId = input.clientId?.trim() || "";
    const clientSecret = input.clientSecret?.trim() || "";
    const redirectUri = input.redirectUri?.trim() || "";
    if (!clientId && !clientSecret && !redirectUri) {
        return null;
    }
    if (!clientId || !clientSecret || !redirectUri) {
        throw new Error(
            "Incomplete OAuth provider configuration. Set client id, secret, and redirect URI together, or leave all empty to disable the provider."
        );
    }
    try {
        new URL(redirectUri);
    } catch {
        throw new Error("OAuth redirect URI must be a valid URL.");
    }
    return { clientId, clientSecret, redirectUri };
}

function parseR2MediaEnv(raw: R2RawEnv): R2MediaEnvConfig | null {
    const present = R2_REQUIRED_KEYS.filter((key) => Boolean(raw[key]));
    if (present.length === 0) {
        return null;
    }
    const missing = R2_REQUIRED_KEYS.filter((key) => !raw[key]);
    if (missing.length > 0) {
        return null;
    }

    const endpoint = raw.R2_ENDPOINT!.replace(/\/+$/, "");
    const publicBaseUrl = raw.R2_MEDIA_PUBLIC_BASE_URL!.replace(/\/+$/, "");
    try {
        new URL(endpoint);
        new URL(publicBaseUrl);
    } catch {
        throw new Error("R2_ENDPOINT and R2_MEDIA_PUBLIC_BASE_URL must be valid URLs.");
    }

    return {
        accountId: raw.R2_ACCOUNT_ID!,
        accessKeyId: raw.R2_ACCESS_KEY_ID!,
        secretAccessKey: raw.R2_SECRET_ACCESS_KEY!,
        endpoint,
        region: raw.R2_REGION && raw.R2_REGION.length > 0 ? raw.R2_REGION : "auto",
        privateBucket: raw.R2_MEDIA_PRIVATE_BUCKET!,
        publicBucket: raw.R2_MEDIA_PUBLIC_BUCKET!,
        publicBaseUrl,
    };
}

let cachedEnv: ApiEnv | null = null;

/** @internal Test-only — clears cached parse between env test cases. */
export function resetApiEnvCacheForTests(): void {
    cachedEnv = null;
}

function formatEnvIssues(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
            return `  - ${path}: ${issue.message}`;
        })
        .join("\n");
}

/**
 * Parse and validate API environment variables. Call after dotenv loads (see server.ts).
 * Throws on invalid configuration so the process fails fast at startup.
 */
export function loadApiEnv(): ApiEnv {
    if (cachedEnv) {
        return cachedEnv;
    }

    const result = apiEnvSchema.safeParse(process.env);
    if (!result.success) {
        throw new Error(`Invalid API environment configuration:\n${formatEnvIssues(result.error)}`);
    }

    cachedEnv = result.data;
    return cachedEnv;
}

/** Validated env (loadApiEnv must run first in production startup). */
export function getApiEnv(): ApiEnv {
    if (!cachedEnv) {
        return loadApiEnv();
    }
    return cachedEnv;
}

export function getRoutingEnv(): RoutingEnvConfig {
    return getApiEnv().routing;
}

export function getEmailEnv(): EmailEnvConfig {
    return getApiEnv().email;
}

export function getAuthEnv(): AuthEnvConfig {
    return getApiEnv().auth;
}

/** Public OAuth capability flags for web/dashboard UI. API is the source of truth. */
export function getOAuthProviderCapabilities(): { google: boolean; facebook: boolean } {
    const auth = getAuthEnv();
    return {
        google: Boolean(auth.google),
        facebook: Boolean(auth.facebookEnabled && auth.facebook),
    };
}

export function isFacebookOAuthEnabled(): boolean {
    return getAuthEnv().facebookEnabled;
}

export function getAuthRateLimitEnv(): AuthRateLimitConfig {
    return getApiEnv().authRateLimit;
}

/** R2 media config, or null when the API is running without media storage. */
export function getOptionalR2MediaEnv(): R2MediaEnvConfig | null {
    return getApiEnv().r2;
}

/** R2 media config. Throws when media routes run without the full R2 group. */
export function getR2MediaEnv(): R2MediaEnvConfig {
    const r2 = getOptionalR2MediaEnv();
    if (!r2) {
        throw new MediaStorageNotConfiguredError();
    }
    return r2;
}

export class MediaStorageNotConfiguredError extends Error {
    readonly statusCode = 503;

    constructor() {
        super("Media storage is not configured.");
        this.name = "MediaStorageNotConfiguredError";
    }
}

/**
 * Public web app base URL (no trailing slash), used to build absolute share
 * links such as `${getPublicAppUrl()}/s/<code>`. Guaranteed non-null after
 * env validation (production requires PUBLIC_APP_URL; dev falls back to the
 * local web origin).
 */
export function getPublicAppUrl(): string {
    const url = getApiEnv().publicAppUrl;
    if (!url) {
        throw new Error("PUBLIC_APP_URL is not configured.");
    }
    return url;
}

export function isRoutingEnabled(): boolean {
    return getRoutingEnv().enabled;
}

export function isRoutingProfilePublic(profile: string): boolean {
    return getRoutingEnv().publicProfiles.includes(
        profile as RoutingEnvConfig["publicProfiles"][number]
    );
}

/** For future POST /routing/route when ROUTING_ENABLED=false → HTTP 503. */
export function assertRoutingServiceEnabled(): void {
    if (!isRoutingEnabled()) {
        throw new RoutingServiceDisabledError();
    }
}

export class RoutingServiceDisabledError extends Error {
    readonly statusCode = 503;

    constructor() {
        super("Routing is disabled. Set ROUTING_ENABLED=true to enable directions.");
        this.name = "RoutingServiceDisabledError";
    }
}
