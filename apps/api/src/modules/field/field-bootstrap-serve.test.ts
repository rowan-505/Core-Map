import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { Readable } from "node:stream";
import type { FastifyRequest } from "fastify";

import { gzipJson } from "./field-gzip.js";
import { writeMappedBootstrapGzip, withTempBootstrapDir } from "./field-bootstrap-generator.js";
import { fieldBootstrapEtag } from "./field-bootstrap-manifest.js";
import { bindBootstrapAbort, serveFieldBootstrap } from "./field-bootstrap-serve.js";
import { FilesystemFieldBootstrapStore } from "./field-bootstrap-store.js";
import { getFieldBootstrapSchema } from "./field.openapi.js";
import type { FieldBootstrapResponse } from "./field.schema.js";

function smallSnapshot(): Extract<FieldBootstrapResponse, { unchanged: false }> {
    const routeId = "11111111-1111-4111-8111-111111111111";
    const d0 = "22222222-2222-4222-8222-222222222222";
    const d1 = "22222222-2222-4222-8222-222222222223";
    const stopId = "33333333-3333-4333-8333-333333333333";
    return {
        snapshotRevision: "v1-test-revision",
        unchanged: false,
        routes: [{ publicId: routeId, routeCode: "YBS-13", nameMy: null, nameEn: "13" }],
        variants: [
            {
                publicId: d0,
                routePublicId: routeId,
                variantCode: "D0",
                directionId: 0,
                originName: "A",
                destinationName: "B",
                oppositeVariantPublicId: d1,
            },
            {
                publicId: d1,
                routePublicId: routeId,
                variantCode: "D1",
                directionId: 1,
                originName: "B",
                destinationName: "A",
                oppositeVariantPublicId: d0,
            },
        ],
        stops: [
            {
                publicId: stopId,
                stopCode: "S1",
                nameMy: null,
                nameEn: "Stop",
                lat: 16.8,
                lng: 96.15,
            },
        ],
        routeStops: [
            { variantPublicId: d0, stopPublicId: stopId, stopSequence: 1 },
            { variantPublicId: d1, stopPublicId: stopId, stopSequence: 1 },
        ],
        routePaths: [
            {
                variantPublicId: d0,
                geometry: { type: "LineString", coordinates: [[96.15, 16.78], [96.16, 16.79]] },
            },
            {
                variantPublicId: d1,
                geometry: { type: "LineString", coordinates: [[96.16, 16.79], [96.15, 16.78]] },
            },
        ],
    };
}

async function withBootstrapApp(
    directory: string,
    run: (app: ReturnType<typeof Fastify>) => Promise<void>
) {
    const store = new FilesystemFieldBootstrapStore(directory);
    const app = Fastify();
    app.get("/field/bootstrap", { schema: getFieldBootstrapSchema }, async (request, reply) => {
        const revision =
            typeof request.query === "object" && request.query && "revision" in request.query
                ? String((request.query as { revision?: string }).revision ?? "")
                : "";
        return serveFieldBootstrap({
            request,
            reply,
            store,
            revision: revision.length > 0 ? revision : undefined,
        });
    });
    await app.ready();
    try {
        await run(app);
    } finally {
        await app.close();
    }
}

test("missing artifact returns 503 without building a snapshot", async () => {
    await withTempBootstrapDir(async (directory) => {
        await withBootstrapApp(directory, async (app) => {
            const response = await app.inject({ method: "GET", url: "/field/bootstrap" });
            assert.equal(response.statusCode, 503);
            assert.equal(response.json().code, "SNAPSHOT_UNAVAILABLE");
        });
    });
});

