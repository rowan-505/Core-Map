import assert from "node:assert/strict";
import test from "node:test";

import { publicErrorCode } from "./public-error-code.js";
import { resolveRequestId } from "./http-server.js";

test("field and media errors use stable codes", () => {
    assert.equal(
        publicErrorCode({ urlPath: "/field/bootstrap", statusCode: 400, hasValidation: true }),
        "VALIDATION_ERROR"
    );
    assert.equal(publicErrorCode({ urlPath: "/field/reports", statusCode: 401 }), "UNAUTHORIZED");
    assert.equal(publicErrorCode({ urlPath: "/media/uploads", statusCode: 403 }), "FORBIDDEN");
    assert.equal(
        publicErrorCode({ urlPath: "/field/survey-sessions/x", statusCode: 404 }),
        "SESSION_NOT_FOUND"
    );
    assert.equal(publicErrorCode({ urlPath: "/field/reports/x", statusCode: 404 }), "NOT_FOUND");
    assert.equal(publicErrorCode({ urlPath: "/field/bootstrap", statusCode: 429 }), "RATE_LIMITED");
    assert.equal(publicErrorCode({ urlPath: "/auth/login", statusCode: 429 }), "RATE_LIMITED");
    assert.equal(publicErrorCode({ urlPath: "/field/reports", statusCode: 413 }), "PAYLOAD_TOO_LARGE");
});

test("non-field routes keep the generic { message } envelope except rate/size", () => {
    assert.equal(publicErrorCode({ urlPath: "/places", statusCode: 400 }), null);
    assert.equal(publicErrorCode({ urlPath: "/places", statusCode: 500 }), null);
});

test("resolveRequestId accepts a safe client id and otherwise mints a uuid", () => {
    assert.equal(resolveRequestId("req-pilot-1"), "req-pilot-1");
    assert.notEqual(resolveRequestId("not a valid id"), "not a valid id");
    assert.match(resolveRequestId(undefined), /^[0-9a-f-]{36}$/i);
});
