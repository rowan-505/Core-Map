import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import authPlugin from "../../plugins/auth.js";

const REPORT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function withAuthApp(
    env: { JWT_SECRET?: string; AUTH_BYPASS?: string },
    run: (app: ReturnType<typeof Fastify>) => Promise<void>
) {
    const previous = {
        JWT_SECRET: process.env.JWT_SECRET,
        AUTH_BYPASS: process.env.AUTH_BYPASS,
        NODE_ENV: process.env.NODE_ENV,
    };
    process.env.JWT_SECRET = env.JWT_SECRET ?? "reports-delete-auth-test-secret";
    if (env.AUTH_BYPASS === undefined) {
        delete process.env.AUTH_BYPASS;
    } else {
        process.env.AUTH_BYPASS = env.AUTH_BYPASS;
    }
    process.env.NODE_ENV = "test";

    const app = Fastify();
    try {
        await app.register(authPlugin);
        app.delete(
            "/admin/reports/:id",
            { preHandler: [app.authenticate, app.requireRole("admin", "super_admin")] },
            async () => ({
                deleted: true,
                public_id: REPORT_ID,
                media_cleanup_warning: null,
            })
        );
        await app.ready();
        await run(app);
    } finally {
        await app.close();
        if (previous.JWT_SECRET === undefined) {
            delete process.env.JWT_SECRET;
        } else {
            process.env.JWT_SECRET = previous.JWT_SECRET;
        }
        if (previous.AUTH_BYPASS === undefined) {
            delete process.env.AUTH_BYPASS;
        } else {
            process.env.AUTH_BYPASS = previous.AUTH_BYPASS;
        }
        if (previous.NODE_ENV === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = previous.NODE_ENV;
        }
    }
}

test("DELETE /admin/reports/:id rejects unauthorized roles with 403", async () => {
    await withAuthApp({}, async (app) => {
        const missing = await app.inject({
            method: "DELETE",
            url: `/admin/reports/${REPORT_ID}`,
        });
        assert.equal(missing.statusCode, 401);

        const sign = (roles: string[]) => app.jwt.sign({ sub: "u1", email: "u1@example.com", roles });

        for (const roles of [["user"], ["viewer"], ["surveyor"]]) {
            const denied = await app.inject({
                method: "DELETE",
                url: `/admin/reports/${REPORT_ID}`,
                headers: { authorization: `Bearer ${sign(roles)}` },
            });
            assert.equal(denied.statusCode, 403);
        }

        for (const roles of [["admin"], ["super_admin"]]) {
            const allowed = await app.inject({
                method: "DELETE",
                url: `/admin/reports/${REPORT_ID}`,
                headers: { authorization: `Bearer ${sign(roles)}` },
            });
            assert.equal(allowed.statusCode, 200);
        }
    });
});
