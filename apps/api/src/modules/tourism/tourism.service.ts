import { Prisma } from "@prisma/client";

import {
    decodeTourismRankingCursor,
    decodeTourismReviewCursor,
    encodeTourismRankingCursor,
    encodeTourismReviewCursor,
    InvalidTourismRankingCursorError,
    InvalidTourismReviewCursorError,
    type AdminTourismModerationNoteBody,
    type AdminTourismReviewsQuery,
    type ApproveTourismCandidateBody,
    type CreateTourismPlaceProfileBody,
    type CreateTourismReviewBody,
    type IgnoreTourismCandidateBody,
    type ListAdminTourismCandidatesOverviewQuery,
    type ListAdminTourismCandidatesQuery,
    type ListAdminTourismPlaceSearchQuery,
    type ListPublishedTourismReviewsQuery,
    type ListTourismPlacesRankingQuery,
    type ModerateTourismReviewBody,
    type UpdateTourismPlaceProfileBody,
    type UpdateTourismReviewBody,
} from "./tourism.schema.js";
import {
    resolveTourismCoverageStatus,
    suggestTourismTypeForCandidate,
} from "./tourism.candidates.js";
import {
    TourismReviewsRepository,
    type AuditContext,
    type TourismModerationEventRow,
    type TourismPlaceProfileDetailRow,
    type TourismRankedPlaceRow,
    type TourismRatingSummaryRow,
    type TourismReviewRow,
} from "./tourism.repo.js";
import {
    resolveTourismAdminTransition,
    type TourismAdminModerationAction,
} from "./tourism.moderation.js";
import { TourismReviewsError } from "./tourism.errors.js";
import {
    TOURISM_PUBLIC_REVIEW_STATUS,
    type TourismReviewStatus,
    type TourismSeasonMode,
} from "./tourism.types.js";
import {
    TOURISM_NEARBY_DEFAULT_RADIUS_M,
} from "./tourism.ranking.js";
import { deriveCoalescedDisplayName, trimName } from "../../lib/entity-names/derive-display-name.js";

export { TourismReviewsError } from "./tourism.errors.js";
export { resolveTourismAdminTransition } from "./tourism.moderation.js";

export type TourismReviewAuthorDto = {
    public_id: string;
    display_name: string;
};

/** Safe public/owner-facing review fields (no internal numeric ids). */
export type TourismReviewPublicDto = {
    public_id: string;
    place_public_id: string;
    rating: number;
    title: string | null;
    body: string | null;
    status: TourismReviewStatus;
    created_at: string;
    updated_at: string;
    published_at: string | null;
    author: TourismReviewAuthorDto;
};

export type TourismReviewOwnerDto = TourismReviewPublicDto & {
    moderation_note: string | null;
};

export type TourismReviewPageDto = {
    items: TourismReviewPublicDto[];
    next_cursor: string | null;
};

export type TourismAdminReviewPageDto = {
    items: TourismReviewOwnerDto[];
    next_cursor: string | null;
};

export type TourismModerationEventDto = {
    from_status: TourismReviewStatus;
    to_status: TourismReviewStatus;
    note: string | null;
    created_at: string;
    actor: TourismReviewAuthorDto | null;
};

export type TourismAdminReviewDetailDto = TourismReviewOwnerDto & {
    moderation_history: TourismModerationEventDto[];
};

export type TourismRatingSummaryDto = {
    place_public_id: string;
    published_review_count: number;
    average_rating: number | null;
    updated_at: string;
};

export type TourismPlaceProfilePublicDto = {
    public_id: string;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    display_name: string | null;
    primary_name: string | null;
    lat: number | null;
    lng: number | null;
    category_code: string | null;
    category_name: string | null;
    is_verified: boolean;
    address: {
        full_address: string;
        postal_code: string | null;
    } | null;
    contact: {
        phone: string | null;
        website: string | null;
        facebook_url: string | null;
        opening_hours: string | null;
    } | null;
    tourism_type: string;
    tourism_type_name_en?: string;
    tourism_type_name_mm?: string | null;
    short_description: string | null;
    price_level: number | null;
    editor_pick: boolean;
    average_rating: number | null;
    published_review_count: number;
};

export type TourismPlaceProfileAdminDto = TourismPlaceProfilePublicDto & {
    is_public: boolean;
    editorial_score: number;
    manual_boost: number;
    season_mode: TourismSeasonMode;
    season_start_month: number | null;
    season_end_month: number | null;
    importance_score: number;
    created_at: string;
    updated_at: string;
    recent_manual_boost_audits: Array<{
        created_at: string;
        action_type: string;
        manual_boost: number | null;
        reason: string | null;
    }>;
};

