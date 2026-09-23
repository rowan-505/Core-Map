import type { FastifySchema } from "fastify";

import { Tags, badRequestSchema, bearerAuth, messageSchema } from "../../lib/openapi/common.js";

const adminAreaListItemSchema = {
    type: "object",
    required: [
        "id",
        "public_id",
        "parent_id",
        "canonical_name",
        "slug",
        "admin_level_id",
        "admin_level_code",
        "is_active",
        "verification_status",
        "is_official_boundary",
    ],
    properties: {
        id: { type: "string" },
        public_id: { type: "string" },
        parent_id: { type: ["string", "null"] },
        canonical_name: { type: "string" },
        slug: { type: "string" },
        admin_level_id: { type: "string" },
        admin_level_code: { type: "string" },
        admin_area_type_id: { type: ["string", "null"] },
        admin_area_type_code: { type: ["string", "null"] },
        is_active: { type: "boolean" },
        verification_status: { type: "string" },
        address_usage: { type: "string" },
        boundary_status: { type: "string" },
        is_official_boundary: { type: "boolean" },
        is_public_usable: { type: ["boolean", "null"] },
        geometry_source: { type: ["string", "null"] },
        updated_at: { type: "string", format: "date-time" },
        bbox: {
            type: ["array", "null"],
            items: { type: "number" },
            minItems: 4,
            maxItems: 4,
            description: "[minLng, minLat, maxLng, maxLat]",
        },
        centroid: { description: "GeoJSON Point or null" },
    },
} as const;

const pageEnvelope = (itemSchema: object) =>
    ({
        type: "object",
        required: ["items", "total", "limit", "offset"],
        properties: {
            items: { type: "array", items: itemSchema },
            total: { type: "integer" },
            limit: { type: "integer" },
            offset: { type: "integer" },
        },
    }) as const;

const adminAreaOptionRowSchema = {
    type: "object",
    required: [
        "id",
        "canonical_name",
        "name_mm",
        "name_en",
        "admin_level_id",
        "admin_level_code",
        "parent_id",
    ],
    properties: {
        id: { type: "string" },
        canonical_name: { type: "string" },
        name_mm: { type: "string", nullable: true },
        name_en: { type: "string", nullable: true },
        admin_level_id: { type: "string" },
        admin_level_code: { type: "string" },
        admin_level_name: { type: "string", nullable: true },
        parent_id: { type: "string", nullable: true },
        parent_label: { type: "string", nullable: true },
        boundary_status: { type: "string", nullable: true },
        address_usage: { type: "string", nullable: true },
    },
    additionalProperties: false,
} as const;

const postalCodeRowSchema = {
    type: "object",
    required: ["postal_code", "match_status", "source_name", "source_version"],
    properties: {
        postal_code: { type: "string" },
        region_name_en: { type: ["string", "null"] },
        region_name_my: { type: ["string", "null"] },
        township_name_en: { type: ["string", "null"] },
        township_name_my: { type: ["string", "null"] },
        locality_name_en: { type: ["string", "null"] },
        locality_name_my: { type: ["string", "null"] },
        locality_type: { type: ["string", "null"] },
        township_admin_area_id: { type: ["string", "null"] },
        local_admin_area_id: { type: ["string", "null"] },
        match_status: { type: "string" },
        match_method: { type: ["string", "null"] },
        source_name: { type: "string" },
        source_version: { type: "string" },
    },
} as const;

export const getAdminAreasSchema = {
    tags: [Tags.AdminAreas],
    summary: "List admin areas (paginated geography)",
    description:
        "Dashboard geography browser. Returns metadata + bbox/centroid only — never nationwide full-resolution polygons.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
            q: { type: "string", maxLength: 200 },
            level: { type: "string", description: "ref.ref_admin_levels.code" },
            type: { type: "string", description: "ref.ref_admin_area_types.code" },
            parent: { type: "string", pattern: "^\\d+$" },
            status: { type: "string", description: "verification_status" },
            geometrySource: { type: "string" },
            geometry_source: { type: "string" },
            // Query strings arrive as text; Zod coerces true/false/1/0.
            official: { type: "string", enum: ["true", "false", "1", "0"] },
            public: { type: "string", enum: ["true", "false", "1", "0"] },
        },
        additionalProperties: false,
    },
    response: {
        200: pageEnvelope(adminAreaListItemSchema),
        400: badRequestSchema,
        401: messageSchema,
    },
} satisfies FastifySchema;

