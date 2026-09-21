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
    createOnly?: boolean;
    list?: boolean;
    editable?: boolean;
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

export type ReferenceUiConfig = {
    key: ReferenceTypeKey;
    label: string;
    singularLabel: string;
    description: string;
};