export type TourismTypeDto = {
    code: string;
    name_en: string;
    name_mm: string | null;
    sort_order: number;
};

/** Ranked list item. Does not expose bayesian_score. */
export type TourismRankedPlaceDto = {
    public_id: string;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    display_name: string | null;
    primary_name: string | null;
    lat: number | null;
    lng: number | null;
    is_verified: boolean;
    tourism_type: string;
    tourism_type_name_en?: string;
    tourism_type_name_mm?: string | null;
    short_description: string | null;
    price_level: number | null;
    editor_pick: boolean;
    average_rating: number | null;
    published_review_count: number;
    /** Present for nearby mode only; meters from the query origin. */
    distance_meters: number | null;
};

export type TourismRankedPlacePageDto = {
    mode: ListTourismPlacesRankingQuery["mode"];
    items: TourismRankedPlaceDto[];
    next_cursor: string | null;
};

export class TourismReviewsService {
    constructor(private readonly repo: TourismReviewsRepository) {}

    async listTourismTypes(): Promise<TourismTypeDto[]> {
        const rows = await this.repo.listTourismTypes();
        return rows.map((row) => ({
            code: row.code,
            name_en: row.nameEn,
            name_mm: row.nameMm,
            sort_order: row.sortOrder,
        }));
    }

    async listRankedPlaces(
        query: ListTourismPlacesRankingQuery
    ): Promise<TourismRankedPlacePageDto> {
        let cursor: ReturnType<typeof decodeTourismRankingCursor> | undefined;
        if (query.cursor) {
            try {
                cursor = decodeTourismRankingCursor(query.cursor);
            } catch (error) {
                if (error instanceof InvalidTourismRankingCursorError) {
                    throw new TourismReviewsError("Invalid cursor", 400, "INVALID_CURSOR");
                }
                throw error;
            }
            if (cursor.mode !== query.mode) {
                throw new TourismReviewsError(
                    "Cursor mode does not match query mode",
                    400,
                    "INVALID_CURSOR"
                );
            }
        }

        const radiusMeters =
            query.mode === "nearby"
                ? (query.radius_m ?? TOURISM_NEARBY_DEFAULT_RADIUS_M)
                : undefined;

        const rows = await this.repo.listRankedPlaces({
            mode: query.mode,
            tourismType: query.tourism_type,
            bbox: query.bbox,
            lat: query.lat,
            lng: query.lng,
            radiusMeters,
            cursor,
            limit: query.limit,
        });

        const hasMore = rows.length > query.limit;
        const page = hasMore ? rows.slice(0, query.limit) : rows;
        const last = page[page.length - 1];

        return {
            mode: query.mode,
            items: page.map((row) => this.toRankedPlaceDto(row, query.lang, query.mode)),
            next_cursor:
                hasMore && last
                    ? encodeTourismRankingCursor({
                          mode: query.mode,
                          bayesianScore: last.bayesianScore,
                          publishedReviewCount: last.publishedReviewCount,
                          isVerified: last.isVerified,
                          distanceMeters: last.distanceMeters,
                          publicId: last.publicId,
                      })
                    : null,
        };
    }

    async getPublicPlaceProfile(
        placePublicId: string,
        lang?: "my" | "en"
    ): Promise<TourismPlaceProfilePublicDto> {
        const place = await this.repo.findPlaceCoreByPublicId(placePublicId);
        if (!place || place.placeDeletedAt) {
            throw new TourismReviewsError("Place not found", 404, "PLACE_NOT_FOUND");
        }
        if (!place.placeIsPublic) {
            throw new TourismReviewsError("Place not found", 404, "PLACE_NOT_FOUND");
        }

        const profile = await this.repo.findProfileByPlaceId(place.placeId);
        if (!profile) {
            throw new TourismReviewsError("Tourism profile not found", 404, "PROFILE_NOT_FOUND");
        }
        if (!profile.isPublic) {
            throw new TourismReviewsError(
                "Tourism profile is not public",
                404,
                "PROFILE_NOT_PUBLIC"
            );
        }

        const detail = await this.repo.findPublicTourismPlaceByPublicId(placePublicId);
        if (!detail) {
            throw new TourismReviewsError("Tourism profile not found", 404, "PROFILE_NOT_FOUND");
        }
        return this.toPublicProfileDto(detail, lang);
    }

