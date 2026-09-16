export type OAuthProviderName = "google" | "facebook";

/** @deprecated Prefer AuthClientType / OAuthBrowserClient from auth-client.ts */
export type OAuthClient = "web" | "dashboard";

export type { AuthClientType, OAuthBrowserClient } from "../auth-client.js";
export { isAuthClientType, isOAuthBrowserClient, resolveBrowserLoginClientType } from "../auth-client.js";

export type NormalizedIdentity = {
    provider: OAuthProviderName;
    /** Stable provider user id (e.g. Google `sub`). Never use email as the identity key. */
    subject: string;
    email: string | null;
    emailVerified: boolean;
    displayName: string | null;
};

export type OAuthStartInput = {
    client: OAuthClient;
    returnTo?: string | null;
};

export type OAuthAuthorization = {
    authorizationUrl: string;
    state: string;
    codeVerifier?: string;
    nonce?: string;
};