export const getAdminAreaByIdSchema = {
    tags: [Tags.AdminAreas],
    summary: "Admin area detail",
    description:
        "Names, ancestors, child/postal counts, and verification_note (fix reason when status is needs_fix). Full geometry only when include_geometry=true (authorized dashboard user).",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    querystring: {
        type: "object",
        properties: {
            include_geometry: { type: "string", enum: ["true", "false", "1", "0"], default: "false" },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: badRequestSchema,
        401: messageSchema,
        404: messageSchema,
    },
} satisfies FastifySchema;

export const getAdminAreaChildrenSchema = {
    tags: [Tags.AdminAreas],
    summary: "Admin area children",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 200, default: 100 },
            offset: { type: "integer", minimum: 0, default: 0 },
            level: { type: "string" },
        },
        additionalProperties: false,
    },
    response: {
        200: pageEnvelope({
            type: "object",
            required: ["id", "canonical_name", "admin_level_code", "is_active"],
            properties: {
                id: { type: "string" },
                canonical_name: { type: "string" },
                admin_level_code: { type: "string" },
                is_active: { type: "boolean" },
            },
        }),
        400: badRequestSchema,
        401: messageSchema,
        404: messageSchema,
    },
} satisfies FastifySchema;

export const getAdminAreaPostalCodesSchema = {
    tags: [Tags.AdminAreas],
    summary: "Postal codes linked to an admin area",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
            q: { type: "string" },
        },
        additionalProperties: false,
    },
    response: {
        200: pageEnvelope(postalCodeRowSchema),
        400: badRequestSchema,
        401: messageSchema,
        404: messageSchema,
    },
} satisfies FastifySchema;

export const getPostalCodesSearchSchema = {
    tags: [Tags.AdminAreas],
    summary: "Search postal codes",
    description: "Search ref.ref_postal_codes by code and locality names. API-only; not exposed via Supabase.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
            q: { type: "string" },
            postal_code: { type: "string" },
            locality: { type: "string" },
            match_status: { type: "string" },
        },
        additionalProperties: false,
    },
    response: {
        200: pageEnvelope(postalCodeRowSchema),
        400: badRequestSchema,
        401: messageSchema,
    },
} satisfies FastifySchema;

export const getAdminAreasTileSchema = {
    tags: [Tags.AdminAreas],
    summary: "Admin area vector tile (MVT)",
    description:
        "Dashboard map overlay. Uses ST_AsMVT with zoom-based simplify; reuses GiST geom index. Not a parallel tile platform.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["z", "x", "y"],
        properties: {
            z: { type: "integer", minimum: 0, maximum: 22 },
            x: { type: "integer", minimum: 0 },
            y: { type: "integer", minimum: 0 },
        },
    },
    querystring: {
        type: "object",
        properties: {
            level: { type: "string" },
            type: { type: "string" },
            status: { type: "string" },
            geometry_source: { type: "string" },
            geometrySource: { type: "string" },
            official: { type: "string", enum: ["true", "false", "1", "0"] },
            public: { type: "string", enum: ["true", "false", "1", "0"] },
        },
        additionalProperties: false,
    },
    response: {
        200: { description: "application/vnd.mapbox-vector-tile", type: "string", format: "binary" },
        400: badRequestSchema,
        401: messageSchema,
    },
} satisfies FastifySchema;

export const getAdminAreasSummarySchema = {
    tags: [Tags.AdminAreas],
    summary: "Admin geography summary counters",
    description:
        "Dashboard KPI strip. Aggregates only — never returns geometries. Targets: 15 official first-level, 330 official townships.",
    security: [...bearerAuth],
    response: {
        200: {
            type: "object",
            required: [
                "official_first_level",
                "official_township",
                "ward_count",
                "village_tract_count",
                "settlement_count",
                "placeholder_count",
                "postal_linked_local",
                "postal_linked_township_only",
                "postal_unmatched_review",
                "targets",
            ],
            properties: {
                official_first_level: { type: "integer" },
                official_township: { type: "integer" },
                ward_count: { type: "integer" },
                village_tract_count: { type: "integer" },
                settlement_count: { type: "integer" },
                placeholder_count: { type: "integer" },
                postal_linked_local: { type: "integer" },
                postal_linked_township_only: { type: "integer" },
                postal_unmatched_review: { type: "integer" },
                targets: {
                    type: "object",
                    required: ["official_first_level", "official_township"],
                    properties: {
                        official_first_level: { type: "integer" },
                        official_township: { type: "integer" },
                    },
                },
            },
        },
        401: messageSchema,
    },
} satisfies FastifySchema;

