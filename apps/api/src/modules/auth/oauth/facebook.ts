import { randomBytes } from "node:crypto";

import type { OAuthProviderEnv } from "../../../config/env.js";
import type { NormalizedIdentity, OAuthAuthorization } from "./types.js";

const FB_AUTH = "https://www.facebook.com/v21.0/dialog/oauth";
const FB_TOKEN = "https://graph.facebook.com/v21.0/oauth/access_token";
const FB_ME = "https://graph.facebook.com/v21.0/me";

export function buildFacebookAuthorization(
    config: OAuthProviderEnv,
    input: { returnTo?: string | null }
): OAuthAuthorization {
    const state = randomBytes(24).toString("base64url");
    const url = new URL(FB_AUTH);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "public_profile,email");
    url.searchParams.set("state", state);
    void input.returnTo;
    return { authorizationUrl: url.toString(), state };
}

export async function exchangeFacebookCode(
    config: OAuthProviderEnv,
    input: { code: string },
    fetcher: typeof fetch = fetch
): Promise<NormalizedIdentity> {
    const tokenUrl = new URL(FB_TOKEN);
    tokenUrl.searchParams.set("client_id", config.clientId);
    tokenUrl.searchParams.set("client_secret", config.clientSecret);
    tokenUrl.searchParams.set("redirect_uri", config.redirectUri);
    tokenUrl.searchParams.set("code", input.code);
    const tokenResponse = await fetcher(tokenUrl);
    if (!tokenResponse.ok) {
        throw new Error("Facebook token exchange failed");
    }
    const tokenJson = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
        throw new Error("Facebook response missing access_token");
    }
    const meUrl = new URL(FB_ME);
    meUrl.searchParams.set("fields", "id,name,email");
    meUrl.searchParams.set("access_token", tokenJson.access_token);
    const meResponse = await fetcher(meUrl);
    if (!meResponse.ok) {
        throw new Error("Facebook profile lookup failed");
    }
    const profile = (await meResponse.json()) as { id?: string; name?: string; email?: string };
    if (!profile.id) {
        throw new Error("Facebook identity missing id");
    }
    return {
        provider: "facebook",
        subject: profile.id,
        email: profile.email ?? null,
        // TODO(before Facebook production activation):
        // - Do NOT infer verified email from presence of profile.email.
        // - Provider identity must remain provider + Facebook user ID.
        // - CoreMap OTP must verify user-supplied email where needed (complete-profile flow).
        emailVerified: Boolean(profile.email),
        displayName: profile.name ?? null,
    };
}
