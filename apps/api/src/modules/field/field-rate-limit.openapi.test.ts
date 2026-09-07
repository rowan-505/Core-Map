import assert from "node:assert/strict";
import test from "node:test";

import { getFieldBootstrapSchema, postFieldReportSchema } from "./field.openapi.js";

test("field report 429 schema preserves the structured RATE_LIMITED code", () => {
    const response = postFieldReportSchema.response as Record<number, {
        required?: readonly string[];
        properties?: Record<string, unknown>;
    }>;
    const schema = response[429];
    assert.ok(schema);
    assert.deepEqual(schema.required, ["code", "message"]);
    assert.ok(schema.properties?.code);
    assert.ok(schema.properties?.message);
});

test("field bootstrap schema documents 503 when the snapshot is missing", () => {
    const response = getFieldBootstrapSchema.response as Record<number, {
        required?: readonly string[];
        properties?: Record<string, unknown>;
    }>;
    assert.ok(response[503]);
    assert.deepEqual(response[503].required, ["code", "message"]);
});
