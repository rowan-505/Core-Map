import { z } from "zod";

import type { ReferenceFieldDef, ReferenceTypeKey } from "./references.types.js";
import { REFERENCE_TYPE_KEYS } from "./references.types.js";

const CODE_SNAKE = z
    .string()
    .trim()
    .transform((v) => v.toLowerCase())
    .pipe(z.string().regex(/^[a-z][a-z0-9_]*$/, "code must be lowercase snake_case"));

const CODE_SEGMENT = z
    .string()
    .trim()
    .transform((v) => v.toLowerCase())
    .pipe(
        z
            .string()
            .regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/, "code must be lowercase snake_case segments"),
    );

const optionalText = z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

const requiredText = (max = 200) => z.string().trim().min(1).max(max);

const optionalParentId = z
    .union([z.string().trim().regex(/^\d+$/), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null ? null : v));

const optionalBoolean = z.boolean().optional();
const requiredBoolean = z.boolean();

export type ReferenceTableConfig = {
    key: ReferenceTypeKey;
    table: string;
    label: string;
    singularLabel: string;
    description: string;
    fields: readonly ReferenceFieldDef[];
    /** Columns selected/returned (must match DB). */
    columns: readonly string[];
    /** Default ORDER BY clause fragments (allowlisted column names only). */
    orderBy: readonly string[];
    hasUpdatedAt: boolean;
    hierarchical: boolean;
    codeSchema: z.ZodType<string>;
    createSchema: z.ZodType<Record<string, unknown>>;
    patchSchema: z.ZodType<Record<string, unknown>>;
    /**
     * Optional SQL returning bigint usage count for a row.
     * Use $1 for id (bigint) and $2 for code (text).
     */
    usageSql?: string;
};

function fields(
    defs: readonly ReferenceFieldDef[],
): readonly ReferenceFieldDef[] {
    return defs;
}

const poiFields = fields([
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, list: true },
    { key: "name", label: "Name", kind: "text", required: true, editable: true, list: true },
    { key: "name_mm", label: "Name (Myanmar)", kind: "text", editable: true, list: true },
    { key: "parent_id", label: "Parent", kind: "parent", editable: true, list: true },
    { key: "sort_order", label: "Sort order", kind: "number", editable: true, list: true, min: 0, max: 100000 },
    { key: "is_searchable", label: "Searchable", kind: "boolean", editable: true, list: true },
    { key: "is_public", label: "Public", kind: "boolean", editable: true, list: true },
    {
        key: "ranking_group",
        label: "Ranking group",
        kind: "select",
        editable: true,
        list: true,
        options: ["food_drink"],
    },
]);

const roadFields = fields([
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, list: true },
    { key: "name", label: "Name", kind: "text", required: true, editable: true, list: true },
    { key: "rank", label: "Rank", kind: "number", required: true, editable: true, list: true, min: 0, max: 10000 },
    { key: "min_zoom", label: "Min zoom", kind: "number", editable: true, list: true, min: 0, max: 24 },
    { key: "default_width", label: "Default width", kind: "number", editable: true, list: true, min: 0, max: 100 },
    { key: "is_public", label: "Public", kind: "boolean", editable: true, list: true },
]);

const buildingFields = fields([
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, list: true },
    { key: "name", label: "Name", kind: "text", required: true, editable: true, list: true },
    { key: "name_mm", label: "Name (Myanmar)", kind: "text", editable: true, list: true },
    { key: "parent_id", label: "Parent", kind: "parent", editable: true, list: true },
    { key: "sort_order", label: "Sort order", kind: "number", editable: true, list: true, min: 0, max: 100000 },
    { key: "is_active", label: "Active", kind: "boolean", editable: true, list: true },
]);

const adminLevelFields = fields([
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, list: true },
    { key: "name", label: "Name", kind: "text", required: true, editable: true, list: true },
    { key: "rank", label: "Rank", kind: "number", required: true, editable: true, list: true, min: 0, max: 100 },
]);

