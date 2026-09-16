import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMapStyleUsable } from "./isMapStyleUsable.js";

describe("isMapStyleUsable", () => {
  it("rejects null and maps without style", () => {
    assert.equal(isMapStyleUsable(null), false);
    assert.equal(isMapStyleUsable(undefined), false);
    assert.equal(isMapStyleUsable({ style: undefined } as never), false);
  });

  it("accepts maps with a style object", () => {
    assert.equal(isMapStyleUsable({ style: {} } as never), true);
  });
});
