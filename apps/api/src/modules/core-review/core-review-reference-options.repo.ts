import type { PrismaClient } from "@prisma/client";

export type CoreReviewReferenceOptionRow = {
    id: string;
    code: string | null;
    name: string | null;
};

export type CoreReviewReferenceOptionsBundle = {
    ref_poi_categories: CoreReviewReferenceOptionRow[];
    ref_road_classes: CoreReviewReferenceOptionRow[];
    ref_building_types: CoreReviewReferenceOptionRow[];
    ref_admin_levels: CoreReviewReferenceOptionRow[];
    ref_address_component_types: CoreReviewReferenceOptionRow[];
    ref_source_types: CoreReviewReferenceOptionRow[];
    core_admin_areas: CoreReviewReferenceOptionRow[];
};

async function tableExists(prisma: PrismaClient, qualified: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT to_regclass(${qualified}) IS NOT NULL AS ok
    `;
    return rows[0]?.ok === true;
}

function mapIdLabel(rows: { id: bigint; code?: string | null; name?: string | null }[]): CoreReviewReferenceOptionRow[] {
    return rows.map((r) => ({
        id: r.id.toString(),
        code: r.code ?? null,
        name: r.name ?? null,
    }));
}

/** Dropdown options from ref.* / core.* for Core Review forms (no import_review schema). */
export class CoreReviewReferenceOptionsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async fetchAll(): Promise<CoreReviewReferenceOptionsBundle> {
        const empty: CoreReviewReferenceOptionsBundle = {
            ref_poi_categories: [],
            ref_road_classes: [],
            ref_building_types: [],
            ref_admin_levels: [],
            ref_address_component_types: [],
            ref_source_types: [],
            core_admin_areas: [],
        };

        if (await tableExists(this.prisma, "ref.ref_poi_categories")) {
            const rows = await this.prisma.$queryRaw<{ id: bigint; code: string; name: string }[]>`
                SELECT id, code, name
                FROM ref.ref_poi_categories
                WHERE is_public = true
                  AND is_searchable = true
                ORDER BY sort_order ASC NULLS LAST, name ASC
            `;
            empty.ref_poi_categories = mapIdLabel(rows);
        }

        if (await tableExists(this.prisma, "ref.ref_road_classes")) {
            const rows = await this.prisma.$queryRaw<{ id: bigint; code: string; name: string | null }[]>`
                SELECT id, code, name
                FROM ref.ref_road_classes
                ORDER BY code ASC
            `;
            empty.ref_road_classes = mapIdLabel(rows);
        }

        if (await tableExists(this.prisma, "ref.ref_building_types")) {
            const rows = await this.prisma.$queryRaw<{ id: bigint; code: string; name: string }[]>`
                SELECT id, code, name
                FROM ref.ref_building_types
                WHERE is_active IS TRUE
                  AND parent_id IS NULL
                ORDER BY sort_order ASC NULLS LAST, name ASC
            `;
            empty.ref_building_types = mapIdLabel(rows);
        }

        if (await tableExists(this.prisma, "ref.ref_admin_levels")) {
            const rows = await this.prisma.$queryRaw<{ id: bigint; code: string; name: string }[]>`
                SELECT id, code, name
                FROM ref.ref_admin_levels
                ORDER BY rank ASC NULLS LAST, name ASC
            `;
            empty.ref_admin_levels = mapIdLabel(rows);
        }

        if (await tableExists(this.prisma, "ref.ref_address_component_types")) {
            const rows = await this.prisma.$queryRaw<{ id: bigint; code: string; name: string }[]>`
                SELECT id, code, name
                FROM ref.ref_address_component_types
                ORDER BY rank ASC NULLS LAST, name ASC
            `;
            empty.ref_address_component_types = mapIdLabel(rows);
        }

        if (await tableExists(this.prisma, "ref.ref_source_types")) {
            const rows = await this.prisma.$queryRaw<{ id: bigint; code: string; name: string }[]>`
                SELECT id, code, name
                FROM ref.ref_source_types
                ORDER BY code ASC
            `;
            empty.ref_source_types = mapIdLabel(rows);
        }

        if (await tableExists(this.prisma, "core.core_admin_areas")) {
            const rows = await this.prisma.$queryRaw<{ id: bigint; code: string | null; name: string | null }[]>`
                SELECT id, slug AS code, canonical_name AS name
                FROM core.core_admin_areas
                WHERE is_active = true
                ORDER BY canonical_name ASC NULLS LAST
                LIMIT 500
            `;
            empty.core_admin_areas = mapIdLabel(rows);
        }

        return empty;
    }
}