const adminAreaTypeFields = fields([
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, list: true },
    { key: "name", label: "Name", kind: "text", required: true, editable: true, list: true },
    { key: "parent_type_code", label: "Parent type code", kind: "text", editable: true, list: true },
    { key: "description", label: "Description", kind: "textarea", editable: true },
    { key: "is_boundary", label: "Boundary", kind: "boolean", editable: true, list: true },
    { key: "is_required_for_address", label: "Required for address", kind: "boolean", editable: true, list: true },
    { key: "is_search_usable", label: "Search usable", kind: "boolean", editable: true, list: true },
    { key: "sort_order", label: "Sort order", kind: "number", editable: true, list: true, min: 0, max: 100000 },
]);

const settlementFields = fields([
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, list: true },
    { key: "name", label: "Name", kind: "text", required: true, editable: true, list: true },
    { key: "sort_order", label: "Sort order", kind: "number", editable: true, list: true, min: 0, max: 100000 },
]);

const codeNameFields = fields([
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, list: true },
    { key: "name", label: "Name", kind: "text", required: true, editable: true, list: true },
]);

const addressComponentFields = fields([
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, list: true },
    { key: "name", label: "Name", kind: "text", required: true, editable: true, list: true },
    { key: "rank", label: "Rank", kind: "number", required: true, editable: true, list: true, min: 0, max: 10000 },
    { key: "name_en", label: "Name (EN)", kind: "text", editable: true, list: true },
    { key: "name_my", label: "Name (MY)", kind: "text", editable: true, list: true },
    { key: "is_admin_component", label: "Admin component", kind: "boolean", editable: true, list: true },
    { key: "is_street_component", label: "Street component", kind: "boolean", editable: true, list: true },
    { key: "is_required_for_search", label: "Required for search", kind: "boolean", editable: true, list: true },
    { key: "is_public", label: "Public", kind: "boolean", editable: true, list: true },
]);

const landFields = fields([
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, list: true },
    { key: "name_en", label: "Name (EN)", kind: "text", required: true, editable: true, list: true },
    { key: "name_mm", label: "Name (Myanmar)", kind: "text", editable: true, list: true },
    { key: "parent_id", label: "Parent", kind: "parent", editable: true, list: true },
    { key: "sort_order", label: "Sort order", kind: "number", editable: true, list: true, min: 0, max: 100000 },
    { key: "min_zoom", label: "Min zoom", kind: "number", editable: true, list: true, min: 0, max: 24 },
    {
        key: "default_import_confidence",
        label: "Default import confidence",
        kind: "number",
        editable: true,
        list: true,
        min: 0,
        max: 100,
    },
    { key: "is_public", label: "Public", kind: "boolean", editable: true, list: true },
    { key: "is_active", label: "Active", kind: "boolean", editable: true, list: true },
]);

const waterFields = fields([
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, list: true },
    { key: "name_en", label: "Name (EN)", kind: "text", required: true, editable: true, list: true },
    { key: "name_mm", label: "Name (Myanmar)", kind: "text", editable: true, list: true },
    { key: "parent_id", label: "Parent", kind: "parent", editable: true, list: true },
    { key: "sort_order", label: "Sort order", kind: "number", editable: true, list: true, min: 0, max: 100000 },
    { key: "min_zoom", label: "Min zoom", kind: "number", editable: true, list: true, min: 0, max: 24 },
    { key: "is_public", label: "Public", kind: "boolean", editable: true, list: true },
    { key: "is_active", label: "Active", kind: "boolean", editable: true, list: true },
]);

const boundaryFields = fields([
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, list: true },
    { key: "name_en", label: "Name (EN)", kind: "text", required: true, editable: true, list: true },
    { key: "name_mm", label: "Name (Myanmar)", kind: "text", editable: true, list: true },
    { key: "helper_en", label: "Helper (EN)", kind: "textarea", editable: true },
    { key: "helper_mm", label: "Helper (Myanmar)", kind: "textarea", editable: true },
    { key: "sort_order", label: "Sort order", kind: "number", editable: true, list: true, min: 0, max: 100000 },
    {
        key: "default_is_official_boundary",
        label: "Default official boundary",
        kind: "boolean",
        editable: true,
        list: true,
    },
    {
        key: "default_boundary_confidence_score",
        label: "Default confidence",
        kind: "number",
        editable: true,
        list: true,
        min: 0,
        max: 100,
    },
    {
        key: "default_address_usage_code",
        label: "Default address usage code",
        kind: "text",
        editable: true,
        list: true,
    },
    { key: "is_active", label: "Active", kind: "boolean", editable: true, list: true },
]);

