import { Prisma, type PrismaClient } from "@prisma/client";

export type PostalCodeLookupRow = {
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
};

async function postalCodesTableExists(prisma: PrismaClient): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT to_regclass('ref.ref_postal_codes') IS NOT NULL AS ok
    `;
    return rows[0]?.ok === true;
}

export class PostalCodesRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async findByPostalCode(postalCode: string): Promise<PostalCodeLookupRow | null> {
        if (!(await postalCodesTableExists(this.prisma))) {
            return null;
        }
        // DB columns are *_mm; API still returns *_my.
        const rows = await this.prisma.$queryRaw<PostalCodeLookupRow[]>`
            SELECT
                postal_code,
                region_name_en,
                region_name_mm AS region_name_my,
                township_name_en,
                township_name_mm AS township_name_my,
                locality_name_en,
                locality_name_mm AS locality_name_my,
                locality_type,
                township_admin_area_id,
                local_admin_area_id,
                match_status,
                match_method,
                coalesce(source_name, 'Myanmar Post') AS source_name,
                source_version
            FROM ref.ref_postal_codes
            WHERE postal_code = ${postalCode}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async search(args: {
        limit: number;
        offset: number;
        q?: string;
        postalCode?: string;
        locality?: string;
        matchStatus?: string;
        adminAreaId?: bigint;
    }): Promise<{ rows: PostalCodeLookupRow[]; total: number }> {
        if (!(await postalCodesTableExists(this.prisma))) {
            return { rows: [], total: 0 };
        }
        const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];

        if (args.postalCode) {
            parts.push(Prisma.sql`p.postal_code = ${args.postalCode}`);
        }
        if (args.matchStatus) {
            parts.push(Prisma.sql`p.match_status = ${args.matchStatus}`);
        }
        if (args.adminAreaId !== undefined) {
            parts.push(Prisma.sql`(
                p.township_admin_area_id = ${args.adminAreaId}
                OR p.local_admin_area_id = ${args.adminAreaId}
            )`);
        }
        if (args.locality) {
            const pattern = `%${args.locality}%`;
            parts.push(Prisma.sql`(
                coalesce(p.locality_name_en, '') ILIKE ${pattern}
                OR coalesce(p.locality_name_mm, '') ILIKE ${pattern}
                OR coalesce(p.township_name_en, '') ILIKE ${pattern}
                OR coalesce(p.township_name_mm, '') ILIKE ${pattern}
            )`);
        }
        if (args.q) {
            const q = args.q.trim();
            if (/^[0-9]{1,7}$/.test(q)) {
                parts.push(Prisma.sql`p.postal_code LIKE ${`${q}%`}`);
            } else {
                const pattern = `%${q}%`;
                parts.push(Prisma.sql`(
                    p.postal_code ILIKE ${pattern}
                    OR coalesce(p.locality_name_en, '') ILIKE ${pattern}
                    OR coalesce(p.locality_name_mm, '') ILIKE ${pattern}
                    OR coalesce(p.township_name_en, '') ILIKE ${pattern}
                    OR coalesce(p.township_name_mm, '') ILIKE ${pattern}
                    OR coalesce(p.region_name_en, '') ILIKE ${pattern}
                    OR coalesce(p.region_name_mm, '') ILIKE ${pattern}
                )`);
            }
        }

        const whereSql = Prisma.join(parts, " AND ");

        const totalRows = await this.prisma.$queryRaw<[{ count: bigint }]>`
            SELECT count(*)::bigint AS count
            FROM ref.ref_postal_codes AS p
            WHERE ${whereSql}
        `;

        const rows = await this.prisma.$queryRaw<PostalCodeLookupRow[]>`
            SELECT
                p.postal_code,
                p.region_name_en,
                p.region_name_mm AS region_name_my,
                p.township_name_en,
                p.township_name_mm AS township_name_my,
                p.locality_name_en,
                p.locality_name_mm AS locality_name_my,
                p.locality_type,
                p.township_admin_area_id,
                p.local_admin_area_id,
                p.match_status,
                p.match_method,
                coalesce(p.source_name, 'Myanmar Post') AS source_name,
                p.source_version
            FROM ref.ref_postal_codes AS p
            WHERE ${whereSql}
            ORDER BY p.postal_code ASC
            LIMIT ${args.limit}
            OFFSET ${args.offset}
        `;

        return { rows, total: Number(totalRows[0]?.count ?? 0n) };
    }
}