test("streams gzip snapshot, 304, unchanged 200, and sequential repeats", async () => {
    await withTempBootstrapDir(async (directory) => {
        const snapshot = smallSnapshot();
        const gzipPath = path.join(directory, "build.json.gz");
        const manifest = await writeMappedBootstrapGzip(snapshot, gzipPath);
        await new FilesystemFieldBootstrapStore(directory).publish({ gzipPath, manifest });

        await withBootstrapApp(directory, async (app) => {
            const cold = await app.inject({ method: "GET", url: "/field/bootstrap" });
            assert.equal(cold.statusCode, 200);
            assert.equal(cold.headers["content-encoding"], "gzip");
            assert.equal(cold.headers.etag, fieldBootstrapEtag(manifest.checksumSha256));
            const parsed = JSON.parse(gunzipSync(cold.rawPayload).toString("utf8"));
            assert.equal(parsed.unchanged, false);
            assert.equal(parsed.snapshotRevision, "v1-test-revision");
            assert.equal(parsed.routes.length, 1);
            assert.equal(parsed.variants.length, 2);
            assert.equal(parsed.variants[0].variantCode, "D0");
            assert.equal(parsed.variants[1].variantCode, "D1");
            assert.equal(parsed.variants[0].oppositeVariantPublicId, parsed.variants[1].publicId);
            assert.equal(parsed.stops.length, 1);
            assert.equal(parsed.routeStops.length, 2);
            assert.equal(parsed.routePaths.length, 2);
            assert.equal(parsed.routePaths[0].geometry.type, "LineString");

            for (let i = 0; i < 3; i += 1) {
                const warm = await app.inject({ method: "GET", url: "/field/bootstrap" });
                assert.equal(warm.statusCode, 200);
                assert.equal(gunzipSync(warm.rawPayload).length, gunzipSync(cold.rawPayload).length);
            }

            const unchanged = await app.inject({
                method: "GET",
                url: "/field/bootstrap?revision=v1-test-revision",
            });
            assert.equal(unchanged.statusCode, 200);
            assert.deepEqual(unchanged.json(), {
                snapshotRevision: "v1-test-revision",
                unchanged: true,
            });

            const notModified = await app.inject({
                method: "GET",
                url: "/field/bootstrap",
                headers: { "if-none-match": fieldBootstrapEtag(manifest.checksumSha256) },
            });
            assert.equal(notModified.statusCode, 304);
        });
    });
});

test("two simultaneous downloads both return the same gzip", async () => {
    await withTempBootstrapDir(async (directory) => {
        const snapshot = smallSnapshot();
        const gzipPath = path.join(directory, "build.json.gz");
        const manifest = await writeMappedBootstrapGzip(snapshot, gzipPath);
        await new FilesystemFieldBootstrapStore(directory).publish({ gzipPath, manifest });
        await withBootstrapApp(directory, async (app) => {
            const [a, b] = await Promise.all([
                app.inject({ method: "GET", url: "/field/bootstrap" }),
                app.inject({ method: "GET", url: "/field/bootstrap" }),
            ]);
            assert.equal(a.statusCode, 200);
            assert.equal(b.statusCode, 200);
            assert.deepEqual(a.rawPayload, b.rawPayload);
        });
    });
});

test("truncated current gzip falls back to previous valid snapshot", async () => {
    await withTempBootstrapDir(async (directory) => {
        const first = smallSnapshot();
        const firstGzip = path.join(directory, "first.json.gz");
        const firstManifest = await writeMappedBootstrapGzip(first, firstGzip);
        const store = new FilesystemFieldBootstrapStore(directory);
        await store.publish({ gzipPath: firstGzip, manifest: firstManifest });

        const second = { ...smallSnapshot(), snapshotRevision: "v1-second" };
        const secondGzip = path.join(directory, "second.json.gz");
        const secondManifest = await writeMappedBootstrapGzip(second, secondGzip);
        await store.publish({ gzipPath: secondGzip, manifest: secondManifest });

        await writeFile(path.join(directory, "current.json.gz"), Buffer.from([0x1f, 0x8b, 0x00]));

        await withBootstrapApp(directory, async (app) => {
            const response = await app.inject({ method: "GET", url: "/field/bootstrap" });
            assert.equal(response.statusCode, 200);
            const parsed = JSON.parse(gunzipSync(response.rawPayload).toString("utf8"));
            assert.equal(parsed.snapshotRevision, "v1-test-revision");
        });
    });
});

test("client abort destroys the gzip stream", () => {
    const raw = new EventEmitter() as EventEmitter & { off: typeof EventEmitter.prototype.off };
    const request = { raw } as unknown as FastifyRequest;
    const stream = Readable.from([Buffer.from("abc")]);
    let destroyed = false;
    const original = stream.destroy.bind(stream);
    stream.destroy = ((error?: Error) => {
        destroyed = true;
        return original(error);
    }) as typeof stream.destroy;
    bindBootstrapAbort(request, stream);
    raw.emit("close");
    assert.equal(destroyed, true);
});

test("legacy gzipJson still round-trips a tiny payload", () => {
    const value = { snapshotRevision: "v1-test", unchanged: true };
    assert.deepEqual(JSON.parse(gunzipSync(gzipJson(value)).toString("utf8")), value);
    assert.ok(randomUUID());
});