const addressUsageFields = fields([
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, list: true },
    { key: "name_en", label: "Name (EN)", kind: "text", required: true, editable: true, list: true },
    { key: "name_mm", label: "Name (Myanmar)", kind: "text", editable: true, list: true },
    { key: "helper_en", label: "Helper (EN)", kind: "textarea", editable: true },
    { key: "helper_mm", label: "Helper (Myanmar)", kind: "textarea", editable: true },
    { key: "sort_order", label: "Sort order", kind: "number", editable: true, list: true, min: 0, max: 100000 },
    { key: "is_active", label: "Active", kind: "boolean", editable: true, list: true },
]);

const protectedFields = fields([
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, list: true },
    { key: "name_en", label: "Name (EN)", kind: "text", required: true, editable: true, list: true },
    { key: "name_mm", label: "Name (Myanmar)", kind: "text", editable: true, list: true },
    { key: "sort_order", label: "Sort order", kind: "number", editable: true, list: true, min: 0, max: 100000 },
    { key: "is_public", label: "Public", kind: "boolean", editable: true, list: true },
    { key: "is_active", label: "Active", kind: "boolean", editable: true, list: true },
]);

const tourismLikeFields = fields([
    { key: "code", label: "Code", kind: "text", required: true, createOnly: true, list: true },
    { key: "name_en", label: "Name (EN)", kind: "text", required: true, editable: true, list: true },
    { key: "name_mm", label: "Name (Myanmar)", kind: "text", editable: true, list: true },
    { key: "description", label: "Description", kind: "textarea", editable: true },
    { key: "sort_order", label: "Sort order", kind: "number", editable: true, list: true, min: 0, max: 100000 },
    { key: "is_active", label: "Active", kind: "boolean", editable: true, list: true },
]);

function makeSchemas(
    codeSchema: z.ZodType<string>,
    createShape: z.ZodRawShape,
    patchShape: z.ZodRawShape,
): Pick<ReferenceTableConfig, "codeSchema" | "createSchema" | "patchSchema"> {
    return {
        codeSchema,
        createSchema: z.object(createShape).strict() as z.ZodType<Record<string, unknown>>,
        patchSchema: z
            .object(patchShape)
            .strict()
            .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" }) as z.ZodType<
            Record<string, unknown>
        >,
    };
}

