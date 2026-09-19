import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCreatePlaceUrl,
  canSelectPlaceForAttraction,
} from "./CorePlacePicker";

describe("CorePlacePicker helpers", () => {
  it("builds create-place URL with township adminAreaId", () => {
    const url = buildCreatePlaceUrl("1001");
    assert.match(url, /\/dashboard\/core-review\/places\/new/);
    assert.match(url, /adminAreaId=1001/);
  });

  it("builds create-place URL without township when missing", () => {
    const url = buildCreatePlaceUrl(null);
    assert.match(url, /\/dashboard\/core-review\/places\/new$/);
    assert.equal(url.includes("adminAreaId"), false);
  });

  it("blocks attraction selection when place already has a tourism profile", () => {
    assert.equal(canSelectPlaceForAttraction({ has_tourism_profile: true }), false);
    assert.equal(canSelectPlaceForAttraction({ has_tourism_profile: false }), true);
    assert.equal(canSelectPlaceForAttraction({}), true);
  });
});
