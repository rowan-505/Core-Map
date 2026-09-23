/**
 * Service for tourism foods, local guides, and advisories.
 */
import { TourismReviewsError } from "./tourism.errors.js";
import type {
    CreateTourismAdvisoryBody,
    CreateTourismFoodBody,
    CreateTourismFoodPlaceLinkBody,
    CreateTourismGuideBody,
    ListAdminTourismAdvisoriesQuery,
    ListAdminTourismFoodsQuery,
    ListAdminTourismGuidesQuery,
    ListPublicTourismAdvisoriesQuery,
    ListPublicTourismFoodsQuery,
    ListPublicTourismGuidesQuery,
    UpdateTourismAdvisoryBody,
    UpdateTourismFoodBody,
    UpdateTourismFoodPlaceLinkBody,
    UpdateTourismGuideBody,
} from "./tourism.visitor.schema.js";
import {
    TourismVisitorRepository,
    type TourismAdvisoryRow,
    type TourismFoodPlaceLinkRow,
    type TourismFoodRow,
    type TourismGuideRow,
    type VisitorAuditContext,
} from "./tourism.visitor.repo.js";

export type TourismFoodPlaceLinkDto = {
    place_public_id: string;
    place_name: string;
    lat: number | null;
    lng: number | null;
    availability_note: string | null;
    is_signature_here: boolean;
    is_verified: boolean;
    source_url: string | null;
    verified_at: string | null;
};

export type TourismFoodAdminDto = {
    public_id: string;
    name: string;
    name_en: string | null;
    name_mm: string | null;
    short_description: string | null;
    food_type: string;
    labels: string[];
    admin_area_id: string;
    admin_area_name: string;
    is_active: boolean;
    is_verified: boolean;
    source_url: string | null;
    verified_at: string | null;
    places: TourismFoodPlaceLinkDto[];
    created_at: string;
    updated_at: string;
};

export type TourismFoodPublicDto = {
    public_id: string;
    name: string;
    name_en: string | null;
    name_mm: string | null;
    short_description: string | null;
    food_type: string;
    labels: string[];
    admin_area_name: string;
    places: Array<{
        place_public_id: string;
        place_name: string;
        lat: number | null;
        lng: number | null;
        availability_note: string | null;
        is_signature_here: boolean;
    }>;
};

export type TourismGuideAdminDto = {
    public_id: string;
    admin_area_id: string;
    admin_area_name: string;
    place_public_id: string | null;
    place_name: string | null;
    guide_type: string;
    title: string;
    short_description: string | null;
    content: string;
    is_active: boolean;
    is_verified: boolean;
    source_url: string | null;
    verified_at: string | null;
    created_at: string;
    updated_at: string;
};

export type TourismGuidePublicDto = {
    public_id: string;
    admin_area_name: string;
    place_public_id: string | null;
    place_name: string | null;
    guide_type: string;
    title: string;
    short_description: string | null;
    content: string;
};

export type TourismAdvisoryAdminDto = {
    public_id: string;
    admin_area_id: string;
    admin_area_name: string;
    place_public_id: string | null;
    place_name: string | null;
    activity_public_id: string | null;
    activity_name: string | null;
    event_public_id: string | null;
    event_name: string | null;
    advisory_type: string;
    title: string;
    description: string;
    severity: string;
    effective_from: string | null;
    effective_until: string | null;
    is_active: boolean;
    is_verified: boolean;
    source_url: string | null;
    verified_at: string | null;
    created_at: string;
    updated_at: string;
};

export type TourismAdvisoryPublicDto = {
    public_id: string;
    admin_area_name: string;
    place_public_id: string | null;
    place_name: string | null;
    advisory_type: string;
    title: string;
    description: string;
    severity: string;
    effective_from: string | null;
    effective_until: string | null;
};

/** Pure helper: current window check for public advisories. */
export function isAdvisoryCurrentlyEffective(
    advisory: { effectiveFrom: Date | null; effectiveUntil: Date | null },
    now: Date
): boolean {
    if (advisory.effectiveFrom && now.getTime() < advisory.effectiveFrom.getTime()) {
        return false;
    }
    if (advisory.effectiveUntil && now.getTime() > advisory.effectiveUntil.getTime()) {
        return false;
    }
    return true;
}

