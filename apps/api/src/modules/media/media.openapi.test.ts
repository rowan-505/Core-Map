import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { postMediaUploadSchema } from "./media.openapi.js";

test("media upload OpenAPI preserves required checksum request and signed response header", async () => {
    const app = Fastify();
    app.post("/media/uploads", { schema: postMediaUploadSchema }, async (request, reply) => {
        const body = request.body as Record<string, unknown>;
        assert.equal(body.checksumSha256, "a".repeat(64));
        return reply.code(201).send({
            publicId: "11111111-1111-4111-8111-111111111111",
            mediaType: "image",
            mimeType: "image/jpeg",
            byteSize: 10,
            status: "pending",
            upload: {
                method: "PUT",
                url: "http://127.0.0.1/upload",
                headers: {
                    "Content-Type": "image/jpeg",
                    "Content-Length": "10",
                },
                expiresAt: "2026-09-07T00:10:00.000Z",
            },
        });
    });
    const response = await app.inject({
        method: "POST",
        url: "/media/uploads",
        payload: { mediaType: "image", mimeType: "image/jpeg", byteSize: 10, checksumSha256: "a".repeat(64) },
    });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json().upload.headers, {
        "Content-Type": "image/jpeg",
        "Content-Length": "10",
    });
    await app.close();
});
