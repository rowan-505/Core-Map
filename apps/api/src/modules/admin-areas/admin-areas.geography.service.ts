import type { JwtUser } from "../../plugins/auth.js";
import type { PostalCodesRepository } from "../addresses/postal-codes.repo.js";
import {
    buildBoundaryChecks,
    isGenericOrBlankAdminName,
    m2ToHectares,
} from "./admin-areas.boundary-review.js";
import type {
    AdminAreaGeometryPatchBody,
    AdminAreaRemediationPatchBody,
    AdminAreaValidateGeometryBody,
    AdminAreasListQuery,
} from "./admin-areas.geography.schema.js";
import {
    licenseStatusForGeometrySource,
    resolveGeometrySource,
} from "./admin-areas.geography.schema.js";
import {
    AdminAreasGeographyRepository,
    type AdminAreaBoundaryContextMemberRow,
    type AdminAreaDetailRow,
    type AdminAreaListRow,
} from "./admin-areas.geography.repo.js";
import {
    isPublicEligible,
    planRemediationDecision,
    resolvePublicUsable,
    type RemediationEvidence,
} from "./admin-areas.remediation.js";

function mapBoundaryMember(row: AdminAreaBoundaryContextMemberRow) {
    return {
        id: row.id.toString(),
        public_id: row.public_id,
        display_name: row.display_name,
        type: row.type_code,
        admin_level_code: row.admin_level_code,
        geometry_source: row.geometry_source,
        verification_status: row.verification_status,
        geometry: row.geometry,
        bbox: row.bbox,
        name_warning: isGenericOrBlankAdminName(row.display_name),
    };
}

function mapListItem(row: AdminAreaListRow) {
    const publicEligible = isPublicEligible({
        geometry_source: row.geometry_source,
        source_license_status: row.source_license_status,
        remediation_decision: row.remediation_decision,
        verification_status: row.verification_status,
    });
    return {
        id: row.id.toString(),
        public_id: row.public_id,
        parent_id: row.parent_id === null ? null : row.parent_id.toString(),
        canonical_name: row.canonical_name,
        slug: row.slug,
        admin_level_id: row.admin_level_id.toString(),
        admin_level_code: row.admin_level_code,
        admin_area_type_id: row.admin_area_type_id === null ? null : row.admin_area_type_id.toString(),
        admin_area_type_code: row.admin_area_type_code,
        is_active: row.is_active,
        verification_status: row.verification_status,
        address_usage: row.address_usage,
        boundary_status: row.boundary_status,
        is_official_boundary: row.is_official_boundary,
        is_public_usable: row.is_public_usable,
        geometry_source: row.geometry_source,
        source_license_status: row.source_license_status,
        remediation_decision: row.remediation_decision,
        evidence: row.evidence,
        public_eligible: publicEligible,
        updated_at:
            row.updated_at instanceof Date
                ? row.updated_at.toISOString()
                : String(row.updated_at),
        bbox: row.bbox,
        centroid: row.centroid,
    };
}

function mapPostalRow(row: {
    postal_code: string;
    region_name_en: string | null;
    region_name_my: string | null;
    township_name_en: string | null;
    township_name_my: string | null;
    locality_name_en: string | null;
    locality_name_my: string | null;
    locality_type: string | null;
    township_admin_area_id: bigint | null;
    local_admin_area_id: bigint | null;
    match_status: string;
    match_method: string | null;
    source_name: string;
    source_version: string;
}) {
    return {
        postal_code: row.postal_code,
        region_name_en: row.region_name_en,
        region_name_my: row.region_name_my,
        township_name_en: row.township_name_en,
        township_name_my: row.township_name_my,
        locality_name_en: row.locality_name_en,
        locality_name_my: row.locality_name_my,
        locality_type: row.locality_type,
        township_admin_area_id:
            row.township_admin_area_id == null ? null : String(row.township_admin_area_id),
        local_admin_area_id: row.local_admin_area_id == null ? null : String(row.local_admin_area_id),
        match_status: row.match_status,
        match_method: row.match_method,
        source_name: row.source_name,
        source_version: row.source_version,
    };
}

export class AdminAreaNotFoundError extends Error {
    constructor() {
        super("ADMIN_AREA_NOT_FOUND");
        this.name = "AdminAreaNotFoundError";
    }
}