export class TourismVisitorService {
    constructor(private readonly repo: TourismVisitorRepository) {}

    // --- Foods ---

    async listAdminFoods(query: ListAdminTourismFoodsQuery) {
        const { rows, total } = await this.repo.listFoods({
            adminAreaId: query.admin_area_id ? BigInt(query.admin_area_id) : undefined,
            foodType: query.food_type,
            label: query.label,
            isActive: query.is_active,
            isVerified: query.is_verified,
            q: query.q,
            publicOnly: false,
            limit: query.limit,
            offset: query.offset,
        });
        const items = await Promise.all(
            rows.map(async (row) => {
                const links = await this.repo.listFoodPlaceLinks(row.id);
                return this.toFoodAdminDto(row, links);
            })
        );
        return { items, total, limit: query.limit, offset: query.offset };
    }

    async getAdminFood(publicId: string): Promise<TourismFoodAdminDto> {
        const row = await this.repo.findFoodByPublicId(publicId);
        if (!row) {
            throw new TourismReviewsError("Food not found", 404, "FOOD_NOT_FOUND");
        }
        const links = await this.repo.listFoodPlaceLinks(row.id);
        return this.toFoodAdminDto(row, links);
    }

    async createFood(
        actorPublicId: string,
        body: CreateTourismFoodBody,
        audit: VisitorAuditContext
    ): Promise<TourismFoodAdminDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const adminAreaId = await this.requireAdminArea(body.admin_area_id);
        const verifiedAt = this.resolveVerifiedAt(body.is_verified, body.verified_at, null);

