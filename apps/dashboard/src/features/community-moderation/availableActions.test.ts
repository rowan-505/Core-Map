import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  availableCommunityActions,
  contextualListActionLabel,
  primaryCommunityAction,
  secondaryCommunityActions,
} from "./availableActions";

describe("availableCommunityActions", () => {
  it("offers verify for published unverified posts", () => {
    assert.deepEqual(
      availableCommunityActions({
        publicationStatus: "published",
        verificationStatus: "unverified",
      }),
      ["verify", "resolve", "reject", "expire", "remove"],
    );
  });

  it("offers unverify only for CoreMap Verified published posts", () => {
    assert.deepEqual(
      availableCommunityActions({
        publicationStatus: "published",
        verificationStatus: "admin_verified",
      }),
      ["unverify", "resolve", "reject", "expire", "remove"],
    );
  });

  it("offers reopen for resolved / expired / rejected", () => {
    assert.deepEqual(
      availableCommunityActions({
        publicationStatus: "resolved",
        verificationStatus: "community_confirmed",
      }),
      ["reopen", "remove"],
    );
  });

  it("offers no actions for removed posts", () => {
    assert.deepEqual(
      availableCommunityActions({
        publicationStatus: "removed",
        verificationStatus: "unverified",
      }),
      [],
    );
  });
});

describe("primary and secondary community actions", () => {
  it("makes Verify the primary action for needs-review posts", () => {
    const actions = availableCommunityActions({
      publicationStatus: "published",
      verificationStatus: "unverified",
    });
    assert.equal(primaryCommunityAction(actions), "verify");
    assert.deepEqual(secondaryCommunityActions(actions), [
      "resolve",
      "reject",
      "expire",
      "remove",
    ]);
  });

  it("makes Reopen the primary action for closed posts", () => {
    const actions = availableCommunityActions({
      publicationStatus: "expired",
      verificationStatus: "unverified",
    });
    assert.equal(primaryCommunityAction(actions), "reopen");
    assert.deepEqual(secondaryCommunityActions(actions), ["remove"]);
  });
});

describe("contextualListActionLabel", () => {
  it("labels unverified live posts as Review", () => {
    assert.equal(
      contextualListActionLabel({
        publicationStatus: "published",
        verificationStatus: "unverified",
      }),
      "Review",
    );
  });
});
