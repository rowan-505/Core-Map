import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildFacebookAuthorization, exchangeFacebookCode } from "./facebook.js";

describe("facebook oauth adapter", () => {
    it("requests only public_profile and email", () => {
        const built = buildFacebookAuthorization(
            {
                clientId: "app",
                clientSecret: "secret",
                redirectUri: "http://localhost:3001/auth/oauth/facebook/callback",
            },
            {}
        );
        const url = new URL(built.authorizationUrl);
        assert.equal(url.searchParams.get("scope"), "public_profile,email");
    });

    it("normalizes Graph id as subject", async () => {
        const fetcher = (async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("oauth/access_token")) {
                return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
            }
            return new Response(JSON.stringify({ id: "fb-99", name: "Ada", email: "ada@example.com" }), {
                status: 200,
            });
        }) as typeof fetch;
        const identity = await exchangeFacebookCode(
            {
                clientId: "app",
                clientSecret: "secret",
                redirectUri: "http://localhost:3001/auth/oauth/facebook/callback",
            },
            { code: "abc" },
            fetcher
        );
        assert.equal(identity.provider, "facebook");
        assert.equal(identity.subject, "fb-99");
        assert.equal(identity.email, "ada@example.com");
    });

    it("accepts Graph profile without email", async () => {
        const fetcher = (async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("oauth/access_token")) {
                return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
            }
            return new Response(JSON.stringify({ id: "fb-55", name: "No Email" }), {
                status: 200,
            });
        }) as typeof fetch;
        const identity = await exchangeFacebookCode(
            {
                clientId: "app",
                clientSecret: "secret",
                redirectUri: "http://localhost:3001/auth/oauth/facebook/callback",
            },
            { code: "abc" },
            fetcher
        );
        assert.equal(identity.subject, "fb-55");
        assert.equal(identity.email, null);
        assert.equal(identity.emailVerified, false);
        assert.equal(identity.displayName, "No Email");
    });
});
