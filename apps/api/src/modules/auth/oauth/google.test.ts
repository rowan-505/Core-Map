import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertGoogleIdTokenNonce, buildGoogleAuthorization, exchangeGoogleCode } from "./google.js";

describe("google oauth adapter", () => {
    it("builds an authorization URL with PKCE", () => {
        const built = buildGoogleAuthorization(
            {
                clientId: "client",
                clientSecret: "secret",
                redirectUri: "http://localhost:3001/auth/oauth/google/callback",
            },
            { returnTo: null }
        );
        const url = new URL(built.authorizationUrl);
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        assert.ok(built.codeVerifier);
        assert.ok(built.nonce);
        assert.ok(built.state);
    });

    it("fails closed when Google omits id_token", async () => {
        const fetcher = (async () =>
            new Response(JSON.stringify({ access_token: "nope" }), {
                status: 200,
                headers: { "content-type": "application/json" },
            })) as typeof fetch;
        await assert.rejects(
            () =>
                exchangeGoogleCode(
                    {
                        clientId: "client",
                        clientSecret: "secret",
                        redirectUri: "http://localhost:3001/auth/oauth/google/callback",
                    },
                    { code: "abc", codeVerifier: "ver", nonce: "n" },
                    fetcher
                ),
            /id_token/
        );
    });
});

describe("google ID token nonce fail-closed", () => {
    it("accepts a matching nonce", () => {
        assert.doesNotThrow(() => assertGoogleIdTokenNonce("abc123", "abc123"));
    });

    it("rejects a wrong nonce", () => {
        assert.throws(() => assertGoogleIdTokenNonce("abc123", "other"), /nonce mismatch/);
    });

    it("rejects a missing nonce", () => {
        assert.throws(() => assertGoogleIdTokenNonce(undefined, "abc123"), /missing nonce/);
        assert.throws(() => assertGoogleIdTokenNonce("", "abc123"), /missing nonce/);
        assert.throws(() => assertGoogleIdTokenNonce(null, "abc123"), /missing nonce/);
    });
});
