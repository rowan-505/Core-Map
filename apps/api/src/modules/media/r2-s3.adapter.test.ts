import assert from "node:assert/strict";
import test from "node:test";

import { shouldForcePathStyle } from "./r2-s3.adapter.js";

test("loopback object-store endpoints use path-style URLs", () => {
    assert.equal(shouldForcePathStyle("http://127.0.0.1:59000"), true);
    assert.equal(shouldForcePathStyle("http://localhost:9000"), true);
    assert.equal(shouldForcePathStyle("https://abc.r2.cloudflarestorage.com"), false);
});