export type AdminAreaGeometryIssue = { path: string; message: string };

export class AdminAreaGeometryValidationError extends Error {
    readonly statusCode = 400;
    readonly issues: AdminAreaGeometryIssue[];

    constructor(message: string, issues: AdminAreaGeometryIssue[]) {
        super(message);
        this.name = "AdminAreaGeometryValidationError";
        this.issues = issues;
    }
}

export class AdminAreaGeometryConflictError extends Error {
    readonly statusCode = 409;

    constructor(message = "Admin area was modified by another user. Reload and try again.") {
        super(message);
        this.name = "AdminAreaGeometryConflictError";
    }
}

function editorIdFromJwt(user: JwtUser | undefined): bigint | null {
    const raw = user?.id ?? user?.sub;
    if (!raw || !/^\d+$/.test(String(raw))) {
        return null;
    }
    return BigInt(String(raw));
}

export class AdminAreasGeographyService {
    constructor(
        private readonly geographyRepo: AdminAreasGeographyRepository,
        private readonly postalRepo: PostalCodesRepository
    ) {}

    async list(query: AdminAreasListQuery) {
        const result = await this.geographyRepo.listAdminAreas({
            limit: query.limit,
            offset: query.offset,
            q: query.q,
            level: query.level,
            type: query.type,
            parentId: query.parent ? BigInt(query.parent) : undefined,
            status: query.status,
            geometrySource: resolveGeometrySource(query),
            official: query.official,
            isPublic: query.public,
            remediationDecision: query.remediation_decision,
            evidenceStatus: query.evidence_status,
        });

        return {
            items: result.rows.map(mapListItem),
            total: result.total,
            limit: query.limit,
            offset: query.offset,
        };
    }

    async getById(id: string, includeGeometry: boolean) {
        const detail = await this.geographyRepo.getAdminAreaDetail({
            id: BigInt(id),
            includeGeometry,
        });
        if (!detail) {
            throw new AdminAreaNotFoundError();
        }

        const [names, ancestors] = await Promise.all([
            this.geographyRepo.listNames(detail.id),
            this.geographyRepo.listAncestors(detail.id),
        ]);

        return this.mapDetail(detail, names, ancestors, includeGeometry);
    }

    async listChildren(
        id: string,
        query: { limit: number; offset: number; level?: string }
    ) {
        const exists = await this.geographyRepo.getAdminAreaDetail({
            id: BigInt(id),
            includeGeometry: false,
        });
        if (!exists) {
            throw new AdminAreaNotFoundError();
        }

        const result = await this.geographyRepo.listChildren({
            parentId: BigInt(id),
            limit: query.limit,
            offset: query.offset,
            level: query.level,
        });

        return {
            items: result.rows.map((row) => ({
                id: row.id.toString(),
                canonical_name: row.canonical_name,
                admin_level_code: row.admin_level_code,
                is_active: row.is_active,
            })),
            total: result.total,
            limit: query.limit,
            offset: query.offset,
        };
    }

    async listPostalCodesForAdminArea(
        id: string,
        query: { limit: number; offset: number; q?: string }
    ) {
        const exists = await this.geographyRepo.getAdminAreaDetail({
            id: BigInt(id),
            includeGeometry: false,
        });
        if (!exists) {
            throw new AdminAreaNotFoundError();
        }

        const result = await this.postalRepo.search({
            limit: query.limit,
            offset: query.offset,
            q: query.q,
            adminAreaId: BigInt(id),
        });

        return {
            items: result.rows.map(mapPostalRow),
            total: result.total,
            limit: query.limit,
            offset: query.offset,
        };
    }

    async searchPostalCodes(query: {
        limit: number;
        offset: number;
        q?: string;
        postal_code?: string;
        locality?: string;
        match_status?: string;
    }) {
        const result = await this.postalRepo.search({
            limit: query.limit,
            offset: query.offset,
            q: query.q,
            postalCode: query.postal_code,
            locality: query.locality,
            matchStatus: query.match_status,
        });

        return {
            items: result.rows.map(mapPostalRow),
            total: result.total,
            limit: query.limit,
            offset: query.offset,
        };
    }