        const row = await this.repo.createFood({
            actorUserId,
            name: body.name,
            nameEn: body.name_en ?? null,
            nameMm: body.name_mm ?? null,
            shortDescription: body.short_description ?? null,
            foodType: body.food_type,
            labels: body.labels,
            adminAreaId,
            isActive: body.is_active,
            isVerified: body.is_verified,
            sourceUrl: body.source_url ?? null,
            verifiedAt,
            audit,
            afterSnapshot: this.snapshotFromBody(body),
        });
        return this.toFoodAdminDto(row, []);
    }

    async updateFood(
        actorPublicId: string,
        publicId: string,
        body: UpdateTourismFoodBody,
        audit: VisitorAuditContext
    ): Promise<TourismFoodAdminDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const existing = await this.repo.findFoodByPublicId(publicId);
        if (!existing) {
            throw new TourismReviewsError("Food not found", 404, "FOOD_NOT_FOUND");
        }

        const data: Parameters<TourismVisitorRepository["updateFood"]>[0]["data"] = {};
        if (body.name !== undefined) data.name = body.name;
        if (body.name_en !== undefined) data.nameEn = body.name_en;
        if (body.name_mm !== undefined) data.nameMm = body.name_mm;
        if (body.short_description !== undefined) data.shortDescription = body.short_description;
        if (body.food_type !== undefined) data.foodType = body.food_type;
        if (body.labels !== undefined) data.labels = body.labels;
        if (body.admin_area_id !== undefined) {
            data.adminAreaId = await this.requireAdminArea(body.admin_area_id);
        }
        if (body.is_active !== undefined) data.isActive = body.is_active;
        if (body.source_url !== undefined) data.sourceUrl = body.source_url;
        if (body.is_verified !== undefined || body.verified_at !== undefined) {
            const nextVerified = body.is_verified ?? existing.isVerified;
            data.isVerified = nextVerified;
            data.verifiedAt = this.resolveVerifiedAt(
                nextVerified,
                body.verified_at,
                existing.verifiedAt
            );
        }

        const row = await this.repo.updateFood({
            foodId: existing.id,
            publicId,
            actorUserId,
            data,
            beforeSnapshot: this.foodSnapshot(existing),
            afterSnapshot: {
                ...this.foodSnapshot(existing),
                ...this.snapshotFromBody(body),
            },
            audit,
            actionType: this.resolveActiveVerifiedAction(
                "tourism_food",
                existing,
                body.is_active,
                body.is_verified
            ),
        });
        const links = await this.repo.listFoodPlaceLinks(row.id);
        return this.toFoodAdminDto(row, links);
    }

    async createFoodPlaceLink(
        actorPublicId: string,
        foodPublicId: string,
        body: CreateTourismFoodPlaceLinkBody,
        audit: VisitorAuditContext
    ): Promise<TourismFoodPlaceLinkDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const food = await this.repo.findFoodByPublicId(foodPublicId);
        if (!food) {
            throw new TourismReviewsError("Food not found", 404, "FOOD_NOT_FOUND");
        }
        const placeId = await this.requirePlace(body.place_public_id);
        const verifiedAt = this.resolveVerifiedAt(body.is_verified, body.verified_at, null);

        try {
            const row = await this.repo.createFoodPlaceLink({
                actorUserId,
                foodId: food.id,
                placeId,
                availabilityNote: body.availability_note ?? null,
                isSignatureHere: body.is_signature_here,
                isVerified: body.is_verified,
                sourceUrl: body.source_url ?? null,
                verifiedAt,
                audit,
                afterSnapshot: this.snapshotFromBody(body),
            });
            return this.toFoodPlaceLinkAdminDto(row);
        } catch (error) {
            if (
                error instanceof Error &&
                (error as { code?: string }).code === "FOOD_PLACE_LINK_EXISTS"
            ) {
                throw new TourismReviewsError(
                    "Food is already linked to this place",
                    409,
                    "FOOD_PLACE_LINK_EXISTS"
                );
            }
            throw error;
        }
    }

    async updateFoodPlaceLink(
        actorPublicId: string,
        foodPublicId: string,
        placePublicId: string,
        body: UpdateTourismFoodPlaceLinkBody,
        audit: VisitorAuditContext
    ): Promise<TourismFoodPlaceLinkDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const food = await this.repo.findFoodByPublicId(foodPublicId);
        if (!food) {
            throw new TourismReviewsError("Food not found", 404, "FOOD_NOT_FOUND");
        }
        const placeId = await this.requirePlace(placePublicId);
        const existing = await this.repo.findFoodPlaceLink(food.id, placeId);
        if (!existing) {
            throw new TourismReviewsError(
                "Food place link not found",
                404,
                "FOOD_PLACE_LINK_NOT_FOUND"
            );
        }

        const data: Parameters<TourismVisitorRepository["updateFoodPlaceLink"]>[0]["data"] = {};
        if (body.availability_note !== undefined) data.availabilityNote = body.availability_note;
        if (body.is_signature_here !== undefined) data.isSignatureHere = body.is_signature_here;
        if (body.source_url !== undefined) data.sourceUrl = body.source_url;
        if (body.is_verified !== undefined || body.verified_at !== undefined) {
            const nextVerified = body.is_verified ?? existing.isVerified;
            data.isVerified = nextVerified;
            data.verifiedAt = this.resolveVerifiedAt(
                nextVerified,
                body.verified_at,
                existing.verifiedAt
            );
        }

        const row = await this.repo.updateFoodPlaceLink({
            linkId: existing.id,
            foodId: food.id,
            placeId,
            actorUserId,
            data,
            beforeSnapshot: this.linkSnapshot(existing),
            afterSnapshot: {
                ...this.linkSnapshot(existing),
                ...this.snapshotFromBody(body),
            },
            audit,
            actionType: "tourism_food_place_link_updated",
        });
        return this.toFoodPlaceLinkAdminDto(row);
    }

    async deleteFoodPlaceLink(
        actorPublicId: string,
        foodPublicId: string,
        placePublicId: string,
        audit: VisitorAuditContext
    ): Promise<{ deleted: true }> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const food = await this.repo.findFoodByPublicId(foodPublicId);
        if (!food) {
            throw new TourismReviewsError("Food not found", 404, "FOOD_NOT_FOUND");
        }
        const placeId = await this.requirePlace(placePublicId);
        const existing = await this.repo.findFoodPlaceLink(food.id, placeId);
        if (!existing) {
            throw new TourismReviewsError(
                "Food place link not found",
                404,
                "FOOD_PLACE_LINK_NOT_FOUND"
            );
        }
        await this.repo.deleteFoodPlaceLink({
            linkId: existing.id,
            actorUserId,
            beforeSnapshot: this.linkSnapshot(existing),
            audit,
        });
        return { deleted: true };
    }

    async listPublicFoods(query: ListPublicTourismFoodsQuery) {
        const { rows, total } = await this.repo.listFoods({
            adminAreaId: query.admin_area_id ? BigInt(query.admin_area_id) : undefined,
            foodType: query.food_type,
            label: query.label,
            publicOnly: true,
            limit: query.limit,
            offset: query.offset,
        });
        const items = await Promise.all(
            rows.map(async (row) => {
                const links = await this.repo.listFoodPlaceLinks(row.id, {
                    publicPlacesOnly: true,
                });
                return this.toFoodPublicDto(row, links);
            })
        );
        return { items, total, limit: query.limit, offset: query.offset };
    }

    async getPublicFood(publicId: string): Promise<TourismFoodPublicDto> {
        const row = await this.repo.findFoodByPublicId(publicId);
        if (!row || !row.isActive || !row.isVerified) {
            throw new TourismReviewsError("Food not found", 404, "FOOD_NOT_FOUND");
        }
        const links = await this.repo.listFoodPlaceLinks(row.id, { publicPlacesOnly: true });
        return this.toFoodPublicDto(row, links);
    }

    // --- Guides ---

    async listAdminGuides(query: ListAdminTourismGuidesQuery) {
        const { rows, total } = await this.repo.listGuides({
            adminAreaId: query.admin_area_id ? BigInt(query.admin_area_id) : undefined,
            placePublicId: query.place_public_id,
            guideType: query.guide_type,
            isActive: query.is_active,
            isVerified: query.is_verified,
            q: query.q,
            publicOnly: false,
            limit: query.limit,
            offset: query.offset,
        });
        return {
            items: rows.map((row) => this.toGuideAdminDto(row)),
            total,
            limit: query.limit,
            offset: query.offset,
        };
    }

    async getAdminGuide(publicId: string): Promise<TourismGuideAdminDto> {
        const row = await this.repo.findGuideByPublicId(publicId);
        if (!row) {
            throw new TourismReviewsError("Guide not found", 404, "GUIDE_NOT_FOUND");
        }
        return this.toGuideAdminDto(row);
    }

    async createGuide(
        actorPublicId: string,
        body: CreateTourismGuideBody,
        audit: VisitorAuditContext
    ): Promise<TourismGuideAdminDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const adminAreaId = await this.requireAdminArea(body.admin_area_id);
        const placeId = await this.resolveOptionalPlace(body.place_public_id);
        const verifiedAt = this.resolveVerifiedAt(body.is_verified, body.verified_at, null);

        const row = await this.repo.createGuide({
            actorUserId,
            adminAreaId,
            placeId,
            guideType: body.guide_type,
            title: body.title,
            shortDescription: body.short_description ?? null,
            content: body.content,
            isActive: body.is_active,
            isVerified: body.is_verified,
            sourceUrl: body.source_url ?? null,
            verifiedAt,
            audit,
            afterSnapshot: this.snapshotFromBody(body),
        });
        return this.toGuideAdminDto(row);
    }

    async updateGuide(
        actorPublicId: string,
        publicId: string,
        body: UpdateTourismGuideBody,
        audit: VisitorAuditContext
    ): Promise<TourismGuideAdminDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const existing = await this.repo.findGuideByPublicId(publicId);
        if (!existing) {
            throw new TourismReviewsError("Guide not found", 404, "GUIDE_NOT_FOUND");
        }

        const data: Parameters<TourismVisitorRepository["updateGuide"]>[0]["data"] = {};
        if (body.admin_area_id !== undefined) {
            data.adminAreaId = await this.requireAdminArea(body.admin_area_id);
        }
        if (body.place_public_id !== undefined) {
            data.placeId = await this.resolveOptionalPlace(body.place_public_id);
        }
        if (body.guide_type !== undefined) data.guideType = body.guide_type;
        if (body.title !== undefined) data.title = body.title;
        if (body.short_description !== undefined) data.shortDescription = body.short_description;
        if (body.content !== undefined) data.content = body.content;
        if (body.is_active !== undefined) data.isActive = body.is_active;
        if (body.source_url !== undefined) data.sourceUrl = body.source_url;
        if (body.is_verified !== undefined || body.verified_at !== undefined) {
            const nextVerified = body.is_verified ?? existing.isVerified;
            data.isVerified = nextVerified;
            data.verifiedAt = this.resolveVerifiedAt(
                nextVerified,
                body.verified_at,
                existing.verifiedAt
            );
        }

        const row = await this.repo.updateGuide({
            guideId: existing.id,
            publicId,
            actorUserId,
            data,
            beforeSnapshot: this.guideSnapshot(existing),
            afterSnapshot: {
                ...this.guideSnapshot(existing),
                ...this.snapshotFromBody(body),
            },
            audit,
            actionType: this.resolveActiveVerifiedAction(
                "tourism_local_guide",
                existing,
                body.is_active,
                body.is_verified
            ),
        });
        return this.toGuideAdminDto(row);
    }

    async listPublicGuides(query: ListPublicTourismGuidesQuery) {
        const { rows, total } = await this.repo.listGuides({
            adminAreaId: query.admin_area_id ? BigInt(query.admin_area_id) : undefined,
            placePublicId: query.place_public_id,
            guideType: query.guide_type,
            publicOnly: true,
            limit: query.limit,
            offset: query.offset,
        });
        return {
            items: rows.map((row) => this.toGuidePublicDto(row)),
            total,
            limit: query.limit,
            offset: query.offset,
        };
    }

    // --- Advisories ---

    async listAdminAdvisories(query: ListAdminTourismAdvisoriesQuery) {
        const { rows, total } = await this.repo.listAdvisories({
            adminAreaId: query.admin_area_id ? BigInt(query.admin_area_id) : undefined,
            placePublicId: query.place_public_id,
            activityPublicId: query.activity_public_id,
            eventPublicId: query.event_public_id,
            advisoryType: query.advisory_type,
            severity: query.severity,
            isActive: query.is_active,
            isVerified: query.is_verified,
            q: query.q,
            publicOnly: false,
            limit: query.limit,
            offset: query.offset,
        });
        return {
            items: rows.map((row) => this.toAdvisoryAdminDto(row)),
            total,
            limit: query.limit,
            offset: query.offset,
        };
    }

    async getAdminAdvisory(publicId: string): Promise<TourismAdvisoryAdminDto> {
        const row = await this.repo.findAdvisoryByPublicId(publicId);
        if (!row) {
            throw new TourismReviewsError("Advisory not found", 404, "ADVISORY_NOT_FOUND");
        }
        return this.toAdvisoryAdminDto(row);
    }

    async createAdvisory(
        actorPublicId: string,
        body: CreateTourismAdvisoryBody,
        audit: VisitorAuditContext
    ): Promise<TourismAdvisoryAdminDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const adminAreaId = await this.requireAdminArea(body.admin_area_id);
        const placeId = await this.resolveOptionalPlace(body.place_public_id);
        const activityId = await this.resolveOptionalActivity(body.activity_public_id);
        const eventId = await this.resolveOptionalEvent(body.event_public_id);
        const verifiedAt = this.resolveVerifiedAt(body.is_verified, body.verified_at, null);

        const row = await this.repo.createAdvisory({
            actorUserId,
            adminAreaId,
            placeId,
            activityId,
            eventId,
            advisoryType: body.advisory_type,
            title: body.title,
            description: body.description,
            severity: body.severity,
            effectiveFrom: parseOptionalDate(body.effective_from),
            effectiveUntil: parseOptionalDate(body.effective_until),
            isActive: body.is_active,
            isVerified: body.is_verified,
            sourceUrl: body.source_url ?? null,
            verifiedAt,
            audit,
            afterSnapshot: this.snapshotFromBody(body),
        });
        return this.toAdvisoryAdminDto(row);
    }

    async updateAdvisory(
        actorPublicId: string,
        publicId: string,
        body: UpdateTourismAdvisoryBody,
        audit: VisitorAuditContext
    ): Promise<TourismAdvisoryAdminDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const existing = await this.repo.findAdvisoryByPublicId(publicId);
        if (!existing) {
            throw new TourismReviewsError("Advisory not found", 404, "ADVISORY_NOT_FOUND");
        }

        const data: Parameters<TourismVisitorRepository["updateAdvisory"]>[0]["data"] = {};
        if (body.admin_area_id !== undefined) {
            data.adminAreaId = await this.requireAdminArea(body.admin_area_id);
        }
        if (body.place_public_id !== undefined) {
            data.placeId = await this.resolveOptionalPlace(body.place_public_id);
        }
        if (body.activity_public_id !== undefined) {
            data.activityId = await this.resolveOptionalActivity(body.activity_public_id);
        }
        if (body.event_public_id !== undefined) {
            data.eventId = await this.resolveOptionalEvent(body.event_public_id);
        }
        if (body.advisory_type !== undefined) data.advisoryType = body.advisory_type;
        if (body.title !== undefined) data.title = body.title;
        if (body.description !== undefined) data.description = body.description;
        if (body.severity !== undefined) data.severity = body.severity;
        if (body.effective_from !== undefined) {
            data.effectiveFrom = parseOptionalDate(body.effective_from);
        }
        if (body.effective_until !== undefined) {
            data.effectiveUntil = parseOptionalDate(body.effective_until);
        }
        if (body.is_active !== undefined) data.isActive = body.is_active;
        if (body.source_url !== undefined) data.sourceUrl = body.source_url;
        if (body.is_verified !== undefined || body.verified_at !== undefined) {
            const nextVerified = body.is_verified ?? existing.isVerified;
            data.isVerified = nextVerified;
            data.verifiedAt = this.resolveVerifiedAt(
                nextVerified,
                body.verified_at,
                existing.verifiedAt
            );
        }

        const nextFrom =
            data.effectiveFrom !== undefined ? data.effectiveFrom : existing.effectiveFrom;
        const nextUntil =
            data.effectiveUntil !== undefined ? data.effectiveUntil : existing.effectiveUntil;
        if (
            nextFrom &&
            nextUntil &&
            nextUntil.getTime() < nextFrom.getTime()
        ) {
            throw new TourismReviewsError(
                "effective_until must be on or after effective_from",
                400,
                "INVALID_EFFECTIVE_RANGE"
            );
        }

        const row = await this.repo.updateAdvisory({
            advisoryId: existing.id,
            publicId,
            actorUserId,
            data,
            beforeSnapshot: this.advisorySnapshot(existing),
            afterSnapshot: {
                ...this.advisorySnapshot(existing),
                ...this.snapshotFromBody(body),
            },
            audit,
            actionType: this.resolveActiveVerifiedAction(
                "tourism_advisory",
                existing,
                body.is_active,
                body.is_verified
            ),
        });
        return this.toAdvisoryAdminDto(row);
    }

    async listPublicAdvisories(query: ListPublicTourismAdvisoriesQuery, now = new Date()) {
        const { rows, total } = await this.repo.listAdvisories({
            adminAreaId: query.admin_area_id ? BigInt(query.admin_area_id) : undefined,
            placePublicId: query.place_public_id,
            advisoryType: query.advisory_type,
            severity: query.severity,
            publicOnly: true,
            now,
            limit: query.limit,
            offset: query.offset,
        });
        // Defense in depth: also filter in service with the shared helper.
        const items = rows
            .filter((row) => isAdvisoryCurrentlyEffective(row, now))
            .map((row) => this.toAdvisoryPublicDto(row));
        return { items, total, limit: query.limit, offset: query.offset };
    }

    // --- helpers ---

    private async requireUsableUser(publicId: string): Promise<bigint> {
        const userId = await this.repo.findUsableUserIdByPublicId(publicId);
        if (!userId) {
            throw new TourismReviewsError("User account is inactive", 403, "INACTIVE_USER");
        }
        return userId;
    }

    private async requireAdminArea(adminAreaId: string): Promise<bigint> {
        const id = await this.repo.findActiveAdminAreaId(BigInt(adminAreaId));
        if (!id) {
            throw new TourismReviewsError(
                "Invalid or inactive admin area",
                400,
                "INVALID_ADMIN_AREA"
            );
        }
        return id;
    }

    private async requirePlace(publicId: string): Promise<bigint> {
        const placeId = await this.repo.findActivePlaceIdByPublicId(publicId);
        if (!placeId) {
            throw new TourismReviewsError("Place not found", 404, "PLACE_NOT_FOUND");
        }
        return placeId;
    }

    private async resolveOptionalPlace(
        publicId: string | null | undefined
    ): Promise<bigint | null> {
        if (publicId === undefined || publicId === null) return null;
        return this.requirePlace(publicId);
    }

    private async resolveOptionalActivity(
        publicId: string | null | undefined
    ): Promise<bigint | null> {
        if (publicId === undefined || publicId === null) return null;
        const id = await this.repo.findActivityIdByPublicId(publicId);
        if (!id) {
            throw new TourismReviewsError("Activity not found", 404, "ACTIVITY_NOT_FOUND");
        }
        return id;
    }

    private async resolveOptionalEvent(
        publicId: string | null | undefined
    ): Promise<bigint | null> {
        if (publicId === undefined || publicId === null) return null;
        const id = await this.repo.findEventIdByPublicId(publicId);
        if (!id) {
            throw new TourismReviewsError("Event not found", 404, "EVENT_NOT_FOUND");
        }
        return id;
    }

    private resolveVerifiedAt(
        isVerified: boolean,
        verifiedAtInput: string | null | undefined,
        previous: Date | null
    ): Date | null {
        if (!isVerified) return null;
        if (verifiedAtInput === null) return null;
        if (verifiedAtInput !== undefined) return new Date(verifiedAtInput);
        return previous ?? new Date();
    }

    private resolveActiveVerifiedAction(
        prefix: string,
        before: { isActive: boolean; isVerified: boolean },
        isActive?: boolean,
        isVerified?: boolean
    ): string {
        if (isVerified !== undefined && isVerified !== before.isVerified) {
            return isVerified ? `${prefix}_verified` : `${prefix}_unverified`;
        }
        if (isActive !== undefined && isActive !== before.isActive) {
            return isActive ? `${prefix}_activated` : `${prefix}_deactivated`;
        }
        return `${prefix}_updated`;
    }

    private toFoodPlaceLinkAdminDto(row: TourismFoodPlaceLinkRow): TourismFoodPlaceLinkDto {
        return {
            place_public_id: row.placePublicId,
            place_name: row.placeName,
            lat: row.placeLat,
            lng: row.placeLng,
            availability_note: row.availabilityNote,
            is_signature_here: row.isSignatureHere,
            is_verified: row.isVerified,
            source_url: row.sourceUrl,
            verified_at: row.verifiedAt?.toISOString() ?? null,
        };
    }

    private toFoodAdminDto(
        row: TourismFoodRow,
        links: TourismFoodPlaceLinkRow[]
    ): TourismFoodAdminDto {
        return {
            public_id: row.publicId,
            name: row.name,
            name_en: row.nameEn,
            name_mm: row.nameMm,
            short_description: row.shortDescription,
            food_type: row.foodType,
            labels: row.labels ?? [],
            admin_area_id: String(row.adminAreaId),
            admin_area_name: row.adminAreaName,
            is_active: row.isActive,
            is_verified: row.isVerified,
            source_url: row.sourceUrl,
            verified_at: row.verifiedAt?.toISOString() ?? null,
            places: links.map((link) => this.toFoodPlaceLinkAdminDto(link)),
            created_at: row.createdAt.toISOString(),
            updated_at: row.updatedAt.toISOString(),
        };
    }

    private toFoodPublicDto(
        row: TourismFoodRow,
        links: TourismFoodPlaceLinkRow[]
    ): TourismFoodPublicDto {
        return {
            public_id: row.publicId,
            name: row.name,
            name_en: row.nameEn,
            name_mm: row.nameMm,
            short_description: row.shortDescription,
            food_type: row.foodType,
            labels: row.labels ?? [],
            admin_area_name: row.adminAreaName,
            places: links.map((link) => ({
                place_public_id: link.placePublicId,
                place_name: link.placeName,
                lat: link.placeLat,
                lng: link.placeLng,
                availability_note: link.availabilityNote,
                is_signature_here: link.isSignatureHere,
            })),
        };
    }

    private toGuideAdminDto(row: TourismGuideRow): TourismGuideAdminDto {
        return {
            public_id: row.publicId,
            admin_area_id: String(row.adminAreaId),
            admin_area_name: row.adminAreaName,
            place_public_id: row.placePublicId,
            place_name: row.placeName,
            guide_type: row.guideType,
            title: row.title,
            short_description: row.shortDescription,
            content: row.content,
            is_active: row.isActive,
            is_verified: row.isVerified,
            source_url: row.sourceUrl,
            verified_at: row.verifiedAt?.toISOString() ?? null,
            created_at: row.createdAt.toISOString(),
            updated_at: row.updatedAt.toISOString(),
        };
    }

    private toGuidePublicDto(row: TourismGuideRow): TourismGuidePublicDto {
        return {
            public_id: row.publicId,
            admin_area_name: row.adminAreaName,
            place_public_id: row.placePublicId,
            place_name: row.placeName,
            guide_type: row.guideType,
            title: row.title,
            short_description: row.shortDescription,
            content: row.content,
        };
    }

    private toAdvisoryAdminDto(row: TourismAdvisoryRow): TourismAdvisoryAdminDto {
        return {
            public_id: row.publicId,
            admin_area_id: String(row.adminAreaId),
            admin_area_name: row.adminAreaName,
            place_public_id: row.placePublicId,
            place_name: row.placeName,
            activity_public_id: row.activityPublicId,
            activity_name: row.activityName,
            event_public_id: row.eventPublicId,
            event_name: row.eventName,
            advisory_type: row.advisoryType,
            title: row.title,
            description: row.description,
            severity: row.severity,
            effective_from: row.effectiveFrom?.toISOString() ?? null,
            effective_until: row.effectiveUntil?.toISOString() ?? null,
            is_active: row.isActive,
            is_verified: row.isVerified,
            source_url: row.sourceUrl,
            verified_at: row.verifiedAt?.toISOString() ?? null,
            created_at: row.createdAt.toISOString(),
            updated_at: row.updatedAt.toISOString(),
        };
    }

    private toAdvisoryPublicDto(row: TourismAdvisoryRow): TourismAdvisoryPublicDto {
        return {
            public_id: row.publicId,
            admin_area_name: row.adminAreaName,
            place_public_id: row.placePublicId,
            place_name: row.placeName,
            advisory_type: row.advisoryType,
            title: row.title,
            description: row.description,
            severity: row.severity,
            effective_from: row.effectiveFrom?.toISOString() ?? null,
            effective_until: row.effectiveUntil?.toISOString() ?? null,
        };
    }

    private foodSnapshot(row: TourismFoodRow): Record<string, unknown> {
        return {
            name: row.name,
            food_type: row.foodType,
            labels: row.labels,
            admin_area_id: String(row.adminAreaId),
            is_active: row.isActive,
            is_verified: row.isVerified,
        };
    }

    private linkSnapshot(row: TourismFoodPlaceLinkRow): Record<string, unknown> {
        return {
            place_public_id: row.placePublicId,
            availability_note: row.availabilityNote,
            is_signature_here: row.isSignatureHere,
            is_verified: row.isVerified,
        };
    }

    private guideSnapshot(row: TourismGuideRow): Record<string, unknown> {
        return {
            title: row.title,
            guide_type: row.guideType,
            admin_area_id: String(row.adminAreaId),
            place_public_id: row.placePublicId,
            is_active: row.isActive,
            is_verified: row.isVerified,
        };
    }

    private advisorySnapshot(row: TourismAdvisoryRow): Record<string, unknown> {
        return {
            title: row.title,
            advisory_type: row.advisoryType,
            severity: row.severity,
            admin_area_id: String(row.adminAreaId),
            is_active: row.isActive,
            is_verified: row.isVerified,
            effective_from: row.effectiveFrom?.toISOString() ?? null,
            effective_until: row.effectiveUntil?.toISOString() ?? null,
        };
    }

    private snapshotFromBody(body: object): Record<string, unknown> {
        const snap: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(body)) {
            if (value !== undefined) snap[key] = value;
        }
        return snap;
    }
}

function parseOptionalDate(value: string | null | undefined): Date | null {
    if (value === undefined || value === null) return null;
    return new Date(value);
}
