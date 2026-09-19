import type {
  CommunityModerationAction,
  CommunityPublicationStatus,
  CommunityVerificationStatus,
} from "./types";

/**
 * Valid moderation actions for the current publication/verification state.
 * Mirrors API `resolveAdminTransition` rules (without network calls).
 */
export function availableCommunityActions(input: {
  readonly publicationStatus: CommunityPublicationStatus;
  readonly verificationStatus: CommunityVerificationStatus;
}): readonly CommunityModerationAction[] {
  const { publicationStatus, verificationStatus } = input;

  if (publicationStatus === "removed") {
    return [];
  }

  if (
    publicationStatus === "resolved" ||
    publicationStatus === "expired" ||
    publicationStatus === "rejected"
  ) {
    return ["reopen", "remove"];
  }

  if (publicationStatus !== "published") {
    return [];
  }

  const actions: CommunityModerationAction[] = [];

  if (verificationStatus === "admin_verified") {
    actions.push("unverify");
  } else {
    actions.push("verify");
  }

  actions.push("resolve", "reject", "expire", "remove");
  return actions;
}

/** Primary trust/lifecycle action for the detail toolbar. */
export function primaryCommunityAction(
  actions: readonly CommunityModerationAction[],
): CommunityModerationAction | null {
  if (actions.includes("verify")) return "verify";
  if (actions.includes("unverify")) return "unverify";
  if (actions.includes("reopen")) return "reopen";
  return actions[0] ?? null;
}

export function secondaryCommunityActions(
  actions: readonly CommunityModerationAction[],
): readonly CommunityModerationAction[] {
  const primary = primaryCommunityAction(actions);
  if (!primary) return [];
  return actions.filter((action) => action !== primary);
}

/** Short contextual CTA label for list rows. */
export function contextualListActionLabel(input: {
  readonly publicationStatus: CommunityPublicationStatus;
  readonly verificationStatus: CommunityVerificationStatus;
}): string {
  if (
    input.publicationStatus === "published" &&
    input.verificationStatus === "unverified"
  ) {
    return "Review";
  }
  if (
    input.publicationStatus === "resolved" ||
    input.publicationStatus === "expired" ||
    input.publicationStatus === "rejected"
  ) {
    return "Reopen";
  }
  return "Open";
}