    async getTile(
        z: number,
        x: number,
        y: number,
        filters: {
            level?: string;
            type?: string;
            status?: string;
            geometrySource?: string;
            official?: boolean;
            isPublic?: boolean;
        }
    ): Promise<Buffer> {
        return this.geographyRepo.queryAdminAreasMvt({
            z,
            x,
            y,
            level: filters.level,
            type: filters.type,
            status: filters.status,
            geometrySource: filters.geometrySource,
            official: filters.official,
            isPublic: filters.isPublic,
        });
    }

    async getSummary() {
        return this.geographyRepo.getGeographySummary();
    }

    async updateGeometry(
        id: string,
        body: AdminAreaGeometryPatchBody,
        user: JwtUser | undefined
    ) {
        const areaId = BigInt(id);
        const existing = await this.geographyRepo.getAdminAreaForGeometryEdit(areaId);
        if (!existing) {
            throw new AdminAreaNotFoundError();
        }

        const geojsonText = JSON.stringify(body.geometry);
        let analysis;
        try {
            analysis = await this.geographyRepo.analyzeAdminAreaGeometry(geojsonText);
        } catch {
            throw new AdminAreaGeometryValidationError("Geometry could not be parsed", [
                {
                    path: "geometry",
                    message:
                        "Invalid GeoJSON payload or incompatible geometry type for PostGIS ST_GeomFromGeoJSON.",
                },
            ]);
        }

        const issues: AdminAreaGeometryIssue[] = [];
        if (!analysis?.allowed_type) {
            issues.push({
                path: "geometry.type",
                message: "Geometry must be a Polygon or MultiPolygon in EPSG:4326.",
            });
        } else if (analysis.is_empty) {
            issues.push({
                path: "geometry",
                message: "Geometry must not be empty.",
            });
        } else if (!analysis.is_valid) {
            issues.push({
                path: "geometry",
                message: analysis.invalid_reason?.trim()
                    ? `Invalid geometry: ${analysis.invalid_reason}`
                    : "Geometry failed ST_IsValid (self-intersection or other topology error). ST_MakeValid is not applied automatically.",
            });
        } else if (!analysis.within_myanmar) {
            issues.push({
                path: "geometry.coordinates",
                message: "Geometry must lie within Myanmar bounds.",
            });
        } else if (analysis.area_m2 === null || !(analysis.area_m2 > 0)) {
            issues.push({
                path: "geometry",
                message: "Geometry must have a non-empty area.",
            });
        }
        if (analysis?.srid != null && analysis.srid !== 4326) {
            issues.push({
                path: "geometry",
                message: `Geometry SRID must be 4326 (got ${analysis.srid}).`,
            });
        }
        if (issues.length > 0) {
            throw new AdminAreaGeometryValidationError("Admin area geometry validation failed", issues);
        }

        const replacingPlaceholder =
            (existing.geometry_source ?? "").toLowerCase() === "mimu_placeholder";
        const requestedSource = body.geometry_source;
        const nextSourceRaw = replacingPlaceholder
            ? (requestedSource ?? "coremap_manual")
            : (requestedSource ?? existing.geometry_source ?? "coremap_manual");
        const allowedSources = new Set(["coremap_manual", "government", "osm"]);
        if (!allowedSources.has(nextSourceRaw)) {
            throw new AdminAreaGeometryValidationError("Invalid geometry_source", [
                {
                    path: "geometry_source",
                    message: "geometry_source must be coremap_manual, government, or osm.",
                },
            ]);
        }
        const typedSource = nextSourceRaw as "coremap_manual" | "government" | "osm";
        const nextLicense = replacingPlaceholder
            ? licenseStatusForGeometrySource(typedSource)
            : requestedSource
              ? licenseStatusForGeometrySource(typedSource)
              : (existing.source_license_status ?? licenseStatusForGeometrySource(typedSource));
        const nextVerification = replacingPlaceholder ? "needs_fix" : existing.verification_status;

        const expectedUpdatedAt = new Date(body.expected_updated_at);
        const beforeSnapshot = {
            id: existing.id.toString(),
            public_id: existing.public_id,
            canonical_name: existing.canonical_name,
            geometry_source: existing.geometry_source,
            source_license_status: existing.source_license_status,
            verification_status: existing.verification_status,
            updated_at: existing.updated_at.toISOString(),
            replaced_mimu_placeholder: replacingPlaceholder,
        };

        let result;
        try {
            result = await this.geographyRepo.updateAdminAreaGeometry({
                id: areaId,
                geojsonText,
                expectedUpdatedAt,
                geometrySource: typedSource,
                sourceLicenseStatus: nextLicense,
                verificationStatus: nextVerification,
                markUnverified: replacingPlaceholder,
                actorUserId: editorIdFromJwt(user),
                beforeSnapshot,
            });
        } catch (error) {
            if (error instanceof Error && error.message === "ADMIN_AREA_GEOMETRY_ANALYSIS_FAILED") {
                throw new AdminAreaGeometryValidationError("Admin area geometry validation failed", [
                    {
                        path: "geometry",
                        message: "Geometry failed final transaction validation; no changes were saved.",
                    },
                ]);
            }
            throw error;
        }

        if (!result) {
            throw new AdminAreaGeometryConflictError();
        }

        const row = result.updated;
        return {
            id: row.id.toString(),
            public_id: row.public_id,
            canonical_name: row.canonical_name,
            geometry_source: row.geometry_source,
            source_license_status: row.source_license_status,
            verification_status: row.verification_status,
            updated_at: row.updated_at.toISOString(),
            bbox: row.bbox,
            centroid: row.centroid,
            geometry: row.geom_geojson,
            replaced_mimu_placeholder: replacingPlaceholder,
        };
    }