export const getAdminAreaOptionsSchema = {
    tags: [Tags.AdminAreas],
    summary: "Admin area picker options",
    description:
        "Active rows from core.core_admin_areas with Myanmar/English labels from core.core_admin_area_names (language my/mm and en).",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 2000, default: 500 },
            q: { type: "string", minLength: 1, maxLength: 200 },
            admin_level_code: { type: "string", enum: ["township", "state_region"] },
            region_admin_area_id: {
                type: "string",
                pattern: "^\\d+$",
                description: "When filtering townships, only descendants of this Region/State id",
            },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "array", items: adminAreaOptionRowSchema },
        400: badRequestSchema,
        401: messageSchema,
    },
} satisfies FastifySchema;

export const getRoadTownshipAdminAreaOptionsSchema = {
    tags: [Tags.AdminAreas],
    summary: "Road/street township override search",
    description:
        "Server-side search for active township-level admin areas only (roads). Matches id, public_id, canonical_name, Myanmar/English names (language_code my/en), slug, and external_id. Excludes ward, village, district, state, and country levels.",
    security: [...bearerAuth],
    querystring: {
        type: "object",
        required: ["q"],
        properties: {
            q: { type: "string", minLength: 1, maxLength: 200 },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 50 },
        },
        additionalProperties: false,
    },
    response: {
        200: { type: "array", items: adminAreaOptionRowSchema },
        400: badRequestSchema,
        401: messageSchema,
    },
} satisfies FastifySchema;

export const patchAdminAreaGeometrySchema = {
    tags: [Tags.AdminAreas],
    summary: "Update admin area geometry",
    description:
        "Dashboard write roles only. Optimistic concurrency via expected_updated_at. Validates Polygon/MultiPolygon with ST_IsValid; never auto-applies ST_MakeValid. Replacing mimu_placeholder sets geometry_source + license and verification_status=needs_fix. Audited in system.audit_logs.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", pattern: "^\\d+$" } },
    },
    body: {
        type: "object",
        required: ["geometry", "expected_updated_at"],
        additionalProperties: false,
        properties: {
            geometry: {
                type: "object",
                required: ["type", "coordinates"],
                properties: {
                    type: { type: "string", enum: ["Polygon", "MultiPolygon"] },
                    coordinates: { type: "array" },
                },
            },
            expected_updated_at: { type: "string", format: "date-time" },
            geometry_source: {
                type: "string",
                enum: ["coremap_manual", "government", "osm"],
            },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: badRequestSchema,
        401: messageSchema,
        403: messageSchema,
        404: messageSchema,
        409: messageSchema,
    },
} satisfies FastifySchema;

export const getAdminAreaContextSchema = {
    tags: [Tags.AdminAreas],
    summary: "Admin area boundary review context",
    description:
        "Returns the selected record (full geometry), parent outline, and same-level neighbours inside the selected bbox plus a small margin. Neighbour geometries are simplified and capped — never nationwide GeoJSON.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["publicId"],
        properties: {
            publicId: {
                type: "string",
                description: "public_id UUID or numeric internal id",
            },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: badRequestSchema,
        401: messageSchema,
        403: messageSchema,
        404: messageSchema,
    },
} satisfies FastifySchema;

export const postAdminAreaValidateGeometrySchema = {
    tags: [Tags.AdminAreas],
    summary: "Validate draft admin area geometry",
    description:
        "Accepts draft Polygon/MultiPolygon without saving. Returns ST_IsValid, outside-parent hectares, overlapping neighbour ids/hectares, and touching neighbour count. Ordinary gaps are not classified as fatal errors.",
    security: [...bearerAuth],
    params: {
        type: "object",
        required: ["publicId"],
        properties: {
            publicId: {
                type: "string",
                description: "public_id UUID or numeric internal id",
            },
        },
    },
    body: {
        type: "object",
        required: ["geometry"],
        additionalProperties: false,
        properties: {
            geometry: {
                type: "object",
                required: ["type", "coordinates"],
                properties: {
                    type: { type: "string", enum: ["Polygon", "MultiPolygon"] },
                    coordinates: { type: "array" },
                },
            },
        },
    },
    response: {
        200: { type: "object", additionalProperties: true },
        400: badRequestSchema,
        401: messageSchema,
        403: messageSchema,
        404: messageSchema,
    },
} satisfies FastifySchema;

