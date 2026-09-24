import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { writeMappedBootstrapGzip, withTempBootstrapDir } from "./field-bootstrap-generator.js";
import { FieldBootstrapRefresher } from "./field-bootstrap-refresh.js";
import { FilesystemFieldBootstrapStore } from "./field-bootstrap-store.js";
import type { FieldBootstrapResponse } from "./field.schema.js";

function snapshot(revision: string): Extract<FieldBootstrapResponse, { unchanged: false }> {
    const routeId = "11111111-1111-4111-8111-111111111111";
    const d0 = "22222222-2222-4222-8222-222222222222";
    const d1 = "22222222-2222-4222-8222-222222222223";
    const stopId = "33333333-3333-4333-8333-333333333333";
    return {
        snapshotRevision: revision,
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

test("stale published snapshot is rebuilt from the live revision", async () => {
    await withTempBootstrapDir(async (directory) => {
        const store = new FilesystemFieldBootstrapStore(directory);
        const oldGzip = path.join(directory, "old.json.gz");
        const oldManifest = await writeMappedBootstrapGzip(snapshot("v1-old"), oldGzip);
        await store.publish({ gzipPath: oldGzip, manifest: oldManifest });

        let writes = 0;
        const refresher = new FieldBootstrapRefresher();
        const first = await refresher.refresh({
            store,
            loadLiveRevision: async () => "v1-live",
            writeSnapshot: async (gzipPath) => {
                writes += 1;
                return writeMappedBootstrapGzip(snapshot("v1-live"), gzipPath);
            },
        });
        const second = await refresher.refresh({
            store,
            loadLiveRevision: async () => "v1-live",
            writeSnapshot: async (gzipPath) => {
                writes += 1;
                return writeMappedBootstrapGzip(snapshot("v1-live"), gzipPath);
            },
        });

        assert.equal(first, "rebuilt");
        assert.equal(second, "fresh");
        assert.equal(writes, 1);
        const current = await store.readCurrent();
        assert.equal(current?.manifest.snapshotRevision, "v1-live");
    });
});

test("overlapping syncs share one rebuild", async () => {
    await withTempBootstrapDir(async (directory) => {
        const store = new FilesystemFieldBootstrapStore(directory);
        let writes = 0;
        let releaseWrite: (() => void) | undefined;
        let markStarted: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
            releaseWrite = resolve;
        });
        const started = new Promise<void>((resolve) => {
            markStarted = resolve;
        });
        const refresher = new FieldBootstrapRefresher();
        const input = {
            store,
            loadLiveRevision: async () => "v1-live",
            writeSnapshot: async (gzipPath: string) => {
                writes += 1;
                markStarted?.();
                await gate;
                return writeMappedBootstrapGzip(snapshot("v1-live"), gzipPath);
            },
        };

        const first = refresher.refresh(input);
        await started;
        const second = refresher.refresh(input);
        assert.equal(writes, 1);
        releaseWrite?.();
        assert.deepEqual(await Promise.all([first, second]), ["rebuilt", "fresh"]);
        assert.equal(writes, 1);
    });
});
