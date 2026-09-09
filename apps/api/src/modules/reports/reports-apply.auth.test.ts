import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import authPlugin, { requireReportsReview } from "../../plugins/auth.js";

async function withAuthApp(
    run: (app: ReturnType<typeof Fastify>) => Promise<void>
) {
    const previous = {
        JWT_SECRET: process.env.JWT_SECRET,
        AUTH_BYPASS: process.env.AUTH_BYPASS,
        NODE_ENV: process.env.NODE_ENV,
    };
    process.env.JWT_SECRET = "reports-apply-auth-test-secret";
    delete process.env.AUTH_BYPASS;
    process.env.NODE_ENV = "test";

    const app = Fastify();
    try {
        await app.register(authPlugin);
        app.post(
            "/admin/reports/:id/apply",
            { preHandler: [app.authenticate, app.requireReportsReview] },
            async () => ({ ok: true })
        );
        await app.ready();
        await run(app);
    } finally {
        await app.close();
        if (previous.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previous.JWT_SECRET;
        if (previous.AUTH_BYPASS === undefined) delete process.env.AUTH_BYPASS;
        else process.env.AUTH_BYPASS = previous.AUTH_BYPASS;
        if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous.NODE_ENV;
    }
}

test("POST apply rejects unauthorized and non-review roles", async () => {
    await withAuthApp(async (app) => {
        const missing = await app.inject({
            method: "POST",
            url: "/admin/reports/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/apply",
            payload: { action: "RESOLVE", expectedCanonicalRevision: "v1" },
        });
        assert.equal(missing.statusCode, 401);

        const sign = (roles: string[]) =>
            app.jwt.sign({ sub: "u1", email: "u1@example.com", roles });

        for (const roles of [["user"], ["viewer"], ["surveyor"]]) {
            const denied = await app.inject({
                method: "POST",
                url: "/admin/reports/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/apply",
                headers: { authorization: `Bearer ${sign(roles)}` },
                payload: { action: "RESOLVE", expectedCanonicalRevision: "v1" },
            });
            assert.equal(denied.statusCode, 403);
        }

        for (const roles of [["admin"], ["super_admin"]]) {
            const allowed = await app.inject({
                method: "POST",
                url: "/admin/reports/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/apply",
                headers: { authorization: `Bearer ${sign(roles)}` },
                payload: { action: "RESOLVE", expectedCanonicalRevision: "v1" },
            });
            assert.equal(allowed.statusCode, 200);
        }
    });
});

test("requireReportsReview helper rejects surveyor", async () => {
    const reply = {
        code(status: number) {
            this.statusCode = status;
            return this;
        },
        send(payload: unknown) {
            this.payload = payload;
            return this;
        },
        statusCode: 200,
        payload: null as unknown,
    };
    await requireReportsReview(
        { user: { sub: "s", email: "s@x", roles: ["surveyor"] } } as never,
        reply as never
    );
    assert.equal(reply.statusCode, 403);
});
