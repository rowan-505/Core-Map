import assert from "node:assert/strict";
import test from "node:test";

import { assertSnapshotGeneratorDatabaseUrl, databaseUrlHost } from "./field-bootstrap-db-guard.js";
import { fieldBootstrapEtag, ifNoneMatchHits, parseFieldBootstrapManifest } from "./field-bootstrap-manifest.js";

test("snapshot generator refuses remote database URLs by default", () => {
    assert.equal(databaseUrlHost("postgresql://user:pass@127.0.0.1:5432/db"), "127.0.0.1");
    assert.doesNotThrow(() =>
        assertSnapshotGeneratorDatabaseUrl("postgresql://u:p@localhost:5433/geo_core", false)
    );
    assert.throws(
        () =>
            assertSnapshotGeneratorDatabaseUrl(
                "postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
                false
            ),
        /Refusing snapshot generation/
    );
    assert.doesNotThrow(() =>
        assertSnapshotGeneratorDatabaseUrl(
            "postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
            true
        )
    );
});

test("manifest parse and ETag matching do not require a body", () => {
    const manifest = parseFieldBootstrapManifest({
        schemaVersion: 1,
        snapshotRevision: "v1-abc",
        generatedAt: "2026-09-07T00:00:00.000Z",
        checksumSha256: "a".repeat(64),
        uncompressedBytes: 10,
        compressedBytes: 4,
        counts: { routes: 1, variants: 2, stops: 3, routeStops: 4, routePaths: 2 },
    });
    assert.ok(manifest);
    const etag = fieldBootstrapEtag(manifest.checksumSha256);
    assert.equal(ifNoneMatchHits(etag, etag), true);
    assert.equal(ifNoneMatchHits(`W/${etag}`, etag), true);
    assert.equal(ifNoneMatchHits('"other"', etag), false);
});
