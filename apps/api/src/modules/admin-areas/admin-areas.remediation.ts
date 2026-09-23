/**
 * MIMU remediation helpers.
 *
 * Unconditional production gate: mimu_placeholder geometry must never become
 * publicly usable without a later explicit publication approval. This module
 * always blocks public eligibility while geometry_source is mimu_placeholder
 * or licence is permission_pending.
 */

export const REMEDIATION_DECISIONS = [
    "keep_database_only",
    "replace_source",
    "approximate",
    "needs_evidence",
    "reject",
] as const;

export type RemediationDecision = (typeof REMEDIATION_DECISIONS)[number];

export const EVIDENCE_STATUSES = ["none", "has_evidence", "needs_evidence"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export type RemediationEvidenceItem = {
    type: string;
    value: string;
    label: string;
    note?: string | null;
    captured_at: string;
    storage_path?: string | null;
    sha256?: string | null;
};

export type RemediationEvidence = {
    items: RemediationEvidenceItem[];
} | null;

const BLOCKED_LICENSES = new Set(["permission_pending", ""]);
const PUBLISHABLE_SOURCES = new Set(["coremap_manual", "government", "osm"]);

export function isMimuPlaceholderSource(geometrySource: string | null | undefined): boolean {
    return (geometrySource ?? "").trim().toLowerCase() === "mimu_placeholder";
}

/**
 * Hard gate: placeholders and pending licence are never public-eligible.
 * Even after replace_source, caller must still pass a non-placeholder source.
 */
export function isPublicEligible(input: {
    geometry_source: string | null | undefined;
    source_license_status: string | null | undefined;
    remediation_decision: string | null | undefined;
    verification_status: string | null | undefined;
}): boolean {
    if (isMimuPlaceholderSource(input.geometry_source)) {
        return false;
    }
    const source = (input.geometry_source ?? "").trim().toLowerCase();
    if (!PUBLISHABLE_SOURCES.has(source)) {
        return false;
    }
    const license = (input.source_license_status ?? "").trim().toLowerCase();
    if (BLOCKED_LICENSES.has(license) || !license) {
        return false;
    }
    const decision = (input.remediation_decision ?? "").trim().toLowerCase();
    if (
        decision === "reject" ||
        decision === "needs_evidence" ||
        decision === "keep_database_only"
    ) {
        return false;
    }
    const verification = (input.verification_status ?? "").trim().toLowerCase();
    if (verification === "rejected") {
        return false;
    }
    return true;
}

/** Resolve whether requested is_public_usable is allowed. */
export function resolvePublicUsable(args: {
    requested: boolean | undefined;
    eligible: boolean;
}): { is_public_usable: boolean; blocked: boolean } {
    if (args.requested === true && !args.eligible) {
        return { is_public_usable: false, blocked: true };
    }
    if (args.requested === true && args.eligible) {
        // Explicit production publication still requires a separate approval workflow.
        // Remediaton endpoint never turns public on automatically.
        return { is_public_usable: false, blocked: true };
    }
    return { is_public_usable: false, blocked: false };
}

export function evidenceStatusFromPayload(
    evidence: RemediationEvidence | null | undefined,
    decision: string | null | undefined
): EvidenceStatus {
    if ((decision ?? "").trim().toLowerCase() === "needs_evidence") {
        return "needs_evidence";
    }
    const items = evidence?.items;
    if (Array.isArray(items) && items.length > 0) {
        return "has_evidence";
    }
    return "none";
}

export type RemediationApplyPlan = {
    remediation_decision: RemediationDecision;
    geometry_source: string | null;
    source_license_status: string | null;
    verification_status: string;
    boundary_status: string | null;
    is_active: boolean;
    is_public_usable: false;
    require_geometry: boolean;
    mark_unverified: boolean;
};

export function planRemediationDecision(args: {
    decision: RemediationDecision;
    existing: {
        geometry_source: string | null;
        source_license_status: string | null;
        verification_status: string;
        boundary_status: string | null;
        is_active: boolean;
    };
    nextGeometrySource?: "coremap_manual" | "government" | "osm";
    licenseForSource: (source: "coremap_manual" | "government" | "osm") => string;
}): RemediationApplyPlan {
    const { decision, existing, nextGeometrySource, licenseForSource } = args;

    switch (decision) {
        case "keep_database_only":
            return {
                remediation_decision: decision,
                geometry_source: existing.geometry_source,
                source_license_status: existing.source_license_status,
                verification_status:
                    existing.verification_status === "rejected"
                        ? existing.verification_status
                        : "needs_fix",
                boundary_status: existing.boundary_status,
                is_active: existing.is_active,
                is_public_usable: false,
                require_geometry: false,
                mark_unverified: false,
            };
        case "replace_source": {
            const source = nextGeometrySource ?? "coremap_manual";
            return {
                remediation_decision: decision,
                geometry_source: source,
                source_license_status: licenseForSource(source),
                verification_status: "needs_fix",
                boundary_status: existing.boundary_status,
                is_active: true,
                is_public_usable: false,
                require_geometry: true,
                mark_unverified: true,
            };
        }
        case "approximate": {
            const source = nextGeometrySource ?? "coremap_manual";
            return {
                remediation_decision: decision,
                geometry_source: source,
                source_license_status: licenseForSource(source),
                verification_status: "needs_fix",
                boundary_status: "approximate",
                is_active: true,
                is_public_usable: false,
                require_geometry: false,
                mark_unverified: true,
            };
        }
        case "needs_evidence":
            return {
                remediation_decision: decision,
                geometry_source: existing.geometry_source,
                source_license_status: existing.source_license_status,
                verification_status: "needs_fix",
                boundary_status: existing.boundary_status,
                is_active: existing.is_active,
                is_public_usable: false,
                require_geometry: false,
                mark_unverified: false,
            };
        case "reject":
            return {
                remediation_decision: decision,
                geometry_source: existing.geometry_source,
                source_license_status: existing.source_license_status,
                verification_status: "rejected",
                boundary_status: existing.boundary_status,
                is_active: false,
                is_public_usable: false,
                require_geometry: false,
                mark_unverified: true,
            };
        default: {
            const _exhaustive: never = decision;
            throw new Error(`Unknown remediation decision: ${_exhaustive}`);
        }
    }
}
