import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";

import { gzipJson } from "./field-gzip.js";
import { StreamingJsonGzipFile } from "./field-bootstrap-json-gzip.js";
import { createPeakTracker } from "./field-bootstrap-metrics.js";
import type { FieldRoute, FieldRoutePath, FieldStop, FieldVariant } from "./field.schema.js";

function makePath(pointCount: number): FieldRoutePath {
    return {
        variantPublicId: randomUUID(),
        geometry: {
            type: "LineString",
            coordinates: Array.from({ length: pointCount }, (_, i) => [
                96.15 + i * 0.00005,
                16.78 + i * 0.00004,
            ]),
        },
    };
}

/**
 * Disposable production-sized stand-in: dense LineStrings dominate memory.
 * Do not log coordinates.
 */
function productionLikeCounts() {
    return {
        routes: 80,
        variants: 160,
        stops: 1_500,
        routeStops: 8_000,
        pathPoints: 700,
    };
}

test("peak memory is stringify+gzip copies, not streaming gzip", async () => {
    const startedAt = Date.now();
    const counts = productionLikeCounts();
    const routes: FieldRoute[] = Array.from({ length: counts.routes }, (_, i) => ({
        publicId: randomUUID(),
        routeCode: `YBS-${i + 1}`,
        nameMy: null,
        nameEn: `Route ${i + 1}`,
    }));
    const variants: FieldVariant[] = routes.flatMap((route) => {
        const d0 = randomUUID();
        const d1 = randomUUID();
        return [
            {
                publicId: d0,
                routePublicId: route.publicId,
                variantCode: "D0" as const,
                directionId: 0 as const,
                originName: "A",
                destinationName: "B",
                oppositeVariantPublicId: d1,
            },
            {
                publicId: d1,
                routePublicId: route.publicId,
                variantCode: "D1" as const,
                directionId: 1 as const,
                originName: "B",
                destinationName: "A",
                oppositeVariantPublicId: d0,
            },
        ];
    });
    const stops: FieldStop[] = Array.from({ length: counts.stops }, (_, i) => ({
        publicId: randomUUID(),
        stopCode: `S${i}`,
        nameMy: null,
        nameEn: `Stop ${i}`,
        lat: 16.8,
        lng: 96.15,
    }));
    const routeStops = Array.from({ length: counts.routeStops }, (_, i) => ({
        variantPublicId: variants[i % variants.length].publicId,
        stopPublicId: stops[i % stops.length].publicId,
        stopSequence: (i % 40) + 1,
    }));

    const afterLists = createPeakTracker(startedAt).sample("after_lists");

    const pathTracker = createPeakTracker(startedAt);
    const routePaths = Array.from({ length: variants.length }, () => makePath(counts.pathPoints));
    const afterPaths = pathTracker.sample("after_full_path_objects");

    const payload = {
        snapshotRevision: "v1-measure",
        unchanged: false as const,
        routes,
        variants,
        stops,
        routeStops,
        routePaths,
    };

    const beforeSerialize = pathTracker.sample("before_serialization");
    const gzipStarted = Date.now();
    const gzipped = gzipJson(payload);
    const afterGzip = pathTracker.sample("after_sync_gzip");
    const gzipMs = Date.now() - gzipStarted;
    const uncompressedBytes = Buffer.byteLength(JSON.stringify({
        snapshotRevision: payload.snapshotRevision,
        routeCount: routes.length,
        variantCount: variants.length,
        stopCount: stops.length,
        routeStopCount: routeStops.length,
        pathCount: routePaths.length,
        pathPoints: counts.pathPoints,
    }));

    const directory = await mkdtemp(path.join(os.tmpdir(), "field-boot-mem-"));
    try {
        const streamPath = path.join(directory, "stream.json.gz");
        const streamTracker = createPeakTracker(Date.now());
        streamTracker.sample("stream_start");
        const writer = new StreamingJsonGzipFile(streamPath);
        await writer.writeRaw(`{"snapshotRevision":"v1-measure","unchanged":false,"routes":`);
        await writer.beginArray();
        for (const route of routes) {
            await writer.writeArrayItem(route);
        }
        await writer.endArray();
        await writer.writeRaw(`,"variants":`);
        await writer.beginArray();
        for (const variant of variants) {
            await writer.writeArrayItem(variant);
        }
        await writer.endArray();
        await writer.writeRaw(`,"stops":`);
        await writer.beginArray();
        for (const stop of stops) {
            await writer.writeArrayItem(stop);
        }
        await writer.endArray();
        await writer.writeRaw(`,"routeStops":`);
        await writer.beginArray();
        for (const item of routeStops) {
            await writer.writeArrayItem(item);
        }
        await writer.endArray();
        await writer.writeRaw(`,"routePaths":`);
        await writer.beginArray();
        for (const item of routePaths) {
            await writer.writeArrayItem(item);
        }
        await writer.endArray();
        await writer.writeRaw("}");
        const written = await writer.close();
        const afterStream = streamTracker.sample("after_stream_gzip");

        assert.ok(gzipped.length > 50_000, `compressed too small: ${gzipped.length}`);
        assert.ok(written.compressedBytes > 50_000);
        assert.ok(written.uncompressedBytes > written.compressedBytes);
        assert.ok((await stat(streamPath)).size === written.compressedBytes);
        assert.ok(afterGzip.rss > 0 && afterStream.rss > 0);

        process.stderr.write(
            `${JSON.stringify({
                kind: "field_bootstrap_measure",
                notes: "no geometry or bodies logged",
                counts,
                afterListsRss: afterLists.rss,
                afterPathsRss: afterPaths.rss,
                beforeSerializeRss: beforeSerialize.rss,
                afterSyncGzipRss: afterGzip.rss,
                afterSyncGzipHeap: afterGzip.heapUsed,
                syncGzipBytes: gzipped.length,
                syncGzipMs: gzipMs,
                streamUncompressedBytes: written.uncompressedBytes,
                streamCompressedBytes: written.compressedBytes,
                afterStreamRss: afterStream.rss,
                afterStreamHeap: afterStream.heapUsed,
                metaBytes: uncompressedBytes,
            })}\n`
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("streaming gzip does not keep a JSON string of the whole payload", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "field-boot-stream-"));
    try {
        const filePath = path.join(directory, "tiny.json.gz");
        const writer = new StreamingJsonGzipFile(filePath);
        await writer.writeRaw('{"snapshotRevision":"v1","unchanged":false,"routes":');
        await writer.beginArray();
        await writer.writeArrayItem({ publicId: randomUUID(), routeCode: "YBS-1" });
        await writer.endArray();
        await writer.writeRaw("}");
        const written = await writer.close();
        assert.ok(written.compressedBytes > 0);
        assert.ok(written.uncompressedBytes > 0);
        assert.equal((await stat(filePath)).size, written.compressedBytes);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
