import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    __setAccessTokenForTests,
    clearAuthTokens,
    getAccessToken,
    setAccessToken,
} from "./authTokenStorage.js";

describe("dashboard access token memory storage", () => {
    it("never persists access tokens to localStorage or sessionStorage", () => {
        const local = new Map<string, string>();
        const session = new Map<string, string>();
        (globalThis as { window?: unknown }).window = {
            localStorage: {
                getItem: (key: string) => (local.has(key) ? local.get(key)! : null),
                setItem: (key: string, value: string) => local.set(key, value),
                removeItem: (key: string) => local.delete(key),
            },
            sessionStorage: {
                getItem: (key: string) => (session.has(key) ? session.get(key)! : null),
                setItem: (key: string, value: string) => session.set(key, value),
                removeItem: (key: string) => session.delete(key),
            },
        };

        local.set("accessToken", "legacy-should-be-cleared");
        session.set("accessToken", "legacy-session-should-be-cleared");

        setAccessToken("memory-only-jwt");
        assert.equal(getAccessToken(), "memory-only-jwt");
        assert.equal(local.has("accessToken"), false);
        assert.equal(session.has("accessToken"), false);

        clearAuthTokens();
        assert.equal(getAccessToken(), null);

        __setAccessTokenForTests("test");
        assert.equal(getAccessToken(), "test");
        assert.equal(local.has("accessToken"), false);
    });

    it("returns an in-memory token immediately when restoring from other tabs", async () => {
        const { restoreAccessTokenFromOtherTabs } = await import("./authTokenStorage.js");
        __setAccessTokenForTests("peer-jwt");
        const restored = await restoreAccessTokenFromOtherTabs(10);
        assert.equal(restored, "peer-jwt");
    });
});
