/**
 * Repository for tourism.foods, food_place_links, local_guides, advisories.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

export type VisitorAuditContext = {
    ipAddress?: string | null;
    userAgent?: string | null;
};

export const TOURISM_FOOD_AUDIT_ENTITY = "tourism_food";
export const TOURISM_FOOD_PLACE_LINK_AUDIT_ENTITY = "tourism_food_place_link";
export const TOURISM_GUIDE_AUDIT_ENTITY = "tourism_local_guide";
export const TOURISM_ADVISORY_AUDIT_ENTITY = "tourism_advisory";

export type TourismFoodRow = {
    id: bigint;
    publicId: string;
    name: string;
    nameEn: string | null;
    nameMm: string | null;
    shortDescription: string | null;
    foodType: string;
    labels: string[];
    adminAreaId: bigint;
    adminAreaName: string;
    isActive: boolean;
    isVerified: boolean;
    sourceUrl: string | null;
    verifiedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

export type TourismFoodPlaceLinkRow = {
    id: bigint;
    foodId: bigint;
    foodPublicId: string;
    placeId: bigint;
    placePublicId: string;
    placeName: string;
    placeLat: number | null;
    placeLng: number | null;
    placeIsPublic: boolean;
    availabilityNote: string | null;
    isSignatureHere: boolean;
    isVerified: boolean;
    sourceUrl: string | null;
    verifiedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

export type TourismGuideRow = {
    id: bigint;
    publicId: string;
    adminAreaId: bigint;
    adminAreaName: string;
    placeId: bigint | null;
    placePublicId: string | null;
    placeName: string | null;
    guideType: string;
    title: string;
    shortDescription: string | null;
    content: string;
    isActive: boolean;
    isVerified: boolean;
    sourceUrl: string | null;
    verifiedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

export type TourismAdvisoryRow = {
    id: bigint;
    publicId: string;
    adminAreaId: bigint;
    adminAreaName: string;
    placeId: bigint | null;
    placePublicId: string | null;
    placeName: string | null;
    activityId: bigint | null;
    activityPublicId: string | null;
    activityName: string | null;
    eventId: bigint | null;
    eventPublicId: string | null;
    eventName: string | null;
    advisoryType: string;
    title: string;
    description: string;
    severity: string;
    effectiveFrom: Date | null;
    effectiveUntil: Date | null;
    isActive: boolean;
    isVerified: boolean;
    sourceUrl: string | null;
    verifiedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

type Tx = Prisma.TransactionClient;

export class TourismVisitorRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async findUsableUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM app_auth.auth_users
            WHERE public_id::text = ${publicId}
              AND deleted_at IS NULL
              AND is_active = true
              AND account_status = 'active'
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async findActiveAdminAreaId(adminAreaId: bigint): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM core.core_admin_areas
            WHERE id = ${adminAreaId}
              AND is_active = true
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async findActivePlaceIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM core.core_places
            WHERE public_id::text = ${publicId}
              AND deleted_at IS NULL
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async findActivityIdByPublicId(publicId: string): Promise<bigint | null> {
        const row = await this.prisma.tourismActivity.findFirst({
            where: { publicId },
            select: { id: true },
        });
        return row?.id ?? null;
    }

    async findEventIdByPublicId(publicId: string): Promise<bigint | null> {
        const row = await this.prisma.tourismEvent.findFirst({
            where: { publicId },
            select: { id: true },
        });
        return row?.id ?? null;
    }

    // --- Foods ---

    async listFoods(input: {
        adminAreaId?: bigint;
        foodType?: string;
        label?: string;
        isActive?: boolean;
        isVerified?: boolean;
        q?: string;
        publicOnly: boolean;
        limit: number;
        offset: number;
    }): Promise<{ rows: TourismFoodRow[]; total: number }> {
        const filters: Prisma.Sql[] = [];
        if (input.publicOnly) {
            filters.push(Prisma.sql`f.is_active = true`);
            filters.push(Prisma.sql`f.is_verified = true`);
        }
        if (input.adminAreaId !== undefined) {
            filters.push(Prisma.sql`f.admin_area_id = ${input.adminAreaId}`);
        }
        if (input.foodType) {
            filters.push(Prisma.sql`f.food_type = ${input.foodType}`);
        }
        if (input.label) {
            filters.push(Prisma.sql`${input.label} = ANY (f.labels)`);
        }
        if (input.isActive !== undefined) {
            filters.push(Prisma.sql`f.is_active = ${input.isActive}`);
        }
        if (input.isVerified !== undefined) {
            filters.push(Prisma.sql`f.is_verified = ${input.isVerified}`);
        }
        if (input.q) {
            const pattern = `%${input.q}%`;
            filters.push(Prisma.sql`(
                f.name ILIKE ${pattern}
                OR COALESCE(f.name_en, '') ILIKE ${pattern}
                OR COALESCE(f.name_mm, '') ILIKE ${pattern}
            )`);
        }
        const whereSql =
            filters.length > 0
                ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`
                : Prisma.empty;

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM tourism.foods AS f
            ${whereSql}
        `);
        const total = Number(countRows[0]?.count ?? 0n);

        const rows = await this.prisma.$queryRaw<TourismFoodRow[]>(Prisma.sql`
            SELECT
                f.id,
                f.public_id::text AS "publicId",
                f.name,
                f.name_en AS "nameEn",
                f.name_mm AS "nameMm",
                f.short_description AS "shortDescription",
                f.food_type AS "foodType",
                f.labels,
                f.admin_area_id AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                f.is_active AS "isActive",
                f.is_verified AS "isVerified",
                f.source_url AS "sourceUrl",
                f.verified_at AS "verifiedAt",
                f.created_at AS "createdAt",
                f.updated_at AS "updatedAt"
            FROM tourism.foods AS f
            JOIN core.core_admin_areas AS aa ON aa.id = f.admin_area_id
            ${whereSql}
            ORDER BY f.name ASC, f.id ASC
            LIMIT ${input.limit}
            OFFSET ${input.offset}
        `);
        return { rows, total };
    }

    async findFoodByPublicId(publicId: string): Promise<TourismFoodRow | null> {
        return this.findFoodByPublicIdInTx(this.prisma, publicId);
    }

    async createFood(input: {
        actorUserId: bigint;
        name: string;
        nameEn: string | null;
        nameMm: string | null;
        shortDescription: string | null;
        foodType: string;
        labels: string[];
        adminAreaId: bigint;
        isActive: boolean;
        isVerified: boolean;
        sourceUrl: string | null;
        verifiedAt: Date | null;
        audit: VisitorAuditContext;
        afterSnapshot: Record<string, unknown>;
    }): Promise<TourismFoodRow> {
        return this.prisma.$transaction(async (tx) => {
            const created = await tx.tourismFood.create({
                data: {
                    name: input.name,
                    nameEn: input.nameEn,
                    nameMm: input.nameMm,
                    shortDescription: input.shortDescription,
                    foodType: input.foodType,
                    labels: input.labels,
                    adminAreaId: input.adminAreaId,
                    isActive: input.isActive,
                    isVerified: input.isVerified,
                    sourceUrl: input.sourceUrl,
                    verifiedAt: input.verifiedAt,
                    createdBy: input.actorUserId,
                    updatedBy: input.actorUserId,
                },
                select: { id: true, publicId: true },
            });
            await this.writeAudit(tx, {
                actorUserId: input.actorUserId,
                actionType: "tourism_food_created",
                entityType: TOURISM_FOOD_AUDIT_ENTITY,
                entityId: created.id,
                beforeSnapshot: null,
                afterSnapshot: input.afterSnapshot,
                audit: input.audit,
            });
            const row = await this.findFoodByPublicIdInTx(tx, created.publicId);
            if (!row) throw new Error("Created food could not be reloaded");
            return row;
        });
    }

    async updateFood(input: {
        foodId: bigint;
        publicId: string;
        actorUserId: bigint;
        data: {
            name?: string;
            nameEn?: string | null;
            nameMm?: string | null;
            shortDescription?: string | null;
            foodType?: string;
            labels?: string[];
            adminAreaId?: bigint;
            isActive?: boolean;
            isVerified?: boolean;
            sourceUrl?: string | null;
            verifiedAt?: Date | null;
        };
        beforeSnapshot: Record<string, unknown>;
        afterSnapshot: Record<string, unknown>;
        audit: VisitorAuditContext;
        actionType: string;
    }): Promise<TourismFoodRow> {
        return this.prisma.$transaction(async (tx) => {
            await tx.tourismFood.update({
                where: { id: input.foodId },
                data: {
                    ...input.data,
                    updatedBy: input.actorUserId,
                },
            });
            await this.writeAudit(tx, {
                actorUserId: input.actorUserId,
                actionType: input.actionType,
                entityType: TOURISM_FOOD_AUDIT_ENTITY,
                entityId: input.foodId,
                beforeSnapshot: input.beforeSnapshot,
                afterSnapshot: input.afterSnapshot,
                audit: input.audit,
            });
            const row = await this.findFoodByPublicIdInTx(tx, input.publicId);
            if (!row) throw new Error("Updated food could not be reloaded");
            return row;
        });
    }

    async listFoodPlaceLinks(
        foodId: bigint,
        opts: { publicPlacesOnly: boolean } = { publicPlacesOnly: false }
    ): Promise<TourismFoodPlaceLinkRow[]> {
        const publicFilter = opts.publicPlacesOnly
            ? Prisma.sql`AND p.is_public = true AND p.deleted_at IS NULL`
            : Prisma.sql`AND p.deleted_at IS NULL`;
        return this.prisma.$queryRaw<TourismFoodPlaceLinkRow[]>(Prisma.sql`
            SELECT
                l.id,
                l.food_id AS "foodId",
                f.public_id::text AS "foodPublicId",
                l.place_id AS "placeId",
                p.public_id::text AS "placePublicId",
                COALESCE(p.display_name, p.primary_name) AS "placeName",
                p.lat::double precision AS "placeLat",
                p.lng::double precision AS "placeLng",
                p.is_public AS "placeIsPublic",
                l.availability_note AS "availabilityNote",
                l.is_signature_here AS "isSignatureHere",
                l.is_verified AS "isVerified",
                l.source_url AS "sourceUrl",
                l.verified_at AS "verifiedAt",
                l.created_at AS "createdAt",
                l.updated_at AS "updatedAt"
            FROM tourism.food_place_links AS l
            JOIN tourism.foods AS f ON f.id = l.food_id
            JOIN core.core_places AS p ON p.id = l.place_id
            WHERE l.food_id = ${foodId}
            ${publicFilter}
            ORDER BY l.is_signature_here DESC, p.display_name ASC, l.id ASC
        `);
    }

    async findFoodPlaceLink(
        foodId: bigint,
        placeId: bigint
    ): Promise<TourismFoodPlaceLinkRow | null> {
        const rows = await this.listFoodPlaceLinks(foodId);
        return rows.find((row) => row.placeId === placeId) ?? null;
    }

    async createFoodPlaceLink(input: {
        actorUserId: bigint;
        foodId: bigint;
        placeId: bigint;
        availabilityNote: string | null;
        isSignatureHere: boolean;
        isVerified: boolean;
        sourceUrl: string | null;
        verifiedAt: Date | null;
        audit: VisitorAuditContext;
        afterSnapshot: Record<string, unknown>;
    }): Promise<TourismFoodPlaceLinkRow> {
        return this.prisma.$transaction(async (tx) => {
            try {
                const created = await tx.tourismFoodPlaceLink.create({
                    data: {
                        foodId: input.foodId,
                        placeId: input.placeId,
                        availabilityNote: input.availabilityNote,
                        isSignatureHere: input.isSignatureHere,
                        isVerified: input.isVerified,
                        sourceUrl: input.sourceUrl,
                        verifiedAt: input.verifiedAt,
                    },
                    select: { id: true },
                });
                await this.writeAudit(tx, {
                    actorUserId: input.actorUserId,
                    actionType: "tourism_food_place_link_created",
                    entityType: TOURISM_FOOD_PLACE_LINK_AUDIT_ENTITY,
                    entityId: created.id,
                    beforeSnapshot: null,
                    afterSnapshot: input.afterSnapshot,
                    audit: input.audit,
                });
            } catch (error) {
                if (
                    error instanceof Prisma.PrismaClientKnownRequestError &&
                    error.code === "P2002"
                ) {
                    throw Object.assign(new Error("FOOD_PLACE_LINK_EXISTS"), {
                        code: "FOOD_PLACE_LINK_EXISTS",
                    });
                }
                throw error;
            }
            const rows = await tx.$queryRaw<TourismFoodPlaceLinkRow[]>(Prisma.sql`
                SELECT
                    l.id,
                    l.food_id AS "foodId",
                    f.public_id::text AS "foodPublicId",
                    l.place_id AS "placeId",
                    p.public_id::text AS "placePublicId",
                    COALESCE(p.display_name, p.primary_name) AS "placeName",
                    p.lat::double precision AS "placeLat",
                    p.lng::double precision AS "placeLng",
                    p.is_public AS "placeIsPublic",
                    l.availability_note AS "availabilityNote",
                    l.is_signature_here AS "isSignatureHere",
                    l.is_verified AS "isVerified",
                    l.source_url AS "sourceUrl",
                    l.verified_at AS "verifiedAt",
                    l.created_at AS "createdAt",
                    l.updated_at AS "updatedAt"
                FROM tourism.food_place_links AS l
                JOIN tourism.foods AS f ON f.id = l.food_id
                JOIN core.core_places AS p ON p.id = l.place_id
                WHERE l.food_id = ${input.foodId}
                  AND l.place_id = ${input.placeId}
                LIMIT 1
            `);
            const row = rows[0];
            if (!row) throw new Error("Created food place link could not be reloaded");
            return row;
        });
    }

    async updateFoodPlaceLink(input: {
        linkId: bigint;
        foodId: bigint;
        placeId: bigint;
        actorUserId: bigint;
        data: {
            availabilityNote?: string | null;
            isSignatureHere?: boolean;
            isVerified?: boolean;
            sourceUrl?: string | null;
            verifiedAt?: Date | null;
        };
        beforeSnapshot: Record<string, unknown>;
        afterSnapshot: Record<string, unknown>;
        audit: VisitorAuditContext;
        actionType: string;
    }): Promise<TourismFoodPlaceLinkRow> {
        return this.prisma.$transaction(async (tx) => {
            await tx.tourismFoodPlaceLink.update({
                where: { id: input.linkId },
                data: input.data,
            });
            await this.writeAudit(tx, {
                actorUserId: input.actorUserId,
                actionType: input.actionType,
                entityType: TOURISM_FOOD_PLACE_LINK_AUDIT_ENTITY,
                entityId: input.linkId,
                beforeSnapshot: input.beforeSnapshot,
                afterSnapshot: input.afterSnapshot,
                audit: input.audit,
            });
            const rows = await tx.$queryRaw<TourismFoodPlaceLinkRow[]>(Prisma.sql`
                SELECT
                    l.id,
                    l.food_id AS "foodId",
                    f.public_id::text AS "foodPublicId",
                    l.place_id AS "placeId",
                    p.public_id::text AS "placePublicId",
                    COALESCE(p.display_name, p.primary_name) AS "placeName",
                    p.lat::double precision AS "placeLat",
                    p.lng::double precision AS "placeLng",
                    p.is_public AS "placeIsPublic",
                    l.availability_note AS "availabilityNote",
                    l.is_signature_here AS "isSignatureHere",
                    l.is_verified AS "isVerified",
                    l.source_url AS "sourceUrl",
                    l.verified_at AS "verifiedAt",
                    l.created_at AS "createdAt",
                    l.updated_at AS "updatedAt"
                FROM tourism.food_place_links AS l
                JOIN tourism.foods AS f ON f.id = l.food_id
                JOIN core.core_places AS p ON p.id = l.place_id
                WHERE l.id = ${input.linkId}
                LIMIT 1
            `);
            const row = rows[0];
            if (!row) throw new Error("Updated food place link could not be reloaded");
            return row;
        });
    }

    async deleteFoodPlaceLink(input: {
        linkId: bigint;
        actorUserId: bigint;
        beforeSnapshot: Record<string, unknown>;
        audit: VisitorAuditContext;
    }): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            await tx.tourismFoodPlaceLink.delete({ where: { id: input.linkId } });
            await this.writeAudit(tx, {
                actorUserId: input.actorUserId,
                actionType: "tourism_food_place_link_deleted",
                entityType: TOURISM_FOOD_PLACE_LINK_AUDIT_ENTITY,
                entityId: input.linkId,
                beforeSnapshot: input.beforeSnapshot,
                afterSnapshot: { deleted: true },
                audit: input.audit,
            });
        });
    }

    // --- Guides ---

    async listGuides(input: {
        adminAreaId?: bigint;
        placePublicId?: string;
        guideType?: string;
        isActive?: boolean;
        isVerified?: boolean;
        q?: string;
        publicOnly: boolean;
        limit: number;
        offset: number;
    }): Promise<{ rows: TourismGuideRow[]; total: number }> {
        const filters: Prisma.Sql[] = [];
        if (input.publicOnly) {
            filters.push(Prisma.sql`g.is_active = true`);
            filters.push(Prisma.sql`g.is_verified = true`);
        }
        if (input.adminAreaId !== undefined) {
            filters.push(Prisma.sql`g.admin_area_id = ${input.adminAreaId}`);
        }
        if (input.placePublicId) {
            filters.push(Prisma.sql`p.public_id::text = ${input.placePublicId}`);
        }
        if (input.guideType) {
            filters.push(Prisma.sql`g.guide_type = ${input.guideType}`);
        }
        if (input.isActive !== undefined) {
            filters.push(Prisma.sql`g.is_active = ${input.isActive}`);
        }
        if (input.isVerified !== undefined) {
            filters.push(Prisma.sql`g.is_verified = ${input.isVerified}`);
        }
        if (input.q) {
            const pattern = `%${input.q}%`;
            filters.push(Prisma.sql`(
                g.title ILIKE ${pattern}
                OR COALESCE(g.short_description, '') ILIKE ${pattern}
            )`);
        }
        const whereSql =
            filters.length > 0
                ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`
                : Prisma.empty;

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM tourism.local_guides AS g
            LEFT JOIN core.core_places AS p ON p.id = g.place_id
            ${whereSql}
        `);
        const total = Number(countRows[0]?.count ?? 0n);

        const rows = await this.prisma.$queryRaw<TourismGuideRow[]>(Prisma.sql`
            SELECT
                g.id,
                g.public_id::text AS "publicId",
                g.admin_area_id AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                g.place_id AS "placeId",
                p.public_id::text AS "placePublicId",
                COALESCE(p.display_name, p.primary_name) AS "placeName",
                g.guide_type AS "guideType",
                g.title,
                g.short_description AS "shortDescription",
                g.content,
                g.is_active AS "isActive",
                g.is_verified AS "isVerified",
                g.source_url AS "sourceUrl",
                g.verified_at AS "verifiedAt",
                g.created_at AS "createdAt",
                g.updated_at AS "updatedAt"
            FROM tourism.local_guides AS g
            JOIN core.core_admin_areas AS aa ON aa.id = g.admin_area_id
            LEFT JOIN core.core_places AS p ON p.id = g.place_id
            ${whereSql}
            ORDER BY g.title ASC, g.id ASC
            LIMIT ${input.limit}
            OFFSET ${input.offset}
        `);
        return { rows, total };
    }

    async findGuideByPublicId(publicId: string): Promise<TourismGuideRow | null> {
        return this.findGuideByPublicIdInTx(this.prisma, publicId);
    }

    async createGuide(input: {
        actorUserId: bigint;
        adminAreaId: bigint;
        placeId: bigint | null;
        guideType: string;
        title: string;
        shortDescription: string | null;
        content: string;
        isActive: boolean;
        isVerified: boolean;
        sourceUrl: string | null;
        verifiedAt: Date | null;
        audit: VisitorAuditContext;
        afterSnapshot: Record<string, unknown>;
    }): Promise<TourismGuideRow> {
        return this.prisma.$transaction(async (tx) => {
            const created = await tx.tourismLocalGuide.create({
                data: {
                    adminAreaId: input.adminAreaId,
                    placeId: input.placeId,
                    guideType: input.guideType,
                    title: input.title,
                    shortDescription: input.shortDescription,
                    content: input.content,
                    isActive: input.isActive,
                    isVerified: input.isVerified,
                    sourceUrl: input.sourceUrl,
                    verifiedAt: input.verifiedAt,
                    createdBy: input.actorUserId,
                    updatedBy: input.actorUserId,
                },
                select: { id: true, publicId: true },
            });
            await this.writeAudit(tx, {
                actorUserId: input.actorUserId,
                actionType: "tourism_local_guide_created",
                entityType: TOURISM_GUIDE_AUDIT_ENTITY,
                entityId: created.id,
                beforeSnapshot: null,
                afterSnapshot: input.afterSnapshot,
                audit: input.audit,
            });
            const row = await this.findGuideByPublicIdInTx(tx, created.publicId);
            if (!row) throw new Error("Created guide could not be reloaded");
            return row;
        });
    }

    async updateGuide(input: {
        guideId: bigint;
        publicId: string;
        actorUserId: bigint;
        data: {
            adminAreaId?: bigint;
            placeId?: bigint | null;
            guideType?: string;
            title?: string;
            shortDescription?: string | null;
            content?: string;
            isActive?: boolean;
            isVerified?: boolean;
            sourceUrl?: string | null;
            verifiedAt?: Date | null;
        };
        beforeSnapshot: Record<string, unknown>;
        afterSnapshot: Record<string, unknown>;
        audit: VisitorAuditContext;
        actionType: string;
    }): Promise<TourismGuideRow> {
        return this.prisma.$transaction(async (tx) => {
            await tx.tourismLocalGuide.update({
                where: { id: input.guideId },
                data: {
                    ...input.data,
                    updatedBy: input.actorUserId,
                },
            });
            await this.writeAudit(tx, {
                actorUserId: input.actorUserId,
                actionType: input.actionType,
                entityType: TOURISM_GUIDE_AUDIT_ENTITY,
                entityId: input.guideId,
                beforeSnapshot: input.beforeSnapshot,
                afterSnapshot: input.afterSnapshot,
                audit: input.audit,
            });
            const row = await this.findGuideByPublicIdInTx(tx, input.publicId);
            if (!row) throw new Error("Updated guide could not be reloaded");
            return row;
        });
    }

    // --- Advisories ---

    async listAdvisories(input: {
        adminAreaId?: bigint;
        placePublicId?: string;
        activityPublicId?: string;
        eventPublicId?: string;
        advisoryType?: string;
        severity?: string;
        isActive?: boolean;
        isVerified?: boolean;
        q?: string;
        publicOnly: boolean;
        now?: Date;
        limit: number;
        offset: number;
    }): Promise<{ rows: TourismAdvisoryRow[]; total: number }> {
        const filters: Prisma.Sql[] = [];
        if (input.publicOnly) {
            const now = input.now ?? new Date();
            filters.push(Prisma.sql`a.is_active = true`);
            filters.push(Prisma.sql`a.is_verified = true`);
            filters.push(Prisma.sql`(a.effective_from IS NULL OR a.effective_from <= ${now})`);
            filters.push(Prisma.sql`(a.effective_until IS NULL OR a.effective_until >= ${now})`);
        }
        if (input.adminAreaId !== undefined) {
            filters.push(Prisma.sql`a.admin_area_id = ${input.adminAreaId}`);
        }
        if (input.placePublicId) {
            filters.push(Prisma.sql`p.public_id::text = ${input.placePublicId}`);
        }
        if (input.activityPublicId) {
            filters.push(Prisma.sql`act.public_id::text = ${input.activityPublicId}`);
        }
        if (input.eventPublicId) {
            filters.push(Prisma.sql`ev.public_id::text = ${input.eventPublicId}`);
        }
        if (input.advisoryType) {
            filters.push(Prisma.sql`a.advisory_type = ${input.advisoryType}`);
        }
        if (input.severity) {
            filters.push(Prisma.sql`a.severity = ${input.severity}`);
        }
        if (input.isActive !== undefined) {
            filters.push(Prisma.sql`a.is_active = ${input.isActive}`);
        }
        if (input.isVerified !== undefined) {
            filters.push(Prisma.sql`a.is_verified = ${input.isVerified}`);
        }
        if (input.q) {
            const pattern = `%${input.q}%`;
            filters.push(Prisma.sql`(
                a.title ILIKE ${pattern}
                OR a.description ILIKE ${pattern}
            )`);
        }
        const whereSql =
            filters.length > 0
                ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`
                : Prisma.empty;

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM tourism.advisories AS a
            LEFT JOIN core.core_places AS p ON p.id = a.place_id
            LEFT JOIN tourism.activities AS act ON act.id = a.activity_id
            LEFT JOIN tourism.events AS ev ON ev.id = a.event_id
            ${whereSql}
        `);
        const total = Number(countRows[0]?.count ?? 0n);

        const rows = await this.prisma.$queryRaw<TourismAdvisoryRow[]>(Prisma.sql`
            SELECT
                a.id,
                a.public_id::text AS "publicId",
                a.admin_area_id AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                a.place_id AS "placeId",
                p.public_id::text AS "placePublicId",
                COALESCE(p.display_name, p.primary_name) AS "placeName",
                a.activity_id AS "activityId",
                act.public_id::text AS "activityPublicId",
                act.name AS "activityName",
                a.event_id AS "eventId",
                ev.public_id::text AS "eventPublicId",
                ev.name AS "eventName",
                a.advisory_type AS "advisoryType",
                a.title,
                a.description,
                a.severity,
                a.effective_from AS "effectiveFrom",
                a.effective_until AS "effectiveUntil",
                a.is_active AS "isActive",
                a.is_verified AS "isVerified",
                a.source_url AS "sourceUrl",
                a.verified_at AS "verifiedAt",
                a.created_at AS "createdAt",
                a.updated_at AS "updatedAt"
            FROM tourism.advisories AS a
            JOIN core.core_admin_areas AS aa ON aa.id = a.admin_area_id
            LEFT JOIN core.core_places AS p ON p.id = a.place_id
            LEFT JOIN tourism.activities AS act ON act.id = a.activity_id
            LEFT JOIN tourism.events AS ev ON ev.id = a.event_id
            ${whereSql}
            ORDER BY
                CASE a.severity
                    WHEN 'important' THEN 0
                    WHEN 'caution' THEN 1
                    ELSE 2
                END,
                a.title ASC,
                a.id ASC
            LIMIT ${input.limit}
            OFFSET ${input.offset}
        `);
        return { rows, total };
    }

    async findAdvisoryByPublicId(publicId: string): Promise<TourismAdvisoryRow | null> {
        return this.findAdvisoryByPublicIdInTx(this.prisma, publicId);
    }

    async createAdvisory(input: {
        actorUserId: bigint;
        adminAreaId: bigint;
        placeId: bigint | null;
        activityId: bigint | null;
        eventId: bigint | null;
        advisoryType: string;
        title: string;
        description: string;
        severity: string;
        effectiveFrom: Date | null;
        effectiveUntil: Date | null;
        isActive: boolean;
        isVerified: boolean;
        sourceUrl: string | null;
        verifiedAt: Date | null;
        audit: VisitorAuditContext;
        afterSnapshot: Record<string, unknown>;
    }): Promise<TourismAdvisoryRow> {
        return this.prisma.$transaction(async (tx) => {
            const created = await tx.tourismAdvisory.create({
                data: {
                    adminAreaId: input.adminAreaId,
                    placeId: input.placeId,
                    activityId: input.activityId,
                    eventId: input.eventId,
                    advisoryType: input.advisoryType,
                    title: input.title,
                    description: input.description,
                    severity: input.severity,
                    effectiveFrom: input.effectiveFrom,
                    effectiveUntil: input.effectiveUntil,
                    isActive: input.isActive,
                    isVerified: input.isVerified,
                    sourceUrl: input.sourceUrl,
                    verifiedAt: input.verifiedAt,
                    createdBy: input.actorUserId,
                    updatedBy: input.actorUserId,
                },
                select: { id: true, publicId: true },
            });
            await this.writeAudit(tx, {
                actorUserId: input.actorUserId,
                actionType: "tourism_advisory_created",
                entityType: TOURISM_ADVISORY_AUDIT_ENTITY,
                entityId: created.id,
                beforeSnapshot: null,
                afterSnapshot: input.afterSnapshot,
                audit: input.audit,
            });
            const row = await this.findAdvisoryByPublicIdInTx(tx, created.publicId);
            if (!row) throw new Error("Created advisory could not be reloaded");
            return row;
        });
    }

    async updateAdvisory(input: {
        advisoryId: bigint;
        publicId: string;
        actorUserId: bigint;
        data: {
            adminAreaId?: bigint;
            placeId?: bigint | null;
            activityId?: bigint | null;
            eventId?: bigint | null;
            advisoryType?: string;
            title?: string;
            description?: string;
            severity?: string;
            effectiveFrom?: Date | null;
            effectiveUntil?: Date | null;
            isActive?: boolean;
            isVerified?: boolean;
            sourceUrl?: string | null;
            verifiedAt?: Date | null;
        };
        beforeSnapshot: Record<string, unknown>;
        afterSnapshot: Record<string, unknown>;
        audit: VisitorAuditContext;
        actionType: string;
    }): Promise<TourismAdvisoryRow> {
        return this.prisma.$transaction(async (tx) => {
            await tx.tourismAdvisory.update({
                where: { id: input.advisoryId },
                data: {
                    ...input.data,
                    updatedBy: input.actorUserId,
                },
            });
            await this.writeAudit(tx, {
                actorUserId: input.actorUserId,
                actionType: input.actionType,
                entityType: TOURISM_ADVISORY_AUDIT_ENTITY,
                entityId: input.advisoryId,
                beforeSnapshot: input.beforeSnapshot,
                afterSnapshot: input.afterSnapshot,
                audit: input.audit,
            });
            const row = await this.findAdvisoryByPublicIdInTx(tx, input.publicId);
            if (!row) throw new Error("Updated advisory could not be reloaded");
            return row;
        });
    }

    private async writeAudit(
        tx: Tx,
        input: {
            actorUserId: bigint;
            actionType: string;
            entityType: string;
            entityId: bigint;
            beforeSnapshot: Record<string, unknown> | null;
            afterSnapshot: Record<string, unknown>;
            audit: VisitorAuditContext;
        }
    ): Promise<void> {
        await tx.auditLog.create({
            data: {
                actorUserId: input.actorUserId,
                actionType: input.actionType,
                entityType: input.entityType,
                entityId: input.entityId,
                beforeSnapshot:
                    input.beforeSnapshot === null
                        ? Prisma.JsonNull
                        : (input.beforeSnapshot as Prisma.InputJsonValue),
                afterSnapshot: input.afterSnapshot as Prisma.InputJsonValue,
                ipAddress: input.audit.ipAddress ?? null,
                userAgent: input.audit.userAgent ?? null,
            },
        });
    }

    private async findFoodByPublicIdInTx(
        tx: Tx | PrismaClient,
        publicId: string
    ): Promise<TourismFoodRow | null> {
        const rows = await tx.$queryRaw<TourismFoodRow[]>(Prisma.sql`
            SELECT
                f.id,
                f.public_id::text AS "publicId",
                f.name,
                f.name_en AS "nameEn",
                f.name_mm AS "nameMm",
                f.short_description AS "shortDescription",
                f.food_type AS "foodType",
                f.labels,
                f.admin_area_id AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                f.is_active AS "isActive",
                f.is_verified AS "isVerified",
                f.source_url AS "sourceUrl",
                f.verified_at AS "verifiedAt",
                f.created_at AS "createdAt",
                f.updated_at AS "updatedAt"
            FROM tourism.foods AS f
            JOIN core.core_admin_areas AS aa ON aa.id = f.admin_area_id
            WHERE f.public_id::text = ${publicId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    private async findGuideByPublicIdInTx(
        tx: Tx | PrismaClient,
        publicId: string
    ): Promise<TourismGuideRow | null> {
        const rows = await tx.$queryRaw<TourismGuideRow[]>(Prisma.sql`
            SELECT
                g.id,
                g.public_id::text AS "publicId",
                g.admin_area_id AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                g.place_id AS "placeId",
                p.public_id::text AS "placePublicId",
                COALESCE(p.display_name, p.primary_name) AS "placeName",
                g.guide_type AS "guideType",
                g.title,
                g.short_description AS "shortDescription",
                g.content,
                g.is_active AS "isActive",
                g.is_verified AS "isVerified",
                g.source_url AS "sourceUrl",
                g.verified_at AS "verifiedAt",
                g.created_at AS "createdAt",
                g.updated_at AS "updatedAt"
            FROM tourism.local_guides AS g
            JOIN core.core_admin_areas AS aa ON aa.id = g.admin_area_id
            LEFT JOIN core.core_places AS p ON p.id = g.place_id
            WHERE g.public_id::text = ${publicId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    private async findAdvisoryByPublicIdInTx(
        tx: Tx | PrismaClient,
        publicId: string
    ): Promise<TourismAdvisoryRow | null> {
        const rows = await tx.$queryRaw<TourismAdvisoryRow[]>(Prisma.sql`
            SELECT
                a.id,
                a.public_id::text AS "publicId",
                a.admin_area_id AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                a.place_id AS "placeId",
                p.public_id::text AS "placePublicId",
                COALESCE(p.display_name, p.primary_name) AS "placeName",
                a.activity_id AS "activityId",
                act.public_id::text AS "activityPublicId",
                act.name AS "activityName",
                a.event_id AS "eventId",
                ev.public_id::text AS "eventPublicId",
                ev.name AS "eventName",
                a.advisory_type AS "advisoryType",
                a.title,
                a.description,
                a.severity,
                a.effective_from AS "effectiveFrom",
                a.effective_until AS "effectiveUntil",
                a.is_active AS "isActive",
                a.is_verified AS "isVerified",
                a.source_url AS "sourceUrl",
                a.verified_at AS "verifiedAt",
                a.created_at AS "createdAt",
                a.updated_at AS "updatedAt"
            FROM tourism.advisories AS a
            JOIN core.core_admin_areas AS aa ON aa.id = a.admin_area_id
            LEFT JOIN core.core_places AS p ON p.id = a.place_id
            LEFT JOIN tourism.activities AS act ON act.id = a.activity_id
            LEFT JOIN tourism.events AS ev ON ev.id = a.event_id
            WHERE a.public_id::text = ${publicId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }
}
