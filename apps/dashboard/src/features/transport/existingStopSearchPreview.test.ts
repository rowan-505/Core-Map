import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    cameraPaddingForOverlay,
    candidateFocusZoom,
    existingStopSearchPreviewPoints,
    isFiniteLngLat,
} from "./existingStopSearchPreview.js";

describe("existingStopSearchPreviewPoints", () => {
    it("keeps finite coordinates and skips malformed rows", () => {
        assert.deepEqual(
            existingStopSearchPreviewPoints([
                { public_id: "ok", lon: 96.16, lat: 16.78 },
                { public_id: "nulls", lon: null, lat: null },
                { public_id: "nan", lon: Number.NaN, lat: 16 },
                { public_id: "inf", lon: 96, lat: Number.POSITIVE_INFINITY },
            ]),
            [{ publicId: "ok", lng: 96.16, lat: 16.78 }],
        );
    });

    it("rejects non-numeric coordinates", () => {
        assert.equal(isFiniteLngLat("96", 16), false);
        assert.equal(isFiniteLngLat(96, 16), true);
    });
});

describe("candidateFocusZoom", () => {
    it("uses zoom 16 when the map is farther out", () => {
        assert.equal(candidateFocusZoom(11), 16);
    });

    it("does not zoom out when already closer than 16", () => {
        assert.equal(candidateFocusZoom(17.4), 17.4);
        assert.equal(candidateFocusZoom(16), 16);
    });
});

describe("cameraPaddingForOverlay", () => {
    const map = { left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 };

    it("pads the left edge when the overlay covers the left of the map", () => {
        const overlay = { left: 0, top: 0, right: 400, bottom: 700, width: 400, height: 700 };
        const padding = cameraPaddingForOverlay(map, overlay);
        assert.equal(padding.left, 424);
        assert.equal(padding.right, 24);
        assert.equal(padding.top, 24);
        assert.equal(padding.bottom, 24);
    });

    it("pads the bottom edge for a bottom sheet overlay", () => {
        const overlay = { left: 0, top: 400, right: 1000, bottom: 700, width: 1000, height: 300 };
        const padding = cameraPaddingForOverlay(map, overlay);
        assert.equal(padding.bottom, 324);
        assert.equal(padding.left, 24);
    });
});