    private mapDetail(
        detail: AdminAreaDetailRow,
        names: Awaited<ReturnType<AdminAreasGeographyRepository["listNames"]>>,
        ancestors: Awaited<ReturnType<AdminAreasGeographyRepository["listAncestors"]>>,
        includeGeometry: boolean
    ) {
        return {
            ...mapListItem(detail),
            child_count: Number(detail.child_count),
            postal_count: Number(detail.postal_count),
            verification_note: detail.verification_note,
            source_refs: detail.source_refs,
            names: names.map((n) => ({
                id: n.id.toString(),
                language_code: n.language_code,
                name: n.name,
                name_type: n.name_type,
                is_primary: n.is_primary,
            })),
            ancestors: ancestors.map((a) => ({
                id: a.id.toString(),
                canonical_name: a.canonical_name,
                admin_level_code: a.admin_level_code,
                depth: a.depth,
            })),
            geometry: includeGeometry ? detail.geom_geojson : null,
        };
    }

    async applyRemediation(
        id: string,
        body: AdminAreaRemediationPatchBody,
        user: JwtUser | undefined
    ) {
        const areaId = BigInt(id);
        const existing = await this.geographyRepo.getAdminAreaForGeometryEdit(areaId);
        if (!existing) {
            throw new AdminAreaNotFoundError();
        }

        const publicRequest = resolvePublicUsable({
            requested: body.is_public_usable,
            eligible: false,
        });
        if (publicRequest.blocked && body.is_public_usable === true) {
            throw new AdminAreaGeometryValidationError(
                "MIMU placeholder publication is blocked without explicit production approval",
                [
                    {
                        path: "is_public_usable",
                        message:
                            "Cannot set is_public_usable=true for MIMU remediation. Search/tiles/CDN publication requires a separate approval.",
                    },
                ]
            );
        }

        const plan = planRemediationDecision({
            decision: body.decision,
            existing: {
                geometry_source: existing.geometry_source,
                source_license_status: existing.source_license_status,
                verification_status: existing.verification_status,
                boundary_status: existing.boundary_status,
                is_active: existing.is_active,
            },
            nextGeometrySource: body.geometry_source,
            licenseForSource: licenseStatusForGeometrySource,
        });

        if (plan.require_geometry && !body.geometry) {
            throw new AdminAreaGeometryValidationError("Geometry is required for this decision", [
                {
                    path: "geometry",
                    message: "replace_source requires a Polygon or MultiPolygon geometry payload.",
                },
            ]);
        }

        let geojsonText: string | null = null;
        if (body.geometry) {
            geojsonText = JSON.stringify(body.geometry);
            let analysis;
            try {
                analysis = await this.geographyRepo.analyzeAdminAreaGeometry(geojsonText);
            } catch {
                throw new AdminAreaGeometryValidationError("Geometry could not be parsed", [
                    {
                        path: "geometry",
                        message:
                            "Invalid GeoJSON payload or incompatible geometry type for PostGIS ST_GeomFromGeoJSON.",
                    },
                ]);
            }
            const issues: AdminAreaGeometryIssue[] = [];
            if (!analysis?.allowed_type) {
                issues.push({
                    path: "geometry.type",
                    message: "Geometry must be a Polygon or MultiPolygon in EPSG:4326.",
                });
            } else if (analysis.is_empty) {
                issues.push({ path: "geometry", message: "Geometry must not be empty." });
            } else if (!analysis.is_valid) {
                issues.push({
                    path: "geometry",
                    message: analysis.invalid_reason?.trim()
                        ? `Invalid geometry: ${analysis.invalid_reason}`
                        : "Geometry failed ST_IsValid.",
                });
            } else if (!analysis.within_myanmar) {
                issues.push({
                    path: "geometry.coordinates",
                    message: "Geometry must lie within Myanmar bounds.",
                });
            } else if (analysis.area_m2 === null || !(analysis.area_m2 > 0)) {
                issues.push({ path: "geometry", message: "Geometry must have a non-empty area." });
            }
            if (issues.length > 0) {
                throw new AdminAreaGeometryValidationError("Admin area geometry validation failed", issues);
            }
        }

        let evidenceJson: string | null | undefined = undefined;
        if (body.evidence !== undefined) {
            evidenceJson =
                body.evidence === null ? null : JSON.stringify(body.evidence as RemediationEvidence);
        }

        const verificationNote =
            body.verification_note === undefined
                ? existing.verification_note
                : body.verification_note;

        const beforeSnapshot = {
            id: existing.id.toString(),
            public_id: existing.public_id,
            canonical_name: existing.canonical_name,
            geometry_source: existing.geometry_source,
            source_license_status: existing.source_license_status,
            verification_status: existing.verification_status,
            remediation_decision: existing.remediation_decision,
            is_public_usable: existing.is_public_usable,
            updated_at: existing.updated_at.toISOString(),
        };

        let result;
        try {
            result = await this.geographyRepo.updateAdminAreaRemediation({
                id: areaId,
                expectedUpdatedAt: new Date(body.expected_updated_at),
                remediationDecision: plan.remediation_decision,
                geometrySource: plan.geometry_source,
                sourceLicenseStatus: plan.source_license_status,
                verificationStatus: plan.verification_status,
                verificationNote,
                boundaryStatus: plan.boundary_status,
                isActive: plan.is_active,
                isPublicUsable: false,
                evidenceJson,
                geojsonText,
                markUnverified: plan.mark_unverified,
                actorUserId: editorIdFromJwt(user),
                beforeSnapshot,
            });
        } catch (error) {
            if (error instanceof Error && error.message === "ADMIN_AREA_GEOMETRY_ANALYSIS_FAILED") {
                throw new AdminAreaGeometryValidationError("Admin area geometry validation failed", [
                    {
                        path: "geometry",
                        message: "Geometry failed final transaction validation; no changes were saved.",
                    },
                ]);
            }
            throw error;
        }

        if (!result) {
            throw new AdminAreaGeometryConflictError();
        }

        const row = result.updated;
        const eligible = isPublicEligible({
            geometry_source: row.geometry_source,
            source_license_status: row.source_license_status,
            remediation_decision: row.remediation_decision,
            verification_status: row.verification_status,
        });

        return {
            id: row.id.toString(),
            public_id: row.public_id,
            canonical_name: row.canonical_name,
            geometry_source: row.geometry_source,
            source_license_status: row.source_license_status,
            verification_status: row.verification_status,
            verification_note: row.verification_note,
            remediation_decision: row.remediation_decision,
            evidence: row.evidence,
            is_public_usable: row.is_public_usable,
            public_eligible: eligible,
            publication_gate: "blocked_pending_production_approval",
            updated_at: row.updated_at.toISOString(),
            bbox: row.bbox,
            centroid: row.centroid,
            geometry: row.geom_geojson,
        };
    }