const REGISTRY: Record<ReferenceTypeKey, ReferenceTableConfig> = {
    "poi-categories": {
        key: "poi-categories",
        table: "ref_poi_categories",
        label: "POI categories",
        singularLabel: "POI category",
        description: "Categories for places and points of interest.",
        fields: poiFields,
        columns: [
            "id",
            "code",
            "name",
            "name_mm",
            "parent_id",
            "sort_order",
            "is_searchable",
            "is_public",
            "ranking_group",
            "created_at",
        ],
        orderBy: ["sort_order ASC", "name ASC"],
        hasUpdatedAt: false,
        hierarchical: true,
        usageSql: `SELECT count(*)::bigint AS n FROM core.core_places WHERE category_id = $1::bigint`,
        ...makeSchemas(
            CODE_SNAKE,
            {
                code: CODE_SNAKE,
                name: requiredText(200),
                name_mm: optionalText,
                parent_id: optionalParentId,
                sort_order: z.number().int().min(0).max(100000).default(100),
                is_searchable: requiredBoolean.default(true),
                is_public: requiredBoolean.default(true),
                ranking_group: z.enum(["food_drink"]).nullable().optional(),
            },
            {
                name: requiredText(200).optional(),
                name_mm: optionalText,
                parent_id: optionalParentId,
                sort_order: z.number().int().min(0).max(100000).optional(),
                is_searchable: optionalBoolean,
                is_public: optionalBoolean,
                ranking_group: z.enum(["food_drink"]).nullable().optional(),
            },
        ),
    },
    "road-classes": {
        key: "road-classes",
        table: "ref_road_classes",
        label: "Road classes",
        singularLabel: "Road class",
        description: "Classification for streets and roads.",
        fields: roadFields,
        columns: ["id", "code", "name", "rank", "min_zoom", "default_width", "is_public", "created_at"],
        orderBy: ["rank ASC", "name ASC"],
        hasUpdatedAt: false,
        hierarchical: false,
        usageSql: `SELECT count(*)::bigint AS n FROM core.core_streets WHERE road_class_id = $1::bigint`,
        ...makeSchemas(
            CODE_SNAKE,
            {
                code: CODE_SNAKE,
                name: requiredText(200),
                rank: z.number().int().min(0).max(10000),
                min_zoom: z.number().min(0).max(24).default(22),
                default_width: z.number().min(0).max(100).default(8),
                is_public: requiredBoolean.default(true),
            },
            {
                name: requiredText(200).optional(),
                rank: z.number().int().min(0).max(10000).optional(),
                min_zoom: z.number().min(0).max(24).optional(),
                default_width: z.number().min(0).max(100).optional(),
                is_public: optionalBoolean,
            },
        ),
    },
    "building-types": {
        key: "building-types",
        table: "ref_building_types",
        label: "Building types",
        singularLabel: "Building type",
        description: "Types for building footprints.",
        fields: buildingFields,
        columns: ["id", "code", "name", "name_mm", "parent_id", "sort_order", "is_active", "created_at", "updated_at"],
        orderBy: ["sort_order ASC", "name ASC"],
        hasUpdatedAt: true,
        hierarchical: true,
        usageSql: `SELECT count(*)::bigint AS n FROM core.core_buildings WHERE building_type_id = $1::bigint`,
        ...makeSchemas(
            CODE_SNAKE,
            {
                code: CODE_SNAKE,
                name: requiredText(200),
                name_mm: optionalText,
                parent_id: optionalParentId,
                sort_order: z.number().int().min(0).max(100000).default(0),
                is_active: requiredBoolean.default(true),
            },
            {
                name: requiredText(200).optional(),
                name_mm: optionalText,
                parent_id: optionalParentId,
                sort_order: z.number().int().min(0).max(100000).optional(),
                is_active: optionalBoolean,
            },
        ),
    },
    "admin-levels": {
        key: "admin-levels",
        table: "ref_admin_levels",
        label: "Admin levels",
        singularLabel: "Admin level",
        description: "Administrative hierarchy levels (country to ward).",
        fields: adminLevelFields,
        columns: ["id", "code", "name", "rank", "created_at"],
        orderBy: ["rank ASC", "name ASC"],
        hasUpdatedAt: false,
        hierarchical: false,
        usageSql: `SELECT count(*)::bigint AS n FROM core.core_admin_areas WHERE admin_level_id = $1::bigint`,
        ...makeSchemas(
            CODE_SNAKE,
            {
                code: CODE_SNAKE,
                name: requiredText(200),
                rank: z.number().int().min(0).max(100),
            },
            {
                name: requiredText(200).optional(),
                rank: z.number().int().min(0).max(100).optional(),
            },
        ),
    },
    "admin-area-types": {
        key: "admin-area-types",
        table: "ref_admin_area_types",
        label: "Admin area types",
        singularLabel: "Admin area type",
        description: "Semantic types for admin areas (state, township, etc.).",
        fields: adminAreaTypeFields,
        columns: [
            "id",
            "code",
            "name",
            "parent_type_code",
            "description",
            "is_boundary",
            "is_required_for_address",
            "is_search_usable",
            "sort_order",
            "created_at",
        ],
        orderBy: ["sort_order ASC", "name ASC"],
        hasUpdatedAt: false,
        hierarchical: false,
        usageSql: `SELECT count(*)::bigint AS n FROM core.core_admin_areas WHERE admin_area_type_id = $1::bigint`,
        ...makeSchemas(
            CODE_SNAKE,
            {
                code: CODE_SNAKE,
                name: requiredText(200),
                parent_type_code: optionalText,
                description: optionalText,
                is_boundary: requiredBoolean.default(true),
                is_required_for_address: requiredBoolean.default(false),
                is_search_usable: requiredBoolean.default(true),
                sort_order: z.number().int().min(0).max(100000).default(100),
            },
            {
                name: requiredText(200).optional(),
                parent_type_code: optionalText,
                description: optionalText,
                is_boundary: optionalBoolean,
                is_required_for_address: optionalBoolean,
                is_search_usable: optionalBoolean,
                sort_order: z.number().int().min(0).max(100000).optional(),
            },
        ),
    },
    "settlement-types": {
        key: "settlement-types",
        table: "ref_settlement_types",
        label: "Settlement types",
        singularLabel: "Settlement type",
        description: "Types for settlements and villages.",
        fields: settlementFields,
        columns: ["id", "code", "name", "sort_order", "created_at"],
        orderBy: ["sort_order ASC", "name ASC"],
        hasUpdatedAt: false,
        hierarchical: false,
        usageSql: `SELECT count(*)::bigint AS n FROM core.core_settlements WHERE settlement_type_id = $1::bigint`,
        ...makeSchemas(
            CODE_SNAKE,
            {
                code: CODE_SNAKE,
                name: requiredText(200),
                sort_order: z.number().int().min(0).max(100000).default(0),
            },
            {
                name: requiredText(200).optional(),
                sort_order: z.number().int().min(0).max(100000).optional(),
            },
        ),
    },
    "source-types": {
        key: "source-types",
        table: "ref_source_types",
        label: "Source types",
        singularLabel: "Source type",
        description: "Provenance labels for core entities.",
        fields: codeNameFields,
        columns: ["id", "code", "name"],
        orderBy: ["name ASC"],
        hasUpdatedAt: false,
        hierarchical: false,
        usageSql: `SELECT (
            (SELECT count(*) FROM core.core_places WHERE source_type_id = $1::bigint) +
            (SELECT count(*) FROM core.core_streets WHERE source_type_id = $1::bigint) +
            (SELECT count(*) FROM core.core_admin_areas WHERE source_type_id = $1::bigint) +
            (SELECT count(*) FROM core.core_settlements WHERE source_type_id = $1::bigint) +
            (SELECT count(*) FROM core.core_addresses WHERE source_type_id = $1::bigint)
          )::bigint AS n`,
        ...makeSchemas(
            CODE_SNAKE,
            { code: CODE_SNAKE, name: requiredText(200) },
            { name: requiredText(200).optional() },
        ),
    },
    "address-component-types": {
        key: "address-component-types",
        table: "ref_address_component_types",
        label: "Address component types",
        singularLabel: "Address component type",
        description: "Parts of structured addresses.",
        fields: addressComponentFields,
        columns: [
            "id",
            "code",
            "name",
            "rank",
            "name_en",
            "name_my",
            "is_admin_component",
            "is_street_component",
            "is_required_for_search",
            "is_public",
        ],
        orderBy: ["rank ASC", "name ASC"],
        hasUpdatedAt: false,
        hierarchical: false,
        usageSql: `SELECT count(*)::bigint AS n FROM core.core_address_components WHERE component_type_id = $1::bigint`,
        ...makeSchemas(
            CODE_SEGMENT,
            {
                code: CODE_SEGMENT,
                name: requiredText(200),
                rank: z.number().int().min(0).max(10000),
                name_en: optionalText,
                name_my: optionalText,
                is_admin_component: requiredBoolean.default(false),
                is_street_component: requiredBoolean.default(false),
                is_required_for_search: requiredBoolean.default(false),
                is_public: requiredBoolean.default(true),
            },
            {
                name: requiredText(200).optional(),
                rank: z.number().int().min(0).max(10000).optional(),
                name_en: optionalText,
                name_my: optionalText,
                is_admin_component: optionalBoolean,
                is_street_component: optionalBoolean,
                is_required_for_search: optionalBoolean,
                is_public: optionalBoolean,
            },
        ),
    },
    "publish-statuses": {
        key: "publish-statuses",
        table: "ref_publish_statuses",
        label: "Publish statuses",
        singularLabel: "Publish status",
        description: "Publication lifecycle for places.",
        fields: codeNameFields,
        columns: ["id", "code", "name", "created_at"],
        orderBy: ["name ASC"],
        hasUpdatedAt: false,
        hierarchical: false,
        usageSql: `SELECT (
            (SELECT count(*) FROM core.core_places WHERE publish_status_id = $1::bigint) +
            (SELECT count(*) FROM core.core_place_versions WHERE publish_status_id = $1::bigint)
          )::bigint AS n`,
        ...makeSchemas(
            CODE_SNAKE,
            { code: CODE_SNAKE, name: requiredText(200) },
            { name: requiredText(200).optional() },
        ),
    },
    "report-types": {
        key: "report-types",
        table: "ref_report_types",
        label: "Report types",
        singularLabel: "Report type",
        description: "User report categories (linked by code).",
        fields: codeNameFields,
        columns: ["id", "code", "name", "created_at"],
        orderBy: ["name ASC"],
        hasUpdatedAt: false,
        hierarchical: false,
        usageSql: `SELECT count(*)::bigint AS n FROM feedback.user_reports WHERE report_type_code = $2`,
        ...makeSchemas(
            CODE_SNAKE,
            { code: CODE_SNAKE, name: requiredText(200) },
            { name: requiredText(200).optional() },
        ),
    },
    "report-statuses": {
        key: "report-statuses",
        table: "ref_report_statuses",
        label: "Report statuses",
        singularLabel: "Report status",
        description: "User report workflow statuses (linked by code).",
        fields: codeNameFields,
        columns: ["id", "code", "name", "created_at"],
        orderBy: ["name ASC"],
        hasUpdatedAt: false,
        hierarchical: false,
        usageSql: `SELECT (
            (SELECT count(*) FROM feedback.user_reports WHERE status_code = $2) +
            (SELECT count(*) FROM feedback.report_status_events WHERE new_status_code = $2)
          )::bigint AS n`,
        ...makeSchemas(
            CODE_SNAKE,
            { code: CODE_SNAKE, name: requiredText(200) },
            { name: requiredText(200).optional() },
        ),
    },
    "land-area-classes": {
        key: "land-area-classes",
        table: "ref_land_area_classes",
        label: "Land area classes",
        singularLabel: "Land area class",
        description: "Classes for land-use polygons.",
        fields: landFields,
        columns: [
            "id",
            "code",
            "name_en",
            "name_mm",
            "parent_id",
            "sort_order",
            "min_zoom",
            "default_import_confidence",
            "is_public",
            "is_active",
            "created_at",
            "updated_at",
        ],
        orderBy: ["sort_order ASC", "name_en ASC"],
        hasUpdatedAt: true,
        hierarchical: true,
        usageSql: `SELECT count(*)::bigint AS n FROM core.core_land_areas WHERE land_area_class_id = $1::bigint`,
        ...makeSchemas(
            CODE_SEGMENT,
            {
                code: CODE_SEGMENT,
                name_en: requiredText(200),
                name_mm: optionalText,
                parent_id: optionalParentId,
                sort_order: z.number().int().min(0).max(100000).default(100),
                min_zoom: z.number().min(0).max(24).default(12),
                default_import_confidence: z.number().min(0).max(100).default(70),
                is_public: requiredBoolean.default(true),
                is_active: requiredBoolean.default(true),
            },
            {
                name_en: requiredText(200).optional(),
                name_mm: optionalText,
                parent_id: optionalParentId,
                sort_order: z.number().int().min(0).max(100000).optional(),
                min_zoom: z.number().min(0).max(24).optional(),
                default_import_confidence: z.number().min(0).max(100).optional(),
                is_public: optionalBoolean,
                is_active: optionalBoolean,
            },
        ),
    },
    "water-classes": {
        key: "water-classes",
        table: "ref_water_classes",
        label: "Water classes",
        singularLabel: "Water class",
        description: "Classes for water lines and polygons.",
        fields: waterFields,
        columns: [
            "id",
            "code",
            "name_en",
            "name_mm",
            "parent_id",
            "sort_order",
            "min_zoom",
            "is_public",
            "is_active",
            "created_at",
            "updated_at",
        ],
        orderBy: ["sort_order ASC", "name_en ASC"],
        hasUpdatedAt: true,
        hierarchical: true,
        usageSql: `SELECT (
            (SELECT count(*) FROM core.core_water_polygons WHERE water_class_id = $1::bigint) +
            (SELECT count(*) FROM core.core_water_lines WHERE water_class_id = $1::bigint)
          )::bigint AS n`,
        ...makeSchemas(
            CODE_SEGMENT,
            {
                code: CODE_SEGMENT,
                name_en: requiredText(200),
                name_mm: optionalText,
                parent_id: optionalParentId,
                sort_order: z.number().int().min(0).max(100000).default(100),
                min_zoom: z.number().min(0).max(24).default(12),
                is_public: requiredBoolean.default(true),
                is_active: requiredBoolean.default(true),
            },
            {
                name_en: requiredText(200).optional(),
                name_mm: optionalText,
                parent_id: optionalParentId,
                sort_order: z.number().int().min(0).max(100000).optional(),
                min_zoom: z.number().min(0).max(24).optional(),
                is_public: optionalBoolean,
                is_active: optionalBoolean,
            },
        ),
    },
    "boundary-statuses": {
        key: "boundary-statuses",
        table: "ref_boundary_statuses",
        label: "Boundary statuses",
        singularLabel: "Boundary status",
        description: "Official vs approximate boundary status for admin areas.",
        fields: boundaryFields,
        columns: [
            "id",
            "code",
            "name_en",
            "name_mm",
            "helper_en",
            "helper_mm",
            "sort_order",
            "default_is_official_boundary",
            "default_boundary_confidence_score",
            "default_address_usage_code",
            "is_active",
            "created_at",
            "updated_at",
        ],
        orderBy: ["sort_order ASC", "name_en ASC"],
        hasUpdatedAt: true,
        hierarchical: false,
        ...makeSchemas(
            CODE_SEGMENT,
            {
                code: CODE_SEGMENT,
                name_en: requiredText(200),
                name_mm: optionalText,
                helper_en: optionalText,
                helper_mm: optionalText,
                sort_order: z.number().int().min(0).max(100000).default(100),
                default_is_official_boundary: requiredBoolean.default(false),
                default_boundary_confidence_score: z.number().min(0).max(100).default(60),
                default_address_usage_code: optionalText,
                is_active: requiredBoolean.default(true),
            },
            {
                name_en: requiredText(200).optional(),
                name_mm: optionalText,
                helper_en: optionalText,
                helper_mm: optionalText,
                sort_order: z.number().int().min(0).max(100000).optional(),
                default_is_official_boundary: optionalBoolean,
                default_boundary_confidence_score: z.number().min(0).max(100).optional(),
                default_address_usage_code: optionalText,
                is_active: optionalBoolean,
            },
        ),
    },
    "address-usage-types": {
        key: "address-usage-types",
        table: "ref_address_usage_types",
        label: "Address usage types",
        singularLabel: "Address usage type",
        description: "How admin areas participate in address composition.",
        fields: addressUsageFields,
        columns: [
            "id",
            "code",
            "name_en",
            "name_mm",
            "helper_en",
            "helper_mm",
            "sort_order",
            "is_active",
            "created_at",
            "updated_at",
        ],
        orderBy: ["sort_order ASC", "name_en ASC"],
        hasUpdatedAt: true,
        hierarchical: false,
        usageSql: `SELECT count(*)::bigint AS n FROM ref.ref_boundary_statuses WHERE default_address_usage_code = $2`,
        ...makeSchemas(
            CODE_SEGMENT,
            {
                code: CODE_SEGMENT,
                name_en: requiredText(200),
                name_mm: optionalText,
                helper_en: optionalText,
                helper_mm: optionalText,
                sort_order: z.number().int().min(0).max(100000).default(100),
                is_active: requiredBoolean.default(true),
            },
            {
                name_en: requiredText(200).optional(),
                name_mm: optionalText,
                helper_en: optionalText,
                helper_mm: optionalText,
                sort_order: z.number().int().min(0).max(100000).optional(),
                is_active: optionalBoolean,
            },
        ),
    },
    "protected-area-classes": {
        key: "protected-area-classes",
        table: "ref_protected_area_classes",
        label: "Protected area classes",
        singularLabel: "Protected area class",
        description: "Classes for protected areas and reserves.",
        fields: protectedFields,
        columns: [
            "id",
            "code",
            "name_en",
            "name_mm",
            "sort_order",
            "is_public",
            "is_active",
            "created_at",
            "updated_at",
        ],
        orderBy: ["sort_order ASC", "name_en ASC"],
        hasUpdatedAt: true,
        hierarchical: false,
        usageSql: `SELECT count(*)::bigint AS n FROM core.core_protected_areas WHERE protected_area_class_id = $1::bigint`,
        ...makeSchemas(
            CODE_SNAKE,
            {
                code: CODE_SNAKE,
                name_en: requiredText(200),
                name_mm: optionalText,
                sort_order: z.number().int().min(0).max(100000).default(0),
                is_public: requiredBoolean.default(true),
                is_active: requiredBoolean.default(true),
            },
            {
                name_en: requiredText(200).optional(),
                name_mm: optionalText,
                sort_order: z.number().int().min(0).max(100000).optional(),
                is_public: optionalBoolean,
                is_active: optionalBoolean,
            },
        ),
    },
    "tourism-types": {
        key: "tourism-types",
        table: "ref_tourism_types",
        label: "Tourism types",
        singularLabel: "Tourism type",
        description: "Tourism profile categories.",
        fields: tourismLikeFields,
        columns: [
            "id",
            "code",
            "name_en",
            "name_mm",
            "description",
            "sort_order",
            "is_active",
            "created_at",
            "updated_at",
        ],
        orderBy: ["sort_order ASC", "name_en ASC"],
        hasUpdatedAt: true,
        hierarchical: false,
        usageSql: `SELECT count(*)::bigint AS n FROM tourism.place_profiles WHERE tourism_type_id = $1::bigint`,
        ...makeSchemas(
            CODE_SNAKE,
            {
                code: CODE_SNAKE,
                name_en: requiredText(120),
                name_mm: optionalText,
                description: optionalText,
                sort_order: z.number().int().min(0).max(100000).default(0),
                is_active: requiredBoolean.default(true),
            },
            {
                name_en: requiredText(120).optional(),
                name_mm: optionalText,
                description: optionalText,
                sort_order: z.number().int().min(0).max(100000).optional(),
                is_active: optionalBoolean,
            },
        ),
    },
    "activity-types": {
        key: "activity-types",
        table: "ref_activity_types",
        label: "Activity types",
        singularLabel: "Activity type",
        description: "Tourism activity categories.",
        fields: tourismLikeFields,
        columns: [
            "id",
            "code",
            "name_en",
            "name_mm",
            "description",
            "sort_order",
            "is_active",
            "created_at",
            "updated_at",
        ],
        orderBy: ["sort_order ASC", "name_en ASC"],
        hasUpdatedAt: true,
        hierarchical: false,
        usageSql: `SELECT count(*)::bigint AS n FROM tourism.activities WHERE activity_type_id = $1::bigint`,
        ...makeSchemas(
            CODE_SNAKE,
            {
                code: CODE_SNAKE,
                name_en: requiredText(120),
                name_mm: optionalText,
                description: optionalText,
                sort_order: z.number().int().min(0).max(100000).default(100),
                is_active: requiredBoolean.default(true),
            },
            {
                name_en: requiredText(120).optional(),
                name_mm: optionalText,
                description: optionalText,
                sort_order: z.number().int().min(0).max(100000).optional(),
                is_active: optionalBoolean,
            },
        ),
    },
    "event-types": {
        key: "event-types",
        table: "ref_event_types",
        label: "Event types",
        singularLabel: "Event type",
        description: "Tourism event categories.",
        fields: tourismLikeFields,
        columns: [
            "id",
            "code",
            "name_en",
            "name_mm",
            "description",
            "sort_order",
            "is_active",
            "created_at",
            "updated_at",
        ],
        orderBy: ["sort_order ASC", "name_en ASC"],
        hasUpdatedAt: true,
        hierarchical: false,
        usageSql: `SELECT count(*)::bigint AS n FROM tourism.events WHERE event_type_id = $1::bigint`,
        ...makeSchemas(
            CODE_SNAKE,
            {
                code: CODE_SNAKE,
                name_en: requiredText(120),
                name_mm: optionalText,
                description: optionalText,
                sort_order: z.number().int().min(0).max(100000).default(100),
                is_active: requiredBoolean.default(true),
            },
            {
                name_en: requiredText(120).optional(),
                name_mm: optionalText,
                description: optionalText,
                sort_order: z.number().int().min(0).max(100000).optional(),
                is_active: optionalBoolean,
            },
        ),
    },
};

const KEY_SET = new Set<string>(REFERENCE_TYPE_KEYS);

export function isReferenceTypeKey(value: string): value is ReferenceTypeKey {
    return KEY_SET.has(value);
}

export function getReferenceConfig(type: ReferenceTypeKey): ReferenceTableConfig {
    return REGISTRY[type];
}

export function listReferenceConfigs(): ReferenceTableConfig[] {
    return REFERENCE_TYPE_KEYS.map((key) => REGISTRY[key]);
}

/** Allowlisted physical table names only. */
export const ALLOWED_REF_TABLES = new Set(listReferenceConfigs().map((c) => c.table));
