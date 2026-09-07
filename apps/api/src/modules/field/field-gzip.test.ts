import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { clientAcceptsGzip, gzipJson } from "./field-gzip.js";

test("gzip encoding is offered only when the client asks", () => {
    assert.equal(clientAcceptsGzip("gzip, deflate"), true);
    assert.equal(clientAcceptsGzip("identity"), false);
    assert.equal(clientAcceptsGzip(undefined), false);
});

test("gzipJson round-trips and shrinks a snapshot-shaped payload", () => {
    const value = {
        snapshotRevision: "v1-test",
        unchanged: false,
        routes: Array.from({ length: 40 }, (_, i) => ({
            publicId: `r${i}`,
            routeCode: `YBS-${i}`,
        })),
    };
    const raw = Buffer.from(JSON.stringify(value), "utf8");
    const gzipped = gzipJson(value);
    assert.ok(gzipped.length < raw.length);
    assert.deepEqual(JSON.parse(gunzipSync(gzipped).toString("utf8")), value);
});
