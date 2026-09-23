import { z } from "zod";

import { EVIDENCE_STATUSES, REMEDIATION_DECISIONS } from "./admin-areas.remediation.js";

const booleanQueryValueSchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true" || normalized === "1") {
            return true;
        }
        if (normalized === "false" || normalized === "0") {
            return false;
        }
    }
    return value;
}, z.boolean().optional());

const optionalTrimmedSchema = z.preprocess((value) => {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
    }
    return value;
}, z.string().min(1).optional());

export const adminAreaIdParamsSchema = z.object({
    id: z
        .string()
        .trim()
        .regex(/^\d+$/, "id must be a numeric admin area id"),
});

/** UUID or numeric id — used by context / validate-geometry (Core Review uses public_id). */
const adminAreaPublicIdValueSchema = z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine(
        (value) =>
            /^\d+$/.test(value) ||
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                value
            ),
        "publicId must be a numeric id or UUID"
    );

export const adminAreaPublicIdParamsSchema = z.object({
    publicId: adminAreaPublicIdValueSchema,
});

const geoJsonCoordinateSchema = z.array(z.number()).min(2).max(3);
const geoJsonLinearRingSchema = z.array(geoJsonCoordinateSchema).min(4);
const geoJsonPolygonCoordinatesSchema = z.array(geoJsonLinearRingSchema).min(1);

export const adminAreaPolygonGeometrySchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("Polygon"),
        coordinates: geoJsonPolygonCoordinatesSchema,
    }),
    z.object({
        type: z.literal("MultiPolygon"),
        coordinates: z.array(geoJsonPolygonCoordinatesSchema).min(1),
    }),
]);

/** Draft geometry check — does not persist. */
export const adminAreaValidateGeometryBodySchema = z.object({
    geometry: adminAreaPolygonGeometrySchema,
});

export const adminAreasListQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    q: optionalTrimmedSchema,
    level: optionalTrimmedSchema,
    type: optionalTrimmedSchema,
    parent: z
        .string()
        .trim()
        .regex(/^\d+$/, "parent must be a numeric id")
        .optional(),
    status: optionalTrimmedSchema,
    geometrySource: optionalTrimmedSchema,
    geometry_source: optionalTrimmedSchema,
    official: booleanQueryValueSchema,
    public: booleanQueryValueSchema,
    remediation_decision: z.enum(REMEDIATION_DECISIONS).optional(),
    evidence_status: z.enum(EVIDENCE_STATUSES).optional(),
});

export const adminAreaDetailQuerySchema = z.object({
    include_geometry: booleanQueryValueSchema,
});

export const adminAreaChildrenQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(100),
    offset: z.coerce.number().int().min(0).default(0),
    level: optionalTrimmedSchema,
});

export const adminAreaPostalCodesQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    q: optionalTrimmedSchema,
});

export const postalCodesSearchQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    q: optionalTrimmedSchema,
    postal_code: optionalTrimmedSchema,
    locality: optionalTrimmedSchema,
    match_status: optionalTrimmedSchema,
});

export const adminAreasTileParamsSchema = z.object({
    z: z.coerce.number().int().min(0).max(22),
    x: z.coerce.number().int().min(0),
    y: z.coerce.number().int().min(0),
});

export const adminAreasTileQuerySchema = z.object({
    level: optionalTrimmedSchema,
    type: optionalTrimmedSchema,
    status: optionalTrimmedSchema,
    geometry_source: optionalTrimmedSchema,
    geometrySource: optionalTrimmedSchema,
    official: booleanQueryValueSchema,
    public: booleanQueryValueSchema,
});

export const adminAreaGeometryPatchBodySchema = z.object({
    geometry: adminAreaPolygonGeometrySchema,
    expected_updated_at: z
        .string()
        .trim()
        .min(1, "expected_updated_at is required")
        .refine((value) => !Number.isNaN(Date.parse(value)), "expected_updated_at must be an ISO timestamp"),
    geometry_source: z.enum(["coremap_manual", "government", "osm"]).optional(),
});

const remediationEvidenceItemSchema = z.object({
    type: z.string().trim().min(1).max(64),
    value: z.string().trim().min(1).max(4000),
    label: z.string().trim().min(1).max(256),
    note: z.string().trim().max(2000).nullable().optional(),
    captured_at: z
        .string()
        .trim()
        .min(1)
        .refine((value) => !Number.isNaN(Date.parse(value)), "captured_at must be an ISO timestamp"),
    storage_path: z.string().trim().max(1024).nullable().optional(),
    sha256: z
        .string()
        .trim()
        .regex(/^[0-9a-fA-F]{64}$/, "sha256 must be 64 hex chars")
        .nullable()
        .optional(),
});

export const remediationEvidenceSchema = z
    .object({
        items: z.array(remediationEvidenceItemSchema).max(50),
    })
    .nullable();

export const adminAreaRemediationPatchBodySchema = z.object({
    expected_updated_at: z
        .string()
        .trim()
        .min(1, "expected_updated_at is required")
        .refine((value) => !Number.isNaN(Date.parse(value)), "expected_updated_at must be an ISO timestamp"),
    decision: z.enum(REMEDIATION_DECISIONS),
    geometry: adminAreaPolygonGeometrySchema.optional(),
    geometry_source: z.enum(["coremap_manual", "government", "osm"]).optional(),
    evidence: remediationEvidenceSchema.optional(),
    verification_note: z.string().trim().max(4000).nullable().optional(),
    /** Always rejected while unconditional MIMU publication gate is on. */
    is_public_usable: booleanQueryValueSchema,
});

export type AdminAreasListQuery = z.infer<typeof adminAreasListQuerySchema>;
export type AdminAreaDetailQuery = z.infer<typeof adminAreaDetailQuerySchema>;
export type AdminAreaChildrenQuery = z.infer<typeof adminAreaChildrenQuerySchema>;
export type AdminAreaPostalCodesQuery = z.infer<typeof adminAreaPostalCodesQuerySchema>;
export type PostalCodesSearchQuery = z.infer<typeof postalCodesSearchQuerySchema>;
export type AdminAreasTileParams = z.infer<typeof adminAreasTileParamsSchema>;
export type AdminAreasTileQuery = z.infer<typeof adminAreasTileQuerySchema>;
export type AdminAreaGeometryPatchBody = z.infer<typeof adminAreaGeometryPatchBodySchema>;
export type AdminAreaRemediationPatchBody = z.infer<typeof adminAreaRemediationPatchBodySchema>;
export type AdminAreaValidateGeometryBody = z.infer<typeof adminAreaValidateGeometryBodySchema>;
export type AdminAreaPublicIdParams = z.infer<typeof adminAreaPublicIdParamsSchema>;

/** Resolve camelCase / snake_case geometry source query aliases. */
export function resolveGeometrySource(
    query: { geometrySource?: string; geometry_source?: string }
): string | undefined {
    return query.geometry_source ?? query.geometrySource;
}

/** License status when replacing MIMU placeholders (truthful for the chosen source). */
export function licenseStatusForGeometrySource(
    source: "coremap_manual" | "government" | "osm"
): string {
    if (source === "osm") return "odbl-1.0";
    if (source === "government") return "government_source";
    return "coremap_internal";
}
