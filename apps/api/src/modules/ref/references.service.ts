import {
    getReferenceConfig,
    isReferenceTypeKey,
    listReferenceConfigs,
} from "./references.registry.js";
import {
    isForeignKeyViolation,
    isUniqueViolation,
    ReferencesRepository,
} from "./references.repo.js";
import type {
    ReferenceCatalogItem,
    ReferenceListResponse,
    ReferenceTypeKey,
} from "./references.types.js";

export class ReferencesError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
    ) {
        super(message);
        this.name = "ReferencesError";
    }
}

function stripUndefined(data: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
            out[key] = value;
        }
    }
    return out;
}

export class ReferencesService {
    constructor(private readonly repo: ReferencesRepository) {}

    resolveType(type: string): ReferenceTypeKey {
        if (!isReferenceTypeKey(type)) {
            throw new ReferencesError("Unknown reference type.", 404);
        }
        return type;
    }

    async catalog(): Promise<ReferenceCatalogItem[]> {
        const counts = await this.repo.countAllRows();
        return listReferenceConfigs().map((config) => ({
            type: config.key,
            label: config.label,
            singular_label: config.singularLabel,
            description: config.description,
            row_count: counts.get(config.key) ?? 0,
            hierarchical: config.hierarchical,
        }));
    }

    async list(type: string): Promise<ReferenceListResponse> {
        const key = this.resolveType(type);
        const config = getReferenceConfig(key);
        const items = await this.repo.list(config);
        return {
            type: config.key,
            label: config.label,
            singular_label: config.singularLabel,
            description: config.description,
            hierarchical: config.hierarchical,
            fields: [...config.fields],
            items,
        };
    }

    async create(type: string, body: unknown): Promise<Record<string, unknown>> {
        const key = this.resolveType(type);
        const config = getReferenceConfig(key);
        const parsed = config.createSchema.safeParse(body);
        if (!parsed.success) {
            throw new ReferencesError("Invalid reference payload.", 400);
        }
        const data = stripUndefined({ ...parsed.data });

        if (config.hierarchical && data.parent_id != null) {
            const parentOk = await this.repo.existsId(config, String(data.parent_id));
            if (!parentOk) {
                throw new ReferencesError("Parent reference row was not found.", 400);
            }
        }

        try {
            const row = await this.repo.create(config, data);
            // New rows are unused; avoid a heavy usage scan on write.
            return { ...row, usage_count: config.usageAggregate ? 0 : null };
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new ReferencesError("A reference with this code or unique value already exists.", 409);
            }
            if (isForeignKeyViolation(error)) {
                throw new ReferencesError(
                    "This change conflicts with related production data.",
                    409,
                );
            }
            throw error;
        }
    }

    async update(type: string, id: string, body: unknown): Promise<Record<string, unknown>> {
        const key = this.resolveType(type);
        const config = getReferenceConfig(key);

        if (!/^\d+$/.test(id)) {
            throw new ReferencesError("Invalid reference id.", 400);
        }

        if (
            body &&
            typeof body === "object" &&
            "code" in (body as Record<string, unknown>)
        ) {
            throw new ReferencesError("Reference codes are immutable after creation.", 409);
        }

        const parsed = config.patchSchema.safeParse(body);
        if (!parsed.success) {
            throw new ReferencesError("Invalid reference payload.", 400);
        }
        const data = stripUndefined({ ...parsed.data });

        const existing = await this.repo.findById(config, id);
        if (!existing) {
            throw new ReferencesError("Reference row was not found.", 404);
        }

        if (config.hierarchical && Object.prototype.hasOwnProperty.call(data, "parent_id")) {
            const parentId = data.parent_id;
            if (parentId != null) {
                if (String(parentId) === id) {
                    throw new ReferencesError("A reference cannot be its own parent.", 409);
                }
                const parentOk = await this.repo.existsId(config, String(parentId));
                if (!parentOk) {
                    throw new ReferencesError("Parent reference row was not found.", 400);
                }
                const cycle = await this.repo.wouldCreateHierarchyCycle(
                    config,
                    id,
                    String(parentId),
                );
                if (cycle) {
                    throw new ReferencesError(
                        "This parent would create a hierarchy cycle.",
                        409,
                    );
                }
            }
        }

        try {
            const row = await this.repo.update(config, id, data);
            // Name/flag edits do not change FK usage; list refresh has accurate values.
            return { ...row, usage_count: null };
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new ReferencesError("A reference with this unique value already exists.", 409);
            }
            if (isForeignKeyViolation(error)) {
                throw new ReferencesError(
                    "This change conflicts with related production data.",
                    409,
                );
            }
            throw error;
        }
    }
}
