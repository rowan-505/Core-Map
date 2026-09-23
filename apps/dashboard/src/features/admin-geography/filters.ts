import type {
    AdminGeographyFilterKey,
    AdminGeographyListParams,
    AdminGeographyTileFilters,
} from "./types";

export type AdminGeographyFilterChip = {
    key: AdminGeographyFilterKey;
    label: string;
    group: "level" | "type" | "flag" | "decision" | "evidence";
};

export const ADMIN_GEOGRAPHY_FILTER_CHIPS: readonly AdminGeographyFilterChip[] = [
    { key: "country", label: "Country", group: "level" },
    { key: "state_region", label: "State / region", group: "level" },
    { key: "district", label: "District", group: "level" },
    { key: "self_administered_zone", label: "Self-administered area", group: "level" },
    { key: "township", label: "Township", group: "level" },
    { key: "town", label: "Town", group: "level" },
    { key: "ward", label: "Ward", group: "type" },
    { key: "village_tract", label: "Village tract", group: "type" },
    { key: "special_area", label: "Special / reference area", group: "type" },
    { key: "settlement", label: "Village / settlement", group: "type" },
    { key: "official_only", label: "Official only", group: "flag" },
    { key: "reference_only", label: "Extra / reference only", group: "flag" },
    { key: "mimu_placeholder", label: "MIMU placeholders only", group: "flag" },
    { key: "needs_fix", label: "Needs fix", group: "flag" },
    { key: "public_only", label: "Public", group: "flag" },
    { key: "non_public", label: "Non-public", group: "flag" },
    { key: "decision_reject", label: "Rejected", group: "decision" },
    { key: "evidence_none", label: "No items yet", group: "evidence" },
    { key: "evidence_has", label: "Has items", group: "evidence" },
] as const;

const LEVEL_KEYS = new Set<AdminGeographyFilterKey>([
    "country",
    "state_region",
    "district",
    "self_administered_zone",
    "township",
    "town",
]);

const TYPE_KEYS = new Set<AdminGeographyFilterKey>(["ward", "village_tract", "special_area"]);

const DECISION_KEYS = new Set<AdminGeographyFilterKey>(["decision_reject"]);

const EVIDENCE_KEYS = new Set<AdminGeographyFilterKey>(["evidence_none", "evidence_has"]);

const DECISION_PARAM: Record<string, AdminGeographyListParams["remediationDecision"]> = {
    decision_reject: "reject",
};

/**
 * Map active chips → list API params.
 * Level chips are mutually exclusive with each other; type chips likewise.
 * Flag chips may combine with level/type (except conflicting pairs).
 */
export function filtersToListParams(
    active: ReadonlySet<AdminGeographyFilterKey>,
    extras: { q?: string; parent?: string; limit?: number; offset?: number },
): AdminGeographyListParams | { kind: "settlements_unsupported" } {
    if (active.has("settlement")) {
        return { kind: "settlements_unsupported" };
    }

    const params: AdminGeographyListParams = {
        limit: extras.limit ?? 50,
        offset: extras.offset ?? 0,
        q: extras.q,
        parent: extras.parent,
    };

    for (const key of active) {
        if (LEVEL_KEYS.has(key)) {
            params.level = key;
        } else if (TYPE_KEYS.has(key)) {
            params.type = key;
            if (key === "ward" || key === "village_tract") {
                params.level = "ward_village_tract";
            }
        } else if (key === "official_only") {
            params.official = true;
        } else if (key === "reference_only") {
            params.official = false;
        } else if (key === "mimu_placeholder") {
            params.geometrySource = "mimu_placeholder";
        } else if (key === "needs_fix") {
            params.status = "needs_fix";
        } else if (key === "public_only") {
            params.public = true;
        } else if (key === "non_public") {
            params.public = false;
        } else if (DECISION_KEYS.has(key)) {
            params.remediationDecision = DECISION_PARAM[key];
        } else if (key === "evidence_none") {
            params.evidenceStatus = "none";
        } else if (key === "evidence_has") {
            params.evidenceStatus = "has_evidence";
        }
    }

    return params;
}

export function filtersToTileFilters(
    active: ReadonlySet<AdminGeographyFilterKey>,
): AdminGeographyTileFilters | null {
    if (active.has("settlement")) {
        return null;
    }
    const list = filtersToListParams(active, {});
    if ("kind" in list) return null;
    return {
        level: list.level,
        type: list.type,
        status: list.status,
        geometry_source: list.geometrySource,
        official: list.official,
        public: list.public,
    };
}

/** Toggle a chip with mutual exclusion within level/type groups and conflicting flags. */
export function toggleFilterChip(
    current: ReadonlySet<AdminGeographyFilterKey>,
    key: AdminGeographyFilterKey,
): Set<AdminGeographyFilterKey> {
    const next = new Set(current);
    if (next.has(key)) {
        next.delete(key);
        return next;
    }

    if (LEVEL_KEYS.has(key)) {
        for (const k of LEVEL_KEYS) next.delete(k);
        next.delete("ward");
        next.delete("village_tract");
        next.delete("special_area");
        next.delete("settlement");
    } else if (TYPE_KEYS.has(key) || key === "settlement") {
        for (const k of LEVEL_KEYS) next.delete(k);
        for (const k of TYPE_KEYS) next.delete(k);
        next.delete("settlement");
    } else if (key === "official_only") {
        next.delete("reference_only");
    } else if (key === "reference_only") {
        next.delete("official_only");
    } else if (key === "public_only") {
        next.delete("non_public");
    } else if (key === "non_public") {
        next.delete("public_only");
    } else if (DECISION_KEYS.has(key)) {
        for (const k of DECISION_KEYS) next.delete(k);
    } else if (EVIDENCE_KEYS.has(key)) {
        for (const k of EVIDENCE_KEYS) next.delete(k);
    }

    next.add(key);
    return next;
}

export function isPermissionDeniedError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
        message.includes("403") ||
        message.includes("forbidden") ||
        message.includes("permission") ||
        message.includes("dashboard access")
    );
}

export function geographyErrorMessage(error: unknown): string {
    if (isPermissionDeniedError(error)) {
        return "You do not have permission to view admin geography.";
    }
    if (error instanceof Error && error.message.trim()) return error.message;
    return "Request failed";
}

export function looksLikePostalQuery(q: string): boolean {
    return /^[0-9]{3,7}$/.test(q.trim());
}

export function defaultFiltersForMode(mode: "browse" | "mimu-remediation"): Set<AdminGeographyFilterKey> {
    if (mode === "mimu-remediation") {
        return new Set<AdminGeographyFilterKey>(["mimu_placeholder", "non_public"]);
    }
    return new Set<AdminGeographyFilterKey>(["township"]);
}
