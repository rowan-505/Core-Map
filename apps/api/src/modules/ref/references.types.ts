/** Allowlisted route keys for `/admin/references/:type`. Never accept client table names. */
export const REFERENCE_TYPE_KEYS = [
    "poi-categories",
    "road-classes",
    "building-types",
    "admin-levels",
    "admin-area-types",
    "settlement-types",
    "source-types",
    "address-component-types",
    "publish-statuses",
    "report-types",
    "report-statuses",
    "land-area-classes",
    "water-classes",
    "boundary-statuses",
    "address-usage-types",
    "protected-area-classes",
    "tourism-types",
    "activity-types",
    "event-types",
] as const;

export type ReferenceTypeKey = (typeof REFERENCE_TYPE_KEYS)[number];

export type ReferenceFieldKind =
    | "text"
    | "textarea"
    | "number"
    | "boolean"
    | "parent"
    | "select";

export type ReferenceFieldDef = {
    key: string;
    label: string;
    kind: ReferenceFieldKind;
    required?: boolean;
    /** Present on create only; never accepted on PATCH (codes are immutable). */
    createOnly?: boolean;
    /** Shown in table / list responses. */
    list?: boolean;
    /** Editable in create/edit forms when not createOnly. */
    editable?: boolean;
    /** Optional select options (e.g. ranking_group). */
    options?: readonly string[];
    min?: number;
    max?: number;
};

export type ReferenceCatalogItem = {
    type: ReferenceTypeKey;
    label: string;
    singular_label: string;
    description: string;
    row_count: number;
    hierarchical: boolean;
};

export type ReferenceListResponse = {
    type: ReferenceTypeKey;
    label: string;
    singular_label: string;
    description: string;
    hierarchical: boolean;
    fields: ReferenceFieldDef[];
    items: Record<string, unknown>[];
};
