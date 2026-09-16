import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

import type { OAuthProviderEnv } from "../../../config/env.js";
import type { NormalizedIdentity, OAuthAuthorization } from "./types.js";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export function buildGoogleAuthorization(
    config: OAuthProviderEnv,
    input: { returnTo?: string | null }
): OAuthAuthorization {
    const state = randomBytes(24).toString("base64url");
    const nonce = randomBytes(24).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const url = new URL(GOOGLE_AUTH);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");
    void input.returnTo;
    return { authorizationUrl: url.toString(), state, codeVerifier, nonce };
}

/** Fail-closed: CoreMap always sends nonce, so the ID token must echo it. */
export function assertGoogleIdTokenNonce(payloadNonce: unknown, expected: string): void {
    if (typeof payloadNonce !== "string" || payloadNonce.length === 0) {
        throw new Error("Google ID token missing nonce");
    }
    if (typeof expected !== "string" || expected.length === 0) {
        throw new Error("Google nonce mismatch");
    }
    const left = Buffer.from(payloadNonce);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
        throw new Error("Google nonce mismatch");
    }
}

export async function exchangeGoogleCode(
    config: OAuthProviderEnv,
    input: { code: string; codeVerifier: string; nonce: string },
    fetcher: typeof fetch = fetch
): Promise<NormalizedIdentity> {
    const body = new URLSearchParams({
        code: input.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
        code_verifier: input.codeVerifier,
    });
    const response = await fetcher(GOOGLE_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
    });
    if (!response.ok) {
        throw new Error("Google token exchange failed");
    }
    const json = (await response.json()) as { id_token?: string };
    if (!json.id_token) {
        throw new Error("Google response missing id_token");
    }
    const { payload } = await jwtVerify(json.id_token, GOOGLE_JWKS, {
        issuer: GOOGLE_ISSUERS,
        audience: config.clientId,
    });
    assertGoogleIdTokenNonce(payload.nonce, input.nonce);
    const subject = typeof payload.sub === "string" ? payload.sub : "";
    if (!subject) {
        throw new Error("Google identity missing sub");
    }
    const email = typeof payload.email === "string" ? payload.email : null;
    const emailVerified = payload.email_verified === true;
    const displayName = typeof payload.name === "string" ? payload.name : null;
    return {
        provider: "google",
        subject,
        email,
        emailVerified,
        displayName,
    };
}
