/** Admin geography browser types (API DTOs). */

export type RemediationDecision =
    | "keep_database_only"
    | "replace_source"
    | "approximate"
    | "needs_evidence"
    | "reject";

export type EvidenceStatus = "none" | "has_evidence" | "needs_evidence";

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
};

export type AdminGeographyListItem = {
    id: string;
    public_id: string;
    parent_id: string | null;
    canonical_name: string;
    slug: string;
    admin_level_id: string;
    admin_level_code: string;
    admin_area_type_id: string | null;
    admin_area_type_code: string | null;
    is_active: boolean;
    verification_status: string;
    address_usage: string;
    boundary_status: string;
    is_official_boundary: boolean;
    is_public_usable: boolean | null;
    geometry_source: string | null;
    source_license_status?: string | null;
    remediation_decision?: string | null;
    evidence?: RemediationEvidence | null;
    public_eligible?: boolean;
    updated_at: string;
    bbox: [number, number, number, number] | null;
    centroid: { type: "Point"; coordinates: [number, number] } | null;
};

export type AdminGeographyPage = {
    items: AdminGeographyListItem[];
    total: number;
    limit: number;
    offset: number;
};

export type AdminGeographyName = {
    id: string;
    language_code: string | null;
    name: string;
    name_type: string;
    is_primary: boolean;
};

export type AdminGeographyAncestor = {
    id: string;
    canonical_name: string;
    admin_level_code: string;
    depth: number;
};

export type AdminGeographyChild = {
    id: string;
    canonical_name: string;
    admin_level_code: string;
    is_active: boolean;
};

export type AdminGeographyDetail = AdminGeographyListItem & {
    child_count: number;
    postal_count: number;
    verification_note: string | null;
    source_refs?: unknown | null;
    names: AdminGeographyName[];
    ancestors: AdminGeographyAncestor[];
    geometry: unknown | null;
};

export type AdminGeographyPostalRow = {
    postal_code: string;
    region_name_en: string | null;
    region_name_my: string | null;
    township_name_en: string | null;
    township_name_my: string | null;
    locality_name_en: string | null;
    locality_name_my: string | null;
    locality_type: string | null;
    township_admin_area_id: string | null;
    local_admin_area_id: string | null;
    match_status: string;
    match_method: string | null;
    source_name: string;
    source_version: string;
};

export type AdminGeographySummary = {
    official_first_level: number;
    official_township: number;
    ward_count: number;
    village_tract_count: number;
    settlement_count: number;
    placeholder_count: number;
    postal_linked_local: number;
    postal_linked_township_only: number;
    postal_unmatched_review: number;
    targets: {
        official_first_level: number;
        official_township: number;
    };
};

export type AdminGeographyListParams = {
    limit?: number;
    offset?: number;
    q?: string;
    level?: string;
    type?: string;
    parent?: string;
    status?: string;
    geometrySource?: string;
    official?: boolean;
    public?: boolean;
    remediationDecision?: RemediationDecision;
    evidenceStatus?: EvidenceStatus;
};

export type AdminGeographyTileFilters = {
    level?: string;
    type?: string;
    status?: string;
    geometry_source?: string;
    official?: boolean;
    public?: boolean;
};

/** Preset filter chips shown in the sidebar. */
export type AdminGeographyFilterKey =
    | "country"
    | "state_region"
    | "district"
    | "self_administered_zone"
    | "township"
    | "town"
    | "ward"
    | "village_tract"
    | "special_area"
    | "settlement"
    | "official_only"
    | "reference_only"
    | "mimu_placeholder"
    | "needs_fix"
    | "public_only"
    | "non_public"
    | "decision_reject"
    | "evidence_none"
    | "evidence_has";

export type AdminGeographyMode = "browse" | "mimu-remediation";