    async getAdminPlaceProfile(placePublicId: string): Promise<TourismPlaceProfileAdminDto> {
        const detail = await this.repo.findAdminTourismPlaceByPublicId(placePublicId);
        if (!detail) {
            throw new TourismReviewsError("Tourism profile not found", 404, "PROFILE_NOT_FOUND");
        }
        const boostAudits = await this.repo.listRecentManualBoostAudits(detail.placeId, 5);
        return this.toAdminProfileDto(detail, boostAudits);
    }

    async createPlaceProfile(
        actorPublicId: string,
        placePublicId: string,
        body: CreateTourismPlaceProfileBody,
        audit: AuditContext = {}
    ): Promise<TourismPlaceProfileAdminDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const place = await this.repo.findPlaceCoreByPublicId(placePublicId);
        if (!place || place.placeDeletedAt) {
            throw new TourismReviewsError("Place not found", 404, "PLACE_NOT_FOUND");
        }

        const existing = await this.repo.findProfileByPlaceId(place.placeId);
        if (existing) {
            throw new TourismReviewsError(
                "Tourism profile already exists for this place",
                409,
                "PROFILE_EXISTS"
            );
        }

        const tourismTypeId = await this.requireTourismTypeId(body.tourism_type);
        await this.repo.createPlaceProfile({
            placeId: place.placeId,
            actorUserId,
            tourismTypeId,
            tourismType: body.tourism_type,
            shortDescription: body.short_description ?? null,
            priceLevel: body.price_level ?? null,
            editorPick: body.editor_pick ?? false,
            isPublic: body.is_public ?? true,
            editorialScore: body.editorial_score ?? 50,
            manualBoost: body.manual_boost ?? 0,
            seasonMode: body.season_mode ?? "all_year",
            seasonStartMonth: body.season_start_month ?? null,
            seasonEndMonth: body.season_end_month ?? null,
            manualBoostReason: body.manual_boost_reason ?? null,
            audit,
        });