    async getBoundaryContext(publicIdOrId: string) {
        const areaId = await this.geographyRepo.resolveAdminAreaId(publicIdOrId);
        if (areaId == null) {
            throw new AdminAreaNotFoundError();
        }

        const context = await this.geographyRepo.getBoundaryContext(areaId);
        if (!context?.selected) {
            throw new AdminAreaNotFoundError();
        }

        return {
            selected: {
                ...mapBoundaryMember(context.selected),
                parent_id:
                    context.selected.parent_id == null
                        ? null
                        : context.selected.parent_id.toString(),
            },
            parent: context.parent ? mapBoundaryMember(context.parent) : null,
            neighbours: context.neighbours.map(mapBoundaryMember),
            meta: {
                bbox_margin_deg: context.bbox_margin_deg,
                neighbour_limit: context.neighbour_limit,
                neighbour_count: context.neighbours.length,
                neighbour_truncated: context.neighbour_truncated,
            },
        };
    }

    async validateDraftGeometry(publicIdOrId: string, body: AdminAreaValidateGeometryBody) {
        const areaId = await this.geographyRepo.resolveAdminAreaId(publicIdOrId);
        if (areaId == null) {
            throw new AdminAreaNotFoundError();
        }

        const geojsonText = JSON.stringify(body.geometry);
        let row;
        try {
            row = await this.geographyRepo.validateDraftGeometry({
                adminAreaId: areaId,
                geojsonText,
            });
        } catch {
            throw new AdminAreaGeometryValidationError("Geometry could not be parsed", [
                {
                    path: "geometry",
                    message:
                        "Invalid GeoJSON payload or incompatible geometry type for PostGIS ST_GeomFromGeoJSON.",
                },
            ]);
        }

        if (!row) {
            throw new AdminAreaNotFoundError();
        }

        if (!row.allowed_type) {
            throw new AdminAreaGeometryValidationError("Geometry must be Polygon or MultiPolygon", [
                {
                    path: "geometry.type",
                    message: "Geometry must be a Polygon or MultiPolygon in EPSG:4326.",
                },
            ]);
        }

        type OverlapRaw = {
            public_id: string;
            display_name: string;
            overlap_m2: number;
            overlap_geojson: unknown;
        };
        const overlapsRaw = Array.isArray(row.overlaps_json)
            ? (row.overlaps_json as OverlapRaw[])
            : typeof row.overlaps_json === "string"
              ? (JSON.parse(row.overlaps_json) as OverlapRaw[])
              : [];

        const overlapping_neighbours = overlapsRaw.map((item) => ({
            public_id: item.public_id,
            display_name: item.display_name,
            overlap_ha: m2ToHectares(Number(item.overlap_m2)),
        }));
        const overlappingTotalHa = overlapping_neighbours.reduce(
            (sum, item) => sum + item.overlap_ha,
            0
        );
        const outsideParentHa =
            row.outside_parent_m2 == null ? null : m2ToHectares(row.outside_parent_m2);

        const isValid = row.is_valid && !row.is_empty;
        const checks = buildBoundaryChecks({
            isValid,
            invalidReason: row.invalid_reason,
            outsideParentHa,
            overlappingCount: overlapping_neighbours.length,
            overlappingTotalHa: Math.round(overlappingTotalHa * 1000) / 1000,
            touchingNeighbourCount: Number(row.touching_neighbour_count ?? 0),
            hasParent: row.has_parent,
        });

        const overlapFeatures = overlapsRaw
            .filter((item) => item.overlap_geojson)
            .map((item) => ({
                type: "Feature" as const,
                properties: {
                    public_id: item.public_id,
                    display_name: item.display_name,
                    kind: "overlap",
                },
                geometry: item.overlap_geojson,
            }));

        return {
            is_valid: isValid,
            invalid_reason: row.invalid_reason,
            outside_parent_ha: outsideParentHa,
            overlapping_neighbours,
            touching_neighbour_count: Number(row.touching_neighbour_count ?? 0),
            checks,
            issues_geojson: {
                type: "FeatureCollection" as const,
                features: [
                    ...overlapFeatures,
                    ...(row.outside_parent_geojson
                        ? [
                              {
                                  type: "Feature" as const,
                                  properties: { kind: "outside_parent" },
                                  geometry: row.outside_parent_geojson,
                              },
                          ]
                        : []),
                ],
            },
        };
    }
}
