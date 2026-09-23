import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    evidenceStatusFromPayload,
    isMimuPlaceholderSource,
    isPublicEligible,
    planRemediationDecision,
    resolvePublicUsable,
} from "./admin-areas.remediation.js";
import { licenseStatusForGeometrySource } from "./admin-areas.geography.schema.js";

describe("MIMU remediation public eligibility gate", () => {
    it("unconditionally blocks mimu_placeholder", () => {
        assert.equal(isMimuPlaceholderSource("mimu_placeholder"), true);
        assert.equal(
            isPublicEligible({
                geometry_source: "mimu_placeholder",
                source_license_status: "coremap_internal",
                remediation_decision: "replace_source",
                verification_status: "verified",
            }),
            false
        );
    });

    it("blocks permission_pending licence", () => {
        assert.equal(
            isPublicEligible({
                geometry_source: "coremap_manual",
                source_license_status: "permission_pending",
                remediation_decision: "approximate",
                verification_status: "needs_fix",
            }),
            false
        );
    });

    it("blocks keep_database_only / needs_evidence / reject", () => {
        for (const decision of ["keep_database_only", "needs_evidence", "reject"] as const) {
            assert.equal(
                isPublicEligible({
                    geometry_source: "coremap_manual",
                    source_license_status: "coremap_internal",
                    remediation_decision: decision,
                    verification_status: "needs_fix",
                }),
                false
            );
        }
    });

    it("allows eligible replace_source with truthful licence", () => {
        assert.equal(
            isPublicEligible({
                geometry_source: "government",
                source_license_status: "government_source",
                remediation_decision: "replace_source",
                verification_status: "needs_fix",
            }),
            true
        );
    });

    it("never turns public usable on while gate is active", () => {
        const result = resolvePublicUsable({ requested: true, eligible: true });
        assert.equal(result.is_public_usable, false);
        assert.equal(result.blocked, true);
    });
});

describe("planRemediationDecision", () => {
    const existing = {
        geometry_source: "mimu_placeholder",
        source_license_status: "permission_pending",
        verification_status: "needs_fix",
        boundary_status: "approximate",
        is_active: true,
    };

    it("replace_source requires geometry and clears placeholder source", () => {
        const plan = planRemediationDecision({
            decision: "replace_source",
            existing,
            nextGeometrySource: "coremap_manual",
            licenseForSource: licenseStatusForGeometrySource,
        });
        assert.equal(plan.require_geometry, true);
        assert.equal(plan.geometry_source, "coremap_manual");
        assert.equal(plan.is_public_usable, false);
    });

    it("reject deactivates the area", () => {
        const plan = planRemediationDecision({
            decision: "reject",
            existing,
            licenseForSource: licenseStatusForGeometrySource,
        });
        assert.equal(plan.is_active, false);
        assert.equal(plan.verification_status, "rejected");
        assert.equal(plan.is_public_usable, false);
    });
});

describe("evidenceStatusFromPayload", () => {
    it("detects needs_evidence decision", () => {
        assert.equal(evidenceStatusFromPayload({ items: [] }, "needs_evidence"), "needs_evidence");
    });

    it("detects has_evidence items", () => {
        assert.equal(
            evidenceStatusFromPayload(
                {
                    items: [
                        {
                            type: "note",
                            value: "survey",
                            label: "Field note",
                            captured_at: "2026-09-22T00:00:00Z",
                        },
                    ],
                },
                null
            ),
            "has_evidence"
        );
    });
});