        const detail = await this.repo.findAdminTourismPlaceByPublicId(placePublicId);
        if (!detail) {
            throw new TourismReviewsError("Tourism profile not found", 404, "PROFILE_NOT_FOUND");
        }
        return this.toAdminProfileDto(detail);
    }

    async updatePlaceProfile(
        actorPublicId: string,
        placePublicId: string,
        body: UpdateTourismPlaceProfileBody,
        audit: AuditContext = {}
    ): Promise<TourismPlaceProfileAdminDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const place = await this.repo.findPlaceCoreByPublicId(placePublicId);
        if (!place || place.placeDeletedAt) {
            throw new TourismReviewsError("Place not found", 404, "PLACE_NOT_FOUND");
        }

        const existing = await this.repo.findProfileByPlaceId(place.placeId);
        if (!existing) {
            throw new TourismReviewsError("Tourism profile not found", 404, "PROFILE_NOT_FOUND");
        }

        const tourismType = body.tourism_type ?? existing.tourismType;
        const tourismTypeId =
            body.tourism_type === undefined
                ? existing.tourismTypeId
                : await this.requireTourismTypeId(body.tourism_type);
        await this.repo.updatePlaceProfile({
            placeId: place.placeId,
            actorUserId,
            before: existing,
            tourismTypeId,
            tourismType,
            shortDescription:
                body.short_description === undefined
                    ? existing.shortDescription
                    : body.short_description,
            priceLevel: body.price_level === undefined ? existing.priceLevel : body.price_level,
            editorPick: body.editor_pick ?? existing.editorPick,
            isPublic: body.is_public ?? existing.isPublic,
            editorialScore: body.editorial_score ?? existing.editorialScore,
            manualBoost: body.manual_boost ?? existing.manualBoost,
            seasonMode: body.season_mode ?? existing.seasonMode,
            seasonStartMonth:
                body.season_start_month === undefined
                    ? existing.seasonStartMonth
                    : body.season_start_month,
            seasonEndMonth:
                body.season_end_month === undefined
                    ? existing.seasonEndMonth
                    : body.season_end_month,
            manualBoostReason: body.manual_boost_reason ?? null,
            audit,
        });

        const detail = await this.repo.findAdminTourismPlaceByPublicId(placePublicId);
        if (!detail) {
            throw new TourismReviewsError("Tourism profile not found", 404, "PROFILE_NOT_FOUND");
        }
        return this.toAdminProfileDto(detail);
    }

    async createReview(
        actorPublicId: string,
        placePublicId: string,
        body: CreateTourismReviewBody
    ): Promise<TourismReviewOwnerDto> {
        const userId = await this.requireUsableUser(actorPublicId);
        const placeId = await this.requireActivePlace(placePublicId);

        const existing = await this.repo.findActiveReviewByPlaceAndUser(placeId, userId);
        if (existing) {
            throw new TourismReviewsError(
                "You already have a review for this place",
                409,
                "DUPLICATE_REVIEW"
            );
        }

        try {
            const created = await this.repo.createReview({
                placeId,
                userId,
                rating: body.rating,
                title: body.title ?? null,
                body: body.body ?? null,
            });
            return this.toOwnerDto(created);
        } catch (error) {
            if (this.isUniqueViolation(error)) {
                throw new TourismReviewsError(
                    "You already have a review for this place",
                    409,
                    "DUPLICATE_REVIEW"
                );
            }
            throw error;
        }
    }

    async listPublishedReviews(
        placePublicId: string,
        query: ListPublishedTourismReviewsQuery
    ): Promise<TourismReviewPageDto> {
        const placeId = await this.requireActivePlace(placePublicId);

        let cursor: { createdAt: Date; publicId: string } | undefined;
        if (query.cursor) {
            try {
                cursor = decodeTourismReviewCursor(query.cursor);
            } catch (error) {
                if (error instanceof InvalidTourismReviewCursorError) {
                    throw new TourismReviewsError("Invalid cursor", 400, "INVALID_CURSOR");
                }
                throw error;
            }
        }

        const rows = await this.repo.listPublishedReviews({
            placeId,
            cursor,
            limit: query.limit,
        });
        const hasMore = rows.length > query.limit;
        const page = hasMore ? rows.slice(0, query.limit) : rows;
        const last = page[page.length - 1];

        return {
            items: page.map((row) => this.toPublicDto(row)),
            next_cursor:
                hasMore && last
                    ? encodeTourismReviewCursor({
                          createdAt: last.createdAt,
                          publicId: last.publicId,
                      })
                    : null,
        };
    }

    async listAdminReviews(query: AdminTourismReviewsQuery): Promise<TourismAdminReviewPageDto> {
        let cursor: { createdAt: Date; publicId: string } | undefined;
        if (query.cursor) {
            try {
                cursor = decodeTourismReviewCursor(query.cursor);
            } catch (error) {
                if (error instanceof InvalidTourismReviewCursorError) {
                    throw new TourismReviewsError("Invalid cursor", 400, "INVALID_CURSOR");
                }
                throw error;
            }
        }

        let placeId: bigint | undefined;
        if (query.placeId) {
            const resolved = await this.repo.findActivePlaceIdByPublicId(query.placeId);
            if (!resolved) {
                throw new TourismReviewsError("Place not found", 404, "PLACE_NOT_FOUND");
            }
            placeId = resolved;
        }

        let authorUserId: bigint | undefined;
        if (query.authorId) {
            const resolved = await this.repo.findUserIdByPublicId(query.authorId);
            if (!resolved) {
                throw new TourismReviewsError("Author not found", 404, "AUTHOR_NOT_FOUND");
            }
            authorUserId = resolved;
        }

        const rows = await this.repo.listAdminReviews({
            status: query.status,
            placeId,
            authorUserId,
            createdFrom: query.createdFrom ? new Date(query.createdFrom) : undefined,
            createdTo: query.createdTo ? new Date(query.createdTo) : undefined,
            cursor,
            limit: query.limit,
        });
        const hasMore = rows.length > query.limit;
        const page = hasMore ? rows.slice(0, query.limit) : rows;
        const last = page[page.length - 1];

        return {
            items: page.map((row) => this.toOwnerDto(row)),
            next_cursor:
                hasMore && last
                    ? encodeTourismReviewCursor({
                          createdAt: last.createdAt,
                          publicId: last.publicId,
                      })
                    : null,
        };
    }

    async getAdminReview(reviewPublicId: string): Promise<TourismAdminReviewDetailDto> {
        const review = await this.requireReview(reviewPublicId);
        const history = await this.repo.listModerationEvents(review.id);
        return {
            ...this.toOwnerDto(review),
            moderation_history: history.map((event) => this.toModerationEventDto(event)),
        };
    }

    async findMyReviewForPlace(
        actorPublicId: string,
        placePublicId: string
    ): Promise<TourismReviewOwnerDto | null> {
        const userId = await this.requireUsableUser(actorPublicId);
        const placeId = await this.requireActivePlace(placePublicId);
        const row = await this.repo.findActiveReviewByPlaceAndUser(placeId, userId);
        return row ? this.toOwnerDto(row) : null;
    }

    async updateOwnReview(
        actorPublicId: string,
        reviewPublicId: string,
        body: UpdateTourismReviewBody
    ): Promise<TourismReviewOwnerDto> {
        const userId = await this.requireUsableUser(actorPublicId);
        const review = await this.requireReview(reviewPublicId);

        if (review.userId !== userId) {
            throw new TourismReviewsError("You can only edit your own review", 403, "FORBIDDEN");
        }
        if (review.status === "deleted") {
            throw new TourismReviewsError("Deleted reviews cannot be edited", 409, "DELETED");
        }

        const nextStatus: TourismReviewStatus =
            review.status === TOURISM_PUBLIC_REVIEW_STATUS ? "pending" : review.status;

        const title =
            body.title === undefined ? review.title : body.title === null ? null : body.title;
        const bodyText =
            body.body === undefined ? review.body : body.body === null ? null : body.body;
        const rating = body.rating ?? review.rating;

        const updated = await this.repo.updateOwnReview({
            reviewId: review.id,
            placeId: review.placeId,
            userId,
            rating,
            title,
            body: bodyText,
            fromStatus: review.status,
            nextStatus,
        });
        return this.toOwnerDto(updated);
    }

    async softDeleteOwnReview(
        actorPublicId: string,
        reviewPublicId: string
    ): Promise<TourismReviewOwnerDto> {
        const userId = await this.requireUsableUser(actorPublicId);
        const review = await this.requireReview(reviewPublicId);

        if (review.userId !== userId) {
            throw new TourismReviewsError("You can only delete your own review", 403, "FORBIDDEN");
        }
        if (review.status === "deleted") {
            throw new TourismReviewsError("Review is already deleted", 409, "DELETED");
        }

        const deleted = await this.repo.softDeleteOwnReview({
            reviewId: review.id,
            placeId: review.placeId,
            actorUserId: userId,
            fromStatus: review.status,
        });
        return this.toOwnerDto(deleted);
    }

    async changeModerationStatus(
        actorPublicId: string,
        reviewPublicId: string,
        body: ModerateTourismReviewBody,
        audit: AuditContext = {}
    ): Promise<TourismReviewOwnerDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const review = await this.requireReview(reviewPublicId);

        if (review.status === "deleted") {
            throw new TourismReviewsError(
                "Deleted reviews cannot be moderated",
                409,
                "DELETED"
            );
        }

        if (review.status === body.status) {
            return this.toOwnerDto(review);
        }

        const note =
            body.note === undefined
                ? review.moderationNote
                : body.note === null
                  ? null
                  : body.note;

        const updated = await this.repo.changeModerationStatus({
            reviewId: review.id,
            placeId: review.placeId,
            actorUserId,
            fromStatus: review.status,
            toStatus: body.status,
            note,
            audit,
        });
        return this.toOwnerDto(updated);
    }

    async applyAdminAction(
        actorPublicId: string,
        reviewPublicId: string,
        action: TourismAdminModerationAction,
        body: AdminTourismModerationNoteBody = {},
        audit: AuditContext = {}
    ): Promise<TourismReviewOwnerDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const review = await this.requireReview(reviewPublicId);
        const transition = resolveTourismAdminTransition(action, review);

        if (transition.idempotent) {
            return this.toOwnerDto(review);
        }

        const note =
            body.note === undefined
                ? review.moderationNote
                : body.note === null
                  ? null
                  : body.note;

        const updated = await this.repo.changeModerationStatus({
            reviewId: review.id,
            placeId: review.placeId,
            actorUserId,
            fromStatus: review.status,
            toStatus: transition.toStatus,
            note,
            audit,
        });
        return this.toOwnerDto(updated);
    }

    async refreshRatingSummary(placePublicId: string): Promise<TourismRatingSummaryDto> {
        const placeId = await this.requireActivePlace(placePublicId);
        const summary = await this.repo.refreshRatingSummary(placeId);
        return this.toSummaryDto(summary);
    }

    async listTourismCandidates(query: ListAdminTourismCandidatesQuery) {
        const limit = query.limit;
        const offset = query.offset;
        const { rows, total } = await this.repo.listTourismCandidates({
            regionAdminAreaId: query.region_admin_area_id
                ? BigInt(query.region_admin_area_id)
                : null,
            townshipAdminAreaId: query.township_admin_area_id
                ? BigInt(query.township_admin_area_id)
                : null,
            categoryCode: query.category_code ?? null,
            q: query.q ?? null,
            limit,
            offset,
        });

        const items = rows.map((row) => {
            const nameMm = trimName(row.nameMm);
            const nameEn = trimName(row.nameEn);
            const displayName = trimName(row.displayName);
            const primaryName = trimName(row.primaryName);
            const fallback = displayName ?? primaryName ?? "Unnamed Place";
            const name =
                query.lang === "en"
                    ? (nameEn ?? nameMm ?? fallback)
                    : query.lang === "my"
                      ? (nameMm ?? nameEn ?? fallback)
                      : (deriveCoalescedDisplayName({
                            name_mm: nameMm,
                            name_en: nameEn,
                            fallback_name: fallback,
                        }) ?? fallback);

            const suggestedType = suggestTourismTypeForCandidate({
                categoryCode: row.categoryCode,
                osmTourism: row.osmTourism,
                osmHistoric: row.osmHistoric,
                osmLeisure: row.osmLeisure,
                osmNatural: row.osmNatural,
            });

            return {
                public_id: row.publicId,
                name,
                name_mm: nameMm,
                name_en: nameEn,
                lat: row.lat,
                lng: row.lng,
                category_code: row.categoryCode,
                category_name: row.categoryName,
                category_name_mm: row.categoryNameMm,
                importance_score: row.importanceScore,
                is_verified: row.isVerified,
                township_admin_area_id:
                    row.townshipAdminAreaId == null ? null : String(row.townshipAdminAreaId),
                township_name: trimName(row.townshipName),
                region_name: trimName(row.regionName),
                suggested_tourism_type: suggestedType,
                source_signals: {
                    osm_tourism: row.osmTourism,
                    osm_historic: row.osmHistoric,
                    osm_leisure: row.osmLeisure,
                    osm_natural: row.osmNatural,
                },
            };
        });

        return {
            total,
            limit,
            offset,
            items,
        };
    }

    /**
     * Township-first place picker search for Attractions / Activities / Events.
     * Does not exclude places that already have tourism profiles.
     */
    async searchPlacesForPicker(query: ListAdminTourismPlaceSearchQuery) {
        const { rows, townshipName, regionName } = await this.repo.searchPlacesForPicker({
            townshipAdminAreaId: BigInt(query.admin_area_id),
            q: query.q,
            limit: query.limit,
        });

        return {
            admin_area_id: query.admin_area_id,
            township_name: townshipName,
            region_name: regionName,
            limit: query.limit,
            items: rows.map((row) => {
                const displayName =
                    trimName(row.displayName) ??
                    trimName(row.primaryName) ??
                    "Unnamed Place";
                return {
                    public_id: row.publicId,
                    display_name: displayName,
                    category_code: row.categoryCode,
                    category_name: row.categoryName,
                    township_name: townshipName,
                    region_name: regionName,
                    has_tourism_profile: row.hasTourismProfile,
                    is_verified: row.isVerified,
                };
            }),
        };
    }

    async approveTourismCandidate(
        actorPublicId: string,
        placePublicId: string,
        body: ApproveTourismCandidateBody,
        audit: AuditContext = {}
    ) {
        // Reuse existing create path — enforces PROFILE_EXISTS / PLACE_NOT_FOUND.
        return this.createPlaceProfile(actorPublicId, placePublicId, body, audit);
    }

    async ignoreTourismCandidate(
        actorPublicId: string,
        placePublicId: string,
        body: IgnoreTourismCandidateBody,
        audit: AuditContext = {}
    ): Promise<{ public_id: string; ignored: true }> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const place = await this.repo.findPlaceCoreByPublicId(placePublicId);
        if (!place || place.placeDeletedAt) {
            throw new TourismReviewsError("Place not found", 404, "PLACE_NOT_FOUND");
        }

        const existing = await this.repo.findProfileByPlaceId(place.placeId);
        if (existing) {
            throw new TourismReviewsError(
                "Tourism profile already exists for this place",
                409,
                "PROFILE_EXISTS"
            );
        }

        await this.repo.ignoreTourismCandidate({
            placeId: place.placeId,
            actorUserId,
            reason: body.reason ?? null,
            audit,
        });

        return { public_id: placePublicId, ignored: true };
    }

    async listTourismCandidatesOverview(query: ListAdminTourismCandidatesOverviewQuery) {
        const { rows, total } = await this.repo.listTourismCandidateOverview({
            regionAdminAreaId: query.region_admin_area_id
                ? BigInt(query.region_admin_area_id)
                : null,
            limit: query.limit,
            offset: query.offset,
        });

        return {
            total,
            limit: query.limit,
            offset: query.offset,
            items: rows.map((row) => {
                const coverage = resolveTourismCoverageStatus({
                    candidateCount: row.candidateCount,
                    approvedProfileCount: row.approvedProfileCount,
                });
                return {
                    township_admin_area_id: String(row.townshipAdminAreaId),
                    township_name: row.townshipName,
                    region_admin_area_id:
                        row.regionAdminAreaId == null ? null : String(row.regionAdminAreaId),
                    candidate_count: row.candidateCount,
                    approved_tourism_profiles: row.approvedProfileCount,
                    active_public_profiles: row.activePublicProfileCount,
                    verified_profiles: row.verifiedProfileCount,
                    coverage_status: coverage,
                };
            }),
        };
    }

    private async requireUsableUser(publicId: string): Promise<bigint> {
        const userId = await this.repo.findUsableUserIdByPublicId(publicId);
        if (!userId) {
            throw new TourismReviewsError("User account is inactive", 403, "INACTIVE_USER");
        }
        return userId;
    }

    private async requireActivePlace(placePublicId: string): Promise<bigint> {
        const placeId = await this.repo.findActivePlaceIdByPublicId(placePublicId);
        if (!placeId) {
            throw new TourismReviewsError("Place not found", 404, "PLACE_NOT_FOUND");
        }
        return placeId;
    }

    private async requireTourismTypeId(code: string): Promise<bigint> {
        const tourismTypeId = await this.repo.findTourismTypeIdByCode(code);
        if (!tourismTypeId) {
            throw new TourismReviewsError(
                "Invalid tourism type",
                400,
                "INVALID_TOURISM_TYPE"
            );
        }
        return tourismTypeId;
    }

    private async requireReview(reviewPublicId: string): Promise<TourismReviewRow> {
        const review = await this.repo.findReviewByPublicId(reviewPublicId);
        if (!review) {
            throw new TourismReviewsError("Review not found", 404, "REVIEW_NOT_FOUND");
        }
        return review;
    }

    private toPublicDto(row: TourismReviewRow): TourismReviewPublicDto {
        return {
            public_id: row.publicId,
            place_public_id: row.placePublicId,
            rating: row.rating,
            title: row.title,
            body: row.body,
            status: row.status,
            created_at: row.createdAt.toISOString(),
            updated_at: row.updatedAt.toISOString(),
            published_at: row.publishedAt ? row.publishedAt.toISOString() : null,
            author: {
                public_id: row.authorPublicId,
                display_name: row.authorDisplayName,
            },
        };
    }

    private toOwnerDto(row: TourismReviewRow): TourismReviewOwnerDto {
        return {
            ...this.toPublicDto(row),
            moderation_note: row.moderationNote,
        };
    }

    private toModerationEventDto(row: TourismModerationEventRow): TourismModerationEventDto {
        return {
            from_status: row.fromStatus,
            to_status: row.toStatus,
            note: row.note,
            created_at: row.createdAt.toISOString(),
            actor: row.actorPublicId
                ? {
                      public_id: row.actorPublicId,
                      display_name: row.actorDisplayName ?? "Unknown",
                  }
                : null,
        };
    }

    private toSummaryDto(row: TourismRatingSummaryRow): TourismRatingSummaryDto {
        return {
            place_public_id: row.placePublicId,
            published_review_count: row.publishedReviewCount,
            average_rating: row.averageRating === null ? null : Number(row.averageRating),
            updated_at: row.updatedAt.toISOString(),
        };
    }

    private toPublicProfileDto(
        row: TourismPlaceProfileDetailRow,
        lang?: "my" | "en"
    ): TourismPlaceProfilePublicDto {
        const nameMm = trimName(row.nameMm);
        const nameEn = trimName(row.nameEn);
        const displayName = trimName(row.displayName);
        const primaryName = trimName(row.primaryName);
        const fallback = displayName ?? primaryName ?? "Unnamed Place";

        const name =
            lang === "en"
                ? (nameEn ?? nameMm ?? fallback)
                : lang === "my"
                  ? (nameMm ?? nameEn ?? fallback)
                  : (deriveCoalescedDisplayName({
                        name_mm: nameMm,
                        name_en: nameEn,
                        fallback_name: fallback,
                    }) ?? fallback);

        return {
            public_id: row.publicId,
            name,
            name_mm: nameMm,
            name_en: nameEn,
            display_name: displayName,
            primary_name: primaryName,
            lat: row.lat,
            lng: row.lng,
            category_code: row.categoryCode,
            category_name: row.categoryName,
            is_verified: row.isVerified,
            address: row.address
                ? {
                      full_address: row.address.fullAddress,
                      postal_code: row.address.postalCode,
                  }
                : null,
            contact: row.contact
                ? {
                      phone: row.contact.phone,
                      website: row.contact.website,
                      facebook_url: row.contact.facebookUrl,
                      opening_hours: row.contact.openingHours,
                  }
                : null,
            tourism_type: row.tourismType,
            tourism_type_name_en: row.tourismTypeNameEn,
            tourism_type_name_mm: row.tourismTypeNameMm,
            short_description: row.shortDescription,
            price_level: row.priceLevel,
            editor_pick: row.editorPick,
            // From tourism.place_rating_summaries only — never core_places.importance_score.
            average_rating: row.averageRating === null ? null : Number(row.averageRating),
            published_review_count: row.publishedReviewCount,
        };
    }

    private toAdminProfileDto(
        row: TourismPlaceProfileDetailRow,
        boostAudits: Array<{
            createdAt: Date;
            actionType: string;
            manualBoost: number | null;
            reason: string | null;
        }> = []
    ): TourismPlaceProfileAdminDto {
        return {
            ...this.toPublicProfileDto(row),
            is_public: row.isPublic,
            editorial_score: row.editorialScore,
            manual_boost: row.manualBoost,
            season_mode: row.seasonMode,
            season_start_month: row.seasonStartMonth,
            season_end_month: row.seasonEndMonth,
            importance_score: row.importanceScore,
            created_at: row.createdAt.toISOString(),
            updated_at: row.updatedAt.toISOString(),
            recent_manual_boost_audits: boostAudits.map((rowAudit) => ({
                created_at: rowAudit.createdAt.toISOString(),
                action_type: rowAudit.actionType,
                manual_boost: rowAudit.manualBoost,
                reason: rowAudit.reason,
            })),
        };
    }

    private toRankedPlaceDto(
        row: TourismRankedPlaceRow,
        lang: "my" | "en" | undefined,
        mode: ListTourismPlacesRankingQuery["mode"]
    ): TourismRankedPlaceDto {
        const nameMm = trimName(row.nameMm);
        const nameEn = trimName(row.nameEn);
        const displayName = trimName(row.displayName);
        const primaryName = trimName(row.primaryName);
        const fallback = displayName ?? primaryName ?? "Unnamed Place";
        const name =
            lang === "en"
                ? (nameEn ?? nameMm ?? fallback)
                : lang === "my"
                  ? (nameMm ?? nameEn ?? fallback)
                  : (deriveCoalescedDisplayName({
                        name_mm: nameMm,
                        name_en: nameEn,
                        fallback_name: fallback,
                    }) ?? fallback);

        return {
            public_id: row.publicId,
            name,
            name_mm: nameMm,
            name_en: nameEn,
            display_name: displayName,
            primary_name: primaryName,
            lat: row.lat,
            lng: row.lng,
            is_verified: row.isVerified,
            tourism_type: row.tourismType,
            tourism_type_name_en: row.tourismTypeNameEn,
            tourism_type_name_mm: row.tourismTypeNameMm,
            short_description: row.shortDescription,
            price_level: row.priceLevel,
            editor_pick: row.editorPick,
            average_rating: row.averageRating === null ? null : Number(row.averageRating),
            published_review_count: row.publishedReviewCount,
            distance_meters:
                mode === "nearby" && row.distanceMeters !== null
                    ? Number(row.distanceMeters)
                    : null,
        };
    }

    private isUniqueViolation(error: unknown): boolean {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return true;
        }
        const message = error instanceof Error ? error.message : String(error);
        return /unique|duplicate key/i.test(message);
    }
}
