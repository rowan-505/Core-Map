import { Prisma, type PrismaClient } from "@prisma/client";

import {
    PLACE_REGION_RESOLVE_FROM_START_SQL,
    PLACE_TOWNSHIP_RESOLVE_SQL,
} from "../place-popularity/place-popularity.repo.js";
import type { TourismReviewStatus, TourismSeasonMode } from "./tourism.types.js";
import type { TourismRankingCursor, TourismReviewCursor } from "./tourism.schema.js";
import {
    TOURISM_BAYESIAN_PRIOR_WEIGHT,
    TOURISM_TOP_RATED_MIN_REVIEWS,
    type TourismRankingMode,
} from "./tourism.ranking.js";
import type { TourismGeoRankingScope } from "./tourism.geo-ranking.js";
import {
    TOURISM_CANDIDATE_OSM_LEISURE_TAGS,
    TOURISM_CANDIDATE_OSM_NATURAL_TAGS,
    TOURISM_CANDIDATE_OSM_TOURISM_TAGS,
    TOURISM_CANDIDATE_POI_CATEGORY_CODES,
} from "./tourism.candidates.js";

/** system.audit_logs.entity_type for tourism review admin actions. */
export const TOURISM_REVIEW_AUDIT_ENTITY_TYPE = "tourism_place_review";
/** system.audit_logs.entity_type for tourism place profile admin actions. */
export const TOURISM_PROFILE_AUDIT_ENTITY_TYPE = "tourism_place_profile";

export type TourismReviewRow = {
    id: bigint;
    publicId: string;
    placeId: bigint;
    placePublicId: string;
    userId: bigint;
    authorPublicId: string;
    authorDisplayName: string;
    rating: number;
    title: string | null;
    body: string | null;
    status: TourismReviewStatus;
    moderationNote: string | null;
    createdAt: Date;
    updatedAt: Date;
    publishedAt: Date | null;
};

export type TourismRatingSummaryRow = {
    placeId: bigint;
    placePublicId: string;
    publishedReviewCount: number;
    averageRating: string | null;
    updatedAt: Date;
};

export type TourismModerationEventRow = {
    id: bigint;
    reviewId: bigint;
    fromStatus: TourismReviewStatus;
    toStatus: TourismReviewStatus;
    note: string | null;
    createdAt: Date;
    actorPublicId: string | null;
    actorDisplayName: string | null;
};

export type AuditContext = {
    ipAddress?: string | null;
    userAgent?: string | null;
};

/** Safe public address fields from core.core_addresses (no internal ids). */
export type TourismPlaceAddressSafe = {
    fullAddress: string;
    postalCode: string | null;
};

/** Safe public contact fields from core.core_place_contacts (no internal ids/email). */
export type TourismPlaceContactSafe = {
    phone: string | null;
    website: string | null;
    facebookUrl: string | null;
    openingHours: string | null;
};

export type TourismPlaceCoreRow = {
    placeId: bigint;
    publicId: string;
    primaryName: string | null;
    displayName: string | null;
    nameMm: string | null;
    nameEn: string | null;
    lat: number | null;
    lng: number | null;
    categoryCode: string | null;
    categoryName: string | null;
    placeIsPublic: boolean;
    placeDeletedAt: Date | null;
    isVerified: boolean;
    importanceScore: number;
};

export type TourismPlaceProfileRow = {
    placeId: bigint;
    tourismTypeId: bigint;
    tourismType: string;
    tourismTypeNameEn: string;
    tourismTypeNameMm: string | null;
    shortDescription: string | null;
    priceLevel: number | null;
    editorPick: boolean;
    isPublic: boolean;
    editorialScore: number;
    manualBoost: number;
    seasonMode: TourismSeasonMode;
    seasonStartMonth: number | null;
    seasonEndMonth: number | null;
    createdAt: Date;
    updatedAt: Date;
};

export type TourismTypeRow = {
    code: string;
    nameEn: string;
    nameMm: string | null;
    sortOrder: number;
};

export type TourismPlaceProfileDetailRow = TourismPlaceCoreRow &
    TourismPlaceProfileRow & {
        address: TourismPlaceAddressSafe | null;
        contact: TourismPlaceContactSafe | null;
        publishedReviewCount: number;
        averageRating: string | null;
    };

export type TourismRankedPlaceRow = {
    placeId: bigint;
    publicId: string;
    primaryName: string | null;
    displayName: string | null;
    nameMm: string | null;
    nameEn: string | null;
    lat: number | null;
    lng: number | null;
    isVerified: boolean;
    tourismType: string;
    tourismTypeNameEn: string;
    tourismTypeNameMm: string | null;
    shortDescription: string | null;
    priceLevel: number | null;
    editorPick: boolean;
    publishedReviewCount: number;
    averageRating: string | null;
    /** Query-time only; never persisted. Null when no global published average. */
    bayesianScore: number | null;
    distanceMeters: number | null;
};

export type TourismGlobalRatingStats = {
    publishedReviewCount: number;
    averageRating: number | null;
};

type TxClient = Prisma.TransactionClient;

const reviewSelectSql = Prisma.sql`
    r.id,
    r.public_id::text AS "publicId",
    r.place_id AS "placeId",
    p.public_id::text AS "placePublicId",
    r.user_id AS "userId",
    u.public_id::text AS "authorPublicId",
    u.display_name AS "authorDisplayName",
    r.rating,
    r.title,
    r.body,
    r.status AS "status",
    r.moderation_note AS "moderationNote",
    r.created_at AS "createdAt",
    r.updated_at AS "updatedAt",
    r.published_at AS "publishedAt"
`;

export class TourismReviewsRepository {
    constructor(protected readonly prisma: PrismaClient) {}

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

    /** Resolve author filter by public_id (includes inactive accounts). */
    async findUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM app_auth.auth_users
            WHERE public_id::text = ${publicId}
              AND deleted_at IS NULL
              AND is_public = true
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

    /**
     * Load a place + optional tourism profile for admin create/update.
     * Includes soft-deleted places so callers can return PLACE_NOT_FOUND / deleted errors.
     */
    async findPlaceCoreByPublicId(publicId: string): Promise<TourismPlaceCoreRow | null> {
        const rows = await this.prisma.$queryRaw<TourismPlaceCoreRow[]>(Prisma.sql`
            SELECT
                p.id AS "placeId",
                p.public_id::text AS "publicId",
                p.primary_name AS "primaryName",
                COALESCE(p.display_name, name_mm.name, name_en.name, p.primary_name) AS "displayName",
                name_mm.name AS "nameMm",
                name_en.name AS "nameEn",
                p.lat::double precision AS lat,
                p.lng::double precision AS lng,
                c.code AS "categoryCode",
                c.name AS "categoryName",
                p.is_public AS "placeIsPublic",
                p.deleted_at AS "placeDeletedAt",
                p.is_verified AS "isVerified",
                p.importance_score::double precision AS "importanceScore"
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS c ON c.id = p.category_id
            ${tourismPlaceNameMmLateralSql()}
            ${tourismPlaceNameEnLateralSql()}
            WHERE p.public_id::text = ${publicId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async findProfileByPlaceId(placeId: bigint): Promise<TourismPlaceProfileRow | null> {
        const rows = await this.prisma.$queryRaw<TourismPlaceProfileRow[]>(Prisma.sql`
            SELECT
                pf.place_id AS "placeId",
                pf.tourism_type_id AS "tourismTypeId",
                tt.code AS "tourismType",
                tt.name_en AS "tourismTypeNameEn",
                tt.name_mm AS "tourismTypeNameMm",
                pf.short_description AS "shortDescription",
                pf.price_level AS "priceLevel",
                pf.editor_pick AS "editorPick",
                pf.is_public AS "isPublic",
                pf.editorial_score AS "editorialScore",
                pf.manual_boost AS "manualBoost",
                pf.season_mode AS "seasonMode",
                pf.season_start_month AS "seasonStartMonth",
                pf.season_end_month AS "seasonEndMonth",
                pf.created_at AS "createdAt",
                pf.updated_at AS "updatedAt"
            FROM tourism.place_profiles pf
            INNER JOIN ref.ref_tourism_types tt ON tt.id = pf.tourism_type_id
            WHERE pf.place_id = ${placeId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async findTourismTypeIdByCode(code: string): Promise<bigint | null> {
        const row = await this.prisma.refTourismType.findFirst({
            where: { code, isActive: true },
            select: { id: true },
        });
        return row?.id ?? null;
    }

    async listTourismTypes(): Promise<TourismTypeRow[]> {
        return this.prisma.refTourismType.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: { code: true, nameEn: true, nameMm: true, sortOrder: true },
        });
    }

    /**
     * Public tourism place detail.
     * Requires active public core place + public tourism profile.
     */
    async findPublicTourismPlaceByPublicId(
        publicId: string
    ): Promise<TourismPlaceProfileDetailRow | null> {
        const rows = await this.prisma.$queryRaw<
            Array<
                TourismPlaceCoreRow &
                    TourismPlaceProfileRow & {
                        addressFullAddress: string | null;
                        addressPostalCode: string | null;
                        contactPhone: string | null;
                        contactWebsite: string | null;
                        contactFacebookUrl: string | null;
                        contactOpeningHours: string | null;
                        publishedReviewCount: number;
                        averageRating: string | null;
                    }
            >
        >(Prisma.sql`
            SELECT
                p.id AS "placeId",
                p.public_id::text AS "publicId",
                p.primary_name AS "primaryName",
                COALESCE(p.display_name, name_mm.name, name_en.name, p.primary_name) AS "displayName",
                name_mm.name AS "nameMm",
                name_en.name AS "nameEn",
                p.lat::double precision AS lat,
                p.lng::double precision AS lng,
                c.code AS "categoryCode",
                c.name AS "categoryName",
                p.is_public AS "placeIsPublic",
                p.deleted_at AS "placeDeletedAt",
                p.is_verified AS "isVerified",
                p.importance_score::double precision AS "importanceScore",
                pf.tourism_type_id AS "tourismTypeId",
                tt.code AS "tourismType",
                tt.name_en AS "tourismTypeNameEn",
                tt.name_mm AS "tourismTypeNameMm",
                pf.short_description AS "shortDescription",
                pf.price_level AS "priceLevel",
                pf.editor_pick AS "editorPick",
                pf.is_public AS "isPublic",
                pf.editorial_score AS "editorialScore",
                pf.manual_boost AS "manualBoost",
                pf.season_mode AS "seasonMode",
                pf.season_start_month AS "seasonStartMonth",
                pf.season_end_month AS "seasonEndMonth",
                pf.created_at AS "createdAt",
                pf.updated_at AS "updatedAt",
                addr.full_address AS "addressFullAddress",
                addr.postal_code AS "addressPostalCode",
                contact.phone AS "contactPhone",
                contact.website AS "contactWebsite",
                contact.facebook_url AS "contactFacebookUrl",
                contact.opening_hours AS "contactOpeningHours",
                COALESCE(summary.published_review_count, 0) AS "publishedReviewCount",
                summary.average_rating::text AS "averageRating"
            FROM core.core_places AS p
            INNER JOIN tourism.place_profiles AS pf ON pf.place_id = p.id
            INNER JOIN ref.ref_tourism_types AS tt ON tt.id = pf.tourism_type_id
            LEFT JOIN ref.ref_poi_categories AS c ON c.id = p.category_id
            LEFT JOIN community.place_rating_summaries AS summary ON summary.place_id = p.id
            ${tourismPlaceNameMmLateralSql()}
            ${tourismPlaceNameEnLateralSql()}
            ${tourismPlaceAddressSafeLateralSql()}
            ${tourismPlaceContactSafeLateralSql()}
            WHERE p.public_id::text = ${publicId}
              AND p.deleted_at IS NULL
              AND p.is_public = true
              AND pf.is_public = true
            LIMIT 1
        `);

        const row = rows[0];
        if (!row) return null;

        return {
            placeId: row.placeId,
            publicId: row.publicId,
            primaryName: row.primaryName,
            displayName: row.displayName,
            nameMm: row.nameMm,
            nameEn: row.nameEn,
            lat: row.lat,
            lng: row.lng,
            categoryCode: row.categoryCode,
            categoryName: row.categoryName,
            placeIsPublic: row.placeIsPublic,
            placeDeletedAt: row.placeDeletedAt,
            isVerified: row.isVerified,
            importanceScore: row.importanceScore,
            tourismTypeId: row.tourismTypeId,
            tourismType: row.tourismType,
            tourismTypeNameEn: row.tourismTypeNameEn,
            tourismTypeNameMm: row.tourismTypeNameMm,
            shortDescription: row.shortDescription,
            priceLevel: row.priceLevel,
            editorPick: row.editorPick,
            isPublic: row.isPublic,
            editorialScore: row.editorialScore,
            manualBoost: row.manualBoost,
            seasonMode: row.seasonMode,
            seasonStartMonth: row.seasonStartMonth,
            seasonEndMonth: row.seasonEndMonth,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            address: row.addressFullAddress
                ? {
                      fullAddress: row.addressFullAddress,
                      postalCode: row.addressPostalCode,
                  }
                : null,
            contact:
                row.contactPhone ||
                row.contactWebsite ||
                row.contactFacebookUrl ||
                row.contactOpeningHours
                    ? {
                          phone: row.contactPhone,
                          website: row.contactWebsite,
                          facebookUrl: row.contactFacebookUrl,
                          openingHours: row.contactOpeningHours,
                      }
                    : null,
            publishedReviewCount: row.publishedReviewCount,
            averageRating: row.averageRating,
        };
    }

    async findAdminTourismPlaceByPublicId(
        publicId: string
    ): Promise<TourismPlaceProfileDetailRow | null> {
        const rows = await this.prisma.$queryRaw<
            Array<
                TourismPlaceCoreRow &
                    TourismPlaceProfileRow & {
                        addressFullAddress: string | null;
                        addressPostalCode: string | null;
                        contactPhone: string | null;
                        contactWebsite: string | null;
                        contactFacebookUrl: string | null;
                        contactOpeningHours: string | null;
                        publishedReviewCount: number;
                        averageRating: string | null;
                    }
            >
        >(Prisma.sql`
            SELECT
                p.id AS "placeId",
                p.public_id::text AS "publicId",
                p.primary_name AS "primaryName",
                COALESCE(p.display_name, name_mm.name, name_en.name, p.primary_name) AS "displayName",
                name_mm.name AS "nameMm",
                name_en.name AS "nameEn",
                p.lat::double precision AS lat,
                p.lng::double precision AS lng,
                c.code AS "categoryCode",
                c.name AS "categoryName",
                p.is_public AS "placeIsPublic",
                p.deleted_at AS "placeDeletedAt",
                p.is_verified AS "isVerified",
                p.importance_score::double precision AS "importanceScore",
                pf.tourism_type_id AS "tourismTypeId",
                tt.code AS "tourismType",
                tt.name_en AS "tourismTypeNameEn",
                tt.name_mm AS "tourismTypeNameMm",
                pf.short_description AS "shortDescription",
                pf.price_level AS "priceLevel",
                pf.editor_pick AS "editorPick",
                pf.is_public AS "isPublic",
                pf.editorial_score AS "editorialScore",
                pf.manual_boost AS "manualBoost",
                pf.season_mode AS "seasonMode",
                pf.season_start_month AS "seasonStartMonth",
                pf.season_end_month AS "seasonEndMonth",
                pf.created_at AS "createdAt",
                pf.updated_at AS "updatedAt",
                addr.full_address AS "addressFullAddress",
                addr.postal_code AS "addressPostalCode",
                contact.phone AS "contactPhone",
                contact.website AS "contactWebsite",
                contact.facebook_url AS "contactFacebookUrl",
                contact.opening_hours AS "contactOpeningHours",
                COALESCE(summary.published_review_count, 0) AS "publishedReviewCount",
                summary.average_rating::text AS "averageRating"
            FROM core.core_places AS p
            INNER JOIN tourism.place_profiles AS pf ON pf.place_id = p.id
            INNER JOIN ref.ref_tourism_types AS tt ON tt.id = pf.tourism_type_id
            LEFT JOIN ref.ref_poi_categories AS c ON c.id = p.category_id
            LEFT JOIN community.place_rating_summaries AS summary ON summary.place_id = p.id
            ${tourismPlaceNameMmLateralSql()}
            ${tourismPlaceNameEnLateralSql()}
            ${tourismPlaceAddressSafeLateralSql()}
            ${tourismPlaceContactSafeLateralSql()}
            WHERE p.public_id::text = ${publicId}
            LIMIT 1
        `);

        const row = rows[0];
        if (!row) return null;

        return {
            placeId: row.placeId,
            publicId: row.publicId,
            primaryName: row.primaryName,
            displayName: row.displayName,
            nameMm: row.nameMm,
            nameEn: row.nameEn,
            lat: row.lat,
            lng: row.lng,
            categoryCode: row.categoryCode,
            categoryName: row.categoryName,
            placeIsPublic: row.placeIsPublic,
            placeDeletedAt: row.placeDeletedAt,
            isVerified: row.isVerified,
            importanceScore: row.importanceScore,
            tourismTypeId: row.tourismTypeId,
            tourismType: row.tourismType,
            tourismTypeNameEn: row.tourismTypeNameEn,
            tourismTypeNameMm: row.tourismTypeNameMm,
            shortDescription: row.shortDescription,
            priceLevel: row.priceLevel,
            editorPick: row.editorPick,
            isPublic: row.isPublic,
            editorialScore: row.editorialScore,
            manualBoost: row.manualBoost,
            seasonMode: row.seasonMode,
            seasonStartMonth: row.seasonStartMonth,
            seasonEndMonth: row.seasonEndMonth,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            address: row.addressFullAddress
                ? {
                      fullAddress: row.addressFullAddress,
                      postalCode: row.addressPostalCode,
                  }
                : null,
            contact:
                row.contactPhone ||
                row.contactWebsite ||
                row.contactFacebookUrl ||
                row.contactOpeningHours
                    ? {
                          phone: row.contactPhone,
                          website: row.contactWebsite,
                          facebookUrl: row.contactFacebookUrl,
                          openingHours: row.contactOpeningHours,
                      }
                    : null,
            publishedReviewCount: row.publishedReviewCount,
            averageRating: row.averageRating,
        };
    }

    async createPlaceProfile(input: {
        placeId: bigint;
        actorUserId: bigint;
        tourismTypeId: bigint;
        tourismType: string;
        shortDescription: string | null;
        priceLevel: number | null;
        editorPick: boolean;
        isPublic: boolean;
        editorialScore: number;
        manualBoost: number;
        seasonMode: TourismSeasonMode;
        seasonStartMonth: number | null;
        seasonEndMonth: number | null;
        /** Required in audit when manual boost is non-zero. */
        manualBoostReason?: string | null;
        audit: AuditContext;
    }): Promise<TourismPlaceProfileRow> {
        return this.prisma.$transaction(async (tx) => {
            await tx.tourismPlaceProfile.create({
                data: {
                    placeId: input.placeId,
                    tourismTypeId: input.tourismTypeId,
                    shortDescription: input.shortDescription,
                    priceLevel: input.priceLevel,
                    editorPick: input.editorPick,
                    isPublic: input.isPublic,
                    editorialScore: input.editorialScore,
                    manualBoost: input.manualBoost,
                    seasonMode: input.seasonMode,
                    seasonStartMonth: input.seasonStartMonth,
                    seasonEndMonth: input.seasonEndMonth,
                    createdBy: input.actorUserId,
                    updatedBy: input.actorUserId,
                },
            });
            const boostChanged = input.manualBoost !== 0;
            await tx.auditLog.create({
                data: {
                    actorUserId: input.actorUserId,
                    actionType: boostChanged
                        ? "tourism_place_profile_manual_boost_set"
                        : "tourism_place_profile_created",
                    entityType: TOURISM_PROFILE_AUDIT_ENTITY_TYPE,
                    entityId: input.placeId,
                    beforeSnapshot: Prisma.JsonNull,
                    afterSnapshot: {
                        tourism_type: input.tourismType,
                        short_description: input.shortDescription,
                        price_level: input.priceLevel,
                        editor_pick: input.editorPick,
                        is_public: input.isPublic,
                        editorial_score: input.editorialScore,
                        manual_boost: input.manualBoost,
                        ...(boostChanged
                            ? {
                                  manual_boost_reason:
                                      input.manualBoostReason?.trim() || null,
                              }
                            : {}),
                        season_mode: input.seasonMode,
                        season_start_month: input.seasonStartMonth,
                        season_end_month: input.seasonEndMonth,
                    },
                    ipAddress: input.audit.ipAddress ?? null,
                    userAgent: input.audit.userAgent ?? null,
                },
            });
            const row = await this.findProfileByPlaceIdInTx(tx, input.placeId);
            if (!row) {
                throw new Error("Created tourism place profile could not be reloaded");
            }
            return row;
        });
    }

    async updatePlaceProfile(input: {
        placeId: bigint;
        actorUserId: bigint;
        before: TourismPlaceProfileRow;
        tourismTypeId: bigint;
        tourismType: string;
        shortDescription: string | null;
        priceLevel: number | null;
        editorPick: boolean;
        isPublic: boolean;
        editorialScore: number;
        manualBoost: number;
        seasonMode: TourismSeasonMode;
        seasonStartMonth: number | null;
        seasonEndMonth: number | null;
        manualBoostReason?: string | null;
        audit: AuditContext;
    }): Promise<TourismPlaceProfileRow> {
        return this.prisma.$transaction(async (tx) => {
            await tx.tourismPlaceProfile.update({
                where: { placeId: input.placeId },
                data: {
                    tourismTypeId: input.tourismTypeId,
                    shortDescription: input.shortDescription,
                    priceLevel: input.priceLevel,
                    editorPick: input.editorPick,
                    isPublic: input.isPublic,
                    editorialScore: input.editorialScore,
                    manualBoost: input.manualBoost,
                    seasonMode: input.seasonMode,
                    seasonStartMonth: input.seasonStartMonth,
                    seasonEndMonth: input.seasonEndMonth,
                    updatedBy: input.actorUserId,
                },
            });
            const boostChanged = input.before.manualBoost !== input.manualBoost;
            await tx.auditLog.create({
                data: {
                    actorUserId: input.actorUserId,
                    actionType: boostChanged
                        ? "tourism_place_profile_manual_boost_updated"
                        : "tourism_place_profile_updated",
                    entityType: TOURISM_PROFILE_AUDIT_ENTITY_TYPE,
                    entityId: input.placeId,
                    beforeSnapshot: {
                        tourism_type: input.before.tourismType,
                        short_description: input.before.shortDescription,
                        price_level: input.before.priceLevel,
                        editor_pick: input.before.editorPick,
                        is_public: input.before.isPublic,
                        editorial_score: input.before.editorialScore,
                        manual_boost: input.before.manualBoost,
                        season_mode: input.before.seasonMode,
                        season_start_month: input.before.seasonStartMonth,
                        season_end_month: input.before.seasonEndMonth,
                    },
                    afterSnapshot: {
                        tourism_type: input.tourismType,
                        short_description: input.shortDescription,
                        price_level: input.priceLevel,
                        editor_pick: input.editorPick,
                        is_public: input.isPublic,
                        editorial_score: input.editorialScore,
                        manual_boost: input.manualBoost,
                        ...(boostChanged
                            ? {
                                  manual_boost_reason:
                                      input.manualBoostReason?.trim() || null,
                              }
                            : {}),
                        season_mode: input.seasonMode,
                        season_start_month: input.seasonStartMonth,
                        season_end_month: input.seasonEndMonth,
                    },
                    ipAddress: input.audit.ipAddress ?? null,
                    userAgent: input.audit.userAgent ?? null,
                },
            });
            const row = await this.findProfileByPlaceIdInTx(tx, input.placeId);
            if (!row) {
                throw new Error("Updated tourism place profile could not be reloaded");
            }
            return row;
        });
    }

    /**
     * Global published-review aggregate for Bayesian C.
     * Counts only status='published' rows (hidden/rejected/deleted excluded).
     */
    async getGlobalPublishedRatingStats(): Promise<TourismGlobalRatingStats> {
        const rows = await this.prisma.$queryRaw<
            Array<{ publishedReviewCount: number; averageRating: string | null }>
        >(Prisma.sql`
            SELECT
                COUNT(*)::integer AS "publishedReviewCount",
                AVG(rating)::text AS "averageRating"
            FROM community.place_reviews
            WHERE status = 'published'
        `);
        const row = rows[0];
        return {
            publishedReviewCount: row?.publishedReviewCount ?? 0,
            averageRating: row?.averageRating === null || row?.averageRating === undefined
                ? null
                : Number(row.averageRating),
        };
    }

    /**
     * Ranked public tourism places.
     * Bayesian score is computed in SQL at query time (never read from summaries).
     */
    async listRankedPlaces(input: {
        mode: TourismRankingMode;
        tourismType?: string;
        bbox?: [number, number, number, number];
        lat?: number;
        lng?: number;
        radiusMeters?: number;
        cursor?: TourismRankingCursor;
        limit: number;
    }): Promise<TourismRankedPlaceRow[]> {
        const m = TOURISM_BAYESIAN_PRIOR_WEIGHT;
        const where: Prisma.Sql[] = [
            Prisma.sql`p.deleted_at IS NULL`,
            Prisma.sql`p.is_public = true`,
            Prisma.sql`pf.is_public = true`,
            Prisma.sql`p.point_geom IS NOT NULL`,
        ];

        if (input.tourismType) {
            where.push(Prisma.sql`tt.code = ${input.tourismType}`);
        }
        if (input.mode === "editor_picks") {
            where.push(Prisma.sql`pf.editor_pick = true`);
        }
        if (input.mode === "top_rated") {
            where.push(
                Prisma.sql`COALESCE(s.published_review_count, 0) >= ${TOURISM_TOP_RATED_MIN_REVIEWS}`
            );
        }
        if (input.bbox) {
            const [minLng, minLat, maxLng, maxLat] = input.bbox;
            where.push(Prisma.sql`
                p.point_geom && ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)
            `);
        }

        const hasOrigin = input.lat !== undefined && input.lng !== undefined;
        const originSql = hasOrigin
            ? Prisma.sql`ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography`
            : null;

        if (input.mode === "nearby" && originSql && input.radiusMeters !== undefined) {
            // Generous degree bbox (superset of the metric radius) so
            // core.core_places_point_geom_gix can prefilter; exact geography
            // ST_DWithin then trims the remainder (same pattern as transport stop search).
            const radiusDeg = input.radiusMeters / 90_000;
            where.push(Prisma.sql`
                p.point_geom && ST_Expand(
                    ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326),
                    ${radiusDeg}::float8
                )
                AND ST_DWithin(
                    p.point_geom::geography,
                    ${originSql},
                    ${input.radiusMeters}
                )
            `);
        }

        const distanceSelectSql =
            originSql !== null
                ? Prisma.sql`ST_Distance(p.point_geom::geography, ${originSql})`
                : Prisma.sql`NULL::float8`;

        const cursorWhereSql = input.cursor
            ? Prisma.sql`AND ${tourismRankingCursorWhereOnAlias(input.mode, input.cursor)}`
            : Prisma.empty;

        const orderSql = tourismRankingOrderOnAlias(input.mode);

        return this.prisma.$queryRaw<TourismRankedPlaceRow[]>(Prisma.sql`
            WITH global_stats AS (
                SELECT
                    COUNT(*)::integer AS global_count,
                    AVG(rating)::float8 AS global_avg
                FROM community.place_reviews
                WHERE status = 'published'
            ),
            ranked AS (
                SELECT
                    p.id AS "placeId",
                    p.public_id::text AS "publicId",
                    p.primary_name AS "primaryName",
                    COALESCE(p.display_name, name_mm.name, name_en.name, p.primary_name) AS "displayName",
                    name_mm.name AS "nameMm",
                    name_en.name AS "nameEn",
                    p.lat::double precision AS lat,
                    p.lng::double precision AS lng,
                    p.is_verified AS "isVerified",
                    tt.code AS "tourismType",
                    tt.name_en AS "tourismTypeNameEn",
                    tt.name_mm AS "tourismTypeNameMm",
                    pf.short_description AS "shortDescription",
                    pf.price_level AS "priceLevel",
                    pf.editor_pick AS "editorPick",
                    COALESCE(s.published_review_count, 0) AS "publishedReviewCount",
                    s.average_rating::text AS "averageRating",
                    CASE
                        WHEN g.global_count = 0
                          OR s.average_rating IS NULL
                          OR COALESCE(s.published_review_count, 0) = 0
                        THEN NULL::float8
                        ELSE
                            (COALESCE(s.published_review_count, 0)::float8
                                / (COALESCE(s.published_review_count, 0) + ${m}))
                                * s.average_rating::float8
                            + (${m}::float8
                                / (COALESCE(s.published_review_count, 0) + ${m}))
                                * g.global_avg
                    END AS "bayesianScore",
                    ${distanceSelectSql} AS "distanceMeters"
                FROM tourism.place_profiles AS pf
                INNER JOIN core.core_places AS p ON p.id = pf.place_id
                INNER JOIN ref.ref_tourism_types AS tt ON tt.id = pf.tourism_type_id
                LEFT JOIN community.place_rating_summaries AS s ON s.place_id = p.id
                CROSS JOIN global_stats AS g
                ${tourismPlaceNameMmLateralSql()}
                ${tourismPlaceNameEnLateralSql()}
                WHERE ${Prisma.join(where, " AND ")}
            )
            SELECT *
            FROM ranked AS r
            WHERE TRUE
              ${cursorWhereSql}
            ORDER BY ${orderSql}
            LIMIT ${input.limit + 1}
        `);
    }

    async findReviewByPublicId(publicId: string): Promise<TourismReviewRow | null> {
        const rows = await this.prisma.$queryRaw<TourismReviewRow[]>(Prisma.sql`
            SELECT ${reviewSelectSql}
            FROM community.place_reviews r
            JOIN core.core_places p ON p.id = r.place_id
            JOIN app_auth.auth_users u ON u.id = r.user_id
            WHERE r.public_id::text = ${publicId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async findActiveReviewByPlaceAndUser(
        placeId: bigint,
        userId: bigint
    ): Promise<TourismReviewRow | null> {
        const rows = await this.prisma.$queryRaw<TourismReviewRow[]>(Prisma.sql`
            SELECT ${reviewSelectSql}
            FROM community.place_reviews r
            JOIN core.core_places p ON p.id = r.place_id
            JOIN app_auth.auth_users u ON u.id = r.user_id
            WHERE r.place_id = ${placeId}
              AND r.user_id = ${userId}
              AND r.status <> 'deleted'
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async listPublishedReviews(input: {
        placeId: bigint;
        cursor?: TourismReviewCursor;
        limit: number;
    }): Promise<TourismReviewRow[]> {
        const where: Prisma.Sql[] = [
            Prisma.sql`r.place_id = ${input.placeId}`,
            Prisma.sql`r.status = 'published'`,
            Prisma.sql`p.deleted_at IS NULL`,
            Prisma.sql`p.is_public = true`,
        ];

        if (input.cursor) {
            where.push(Prisma.sql`
                (r.created_at, r.public_id) < (${input.cursor.createdAt}, ${input.cursor.publicId}::uuid)
            `);
        }

        return this.prisma.$queryRaw<TourismReviewRow[]>(Prisma.sql`
            SELECT ${reviewSelectSql}
            FROM community.place_reviews r
            JOIN core.core_places p ON p.id = r.place_id
            JOIN app_auth.auth_users u ON u.id = r.user_id
            WHERE ${Prisma.join(where, " AND ")}
            ORDER BY r.created_at DESC, r.public_id DESC
            LIMIT ${input.limit + 1}
        `);
    }

    async listAdminReviews(input: {
        status?: TourismReviewStatus;
        placeId?: bigint;
        authorUserId?: bigint;
        createdFrom?: Date;
        createdTo?: Date;
        cursor?: TourismReviewCursor;
        limit: number;
    }): Promise<TourismReviewRow[]> {
        const where: Prisma.Sql[] = [];

        if (input.status) {
            where.push(Prisma.sql`r.status = ${input.status}`);
        }
        if (input.placeId !== undefined) {
            where.push(Prisma.sql`r.place_id = ${input.placeId}`);
        }
        if (input.authorUserId !== undefined) {
            where.push(Prisma.sql`r.user_id = ${input.authorUserId}`);
        }
        if (input.createdFrom) {
            where.push(Prisma.sql`r.created_at >= ${input.createdFrom}`);
        }
        if (input.createdTo) {
            where.push(Prisma.sql`r.created_at <= ${input.createdTo}`);
        }
        if (input.cursor) {
            where.push(Prisma.sql`
                (r.created_at, r.public_id) < (${input.cursor.createdAt}, ${input.cursor.publicId}::uuid)
            `);
        }

        const whereSql =
            where.length > 0 ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty;

        return this.prisma.$queryRaw<TourismReviewRow[]>(Prisma.sql`
            SELECT ${reviewSelectSql}
            FROM community.place_reviews r
            JOIN core.core_places p ON p.id = r.place_id
            JOIN app_auth.auth_users u ON u.id = r.user_id
            ${whereSql}
            ORDER BY r.created_at DESC, r.public_id DESC
            LIMIT ${input.limit + 1}
        `);
    }

    async listModerationEvents(reviewId: bigint): Promise<TourismModerationEventRow[]> {
        return this.prisma.$queryRaw<TourismModerationEventRow[]>(Prisma.sql`
            SELECT
                e.id,
                e.review_id AS "reviewId",
                e.from_status AS "fromStatus",
                e.to_status AS "toStatus",
                e.note,
                e.created_at AS "createdAt",
                u.public_id::text AS "actorPublicId",
                u.display_name AS "actorDisplayName"
            FROM community.review_moderation_events e
            LEFT JOIN app_auth.auth_users u ON u.id = e.actor_user_id
            WHERE e.review_id = ${reviewId}
            ORDER BY e.created_at ASC, e.id ASC
        `);
    }

    async getRatingSummaryByPlaceId(placeId: bigint): Promise<TourismRatingSummaryRow | null> {
        const rows = await this.prisma.$queryRaw<TourismRatingSummaryRow[]>(Prisma.sql`
            SELECT
                s.place_id AS "placeId",
                p.public_id::text AS "placePublicId",
                s.published_review_count AS "publishedReviewCount",
                s.average_rating::text AS "averageRating",
                s.updated_at AS "updatedAt"
            FROM community.place_rating_summaries s
            JOIN core.core_places p ON p.id = s.place_id
            WHERE s.place_id = ${placeId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async createReview(input: {
        placeId: bigint;
        userId: bigint;
        rating: number;
        title: string | null;
        body: string | null;
    }): Promise<TourismReviewRow> {
        return this.prisma.$transaction(async (tx) => {
            const created = await tx.communityPlaceReview.create({
                data: {
                    placeId: input.placeId,
                    userId: input.userId,
                    rating: input.rating,
                    title: input.title,
                    body: input.body,
                    status: "pending",
                },
            });
            await this.refreshRatingSummaryInTx(tx, input.placeId);
            const row = await this.findReviewByPublicIdInTx(tx, created.publicId);
            if (!row) {
                throw new Error("Created tourism review could not be reloaded");
            }
            return row;
        });
    }

    async updateOwnReview(input: {
        reviewId: bigint;
        placeId: bigint;
        userId: bigint;
        rating: number;
        title: string | null;
        body: string | null;
        fromStatus: TourismReviewStatus;
        nextStatus: TourismReviewStatus;
    }): Promise<TourismReviewRow> {
        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.communityPlaceReview.update({
                where: { id: input.reviewId },
                data: {
                    rating: input.rating,
                    title: input.title,
                    body: input.body,
                    status: input.nextStatus,
                },
            });
            if (input.fromStatus !== input.nextStatus) {
                await tx.communityReviewModerationEvent.create({
                    data: {
                        reviewId: input.reviewId,
                        actorUserId: input.userId,
                        fromStatus: input.fromStatus,
                        toStatus: input.nextStatus,
                        note: "author_edit",
                    },
                });
            }
            await this.refreshRatingSummaryInTx(tx, input.placeId);
            const row = await this.findReviewByPublicIdInTx(tx, updated.publicId);
            if (!row) {
                throw new Error("Updated tourism review could not be reloaded");
            }
            return row;
        });
    }

    async softDeleteOwnReview(input: {
        reviewId: bigint;
        placeId: bigint;
        actorUserId: bigint;
        fromStatus: TourismReviewStatus;
    }): Promise<TourismReviewRow> {
        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.communityPlaceReview.update({
                where: { id: input.reviewId },
                data: { status: "deleted" },
            });
            await tx.communityReviewModerationEvent.create({
                data: {
                    reviewId: input.reviewId,
                    actorUserId: input.actorUserId,
                    fromStatus: input.fromStatus,
                    toStatus: "deleted",
                    note: null,
                },
            });
            await this.refreshRatingSummaryInTx(tx, input.placeId);
            const row = await this.findReviewByPublicIdInTx(tx, updated.publicId);
            if (!row) {
                throw new Error("Deleted tourism review could not be reloaded");
            }
            return row;
        });
    }

    async changeModerationStatus(input: {
        reviewId: bigint;
        placeId: bigint;
        actorUserId: bigint;
        fromStatus: TourismReviewStatus;
        toStatus: Exclude<TourismReviewStatus, "deleted">;
        note: string | null;
        audit: AuditContext;
    }): Promise<TourismReviewRow> {
        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.communityPlaceReview.update({
                where: { id: input.reviewId },
                data: {
                    status: input.toStatus,
                    moderationNote: input.note,
                },
            });
            await tx.communityReviewModerationEvent.create({
                data: {
                    reviewId: input.reviewId,
                    actorUserId: input.actorUserId,
                    fromStatus: input.fromStatus,
                    toStatus: input.toStatus,
                    note: input.note,
                },
            });
            await this.refreshRatingSummaryInTx(tx, input.placeId);
            await tx.auditLog.create({
                data: {
                    actorUserId: input.actorUserId,
                    actionType: "place_review_status_changed",
                    entityType: TOURISM_REVIEW_AUDIT_ENTITY_TYPE,
                    entityId: input.reviewId,
                    beforeSnapshot: { status: input.fromStatus },
                    afterSnapshot: { status: input.toStatus, note: input.note },
                    ipAddress: input.audit.ipAddress ?? null,
                    userAgent: input.audit.userAgent ?? null,
                },
            });
            const row = await this.findReviewByPublicIdInTx(tx, updated.publicId);
            if (!row) {
                throw new Error("Moderated tourism review could not be reloaded");
            }
            return row;
        });
    }

    async refreshRatingSummary(placeId: bigint): Promise<TourismRatingSummaryRow> {
        return this.prisma.$transaction(async (tx) => {
            await this.refreshRatingSummaryInTx(tx, placeId);
            const summary = await this.getRatingSummaryByPlaceIdInTx(tx, placeId);
            if (!summary) {
                // Trigger/upsert always writes a row; synthesize empty if somehow missing.
                const place = await tx.$queryRaw<{ public_id: string }[]>(Prisma.sql`
                    SELECT public_id::text AS public_id
                    FROM core.core_places
                    WHERE id = ${placeId}
                    LIMIT 1
                `);
                return {
                    placeId,
                    placePublicId: place[0]?.public_id ?? "",
                    publishedReviewCount: 0,
                    averageRating: null,
                    updatedAt: new Date(),
                };
            }
            return summary;
        });
    }

    private async refreshRatingSummaryInTx(tx: TxClient, placeId: bigint): Promise<void> {
        await tx.$executeRaw`SELECT community.refresh_place_rating_summary(${placeId})`;
    }

    private async findReviewByPublicIdInTx(
        tx: TxClient,
        publicId: string
    ): Promise<TourismReviewRow | null> {
        const rows = await tx.$queryRaw<TourismReviewRow[]>(Prisma.sql`
            SELECT ${reviewSelectSql}
            FROM community.place_reviews r
            JOIN core.core_places p ON p.id = r.place_id
            JOIN app_auth.auth_users u ON u.id = r.user_id
            WHERE r.public_id::text = ${publicId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    private async getRatingSummaryByPlaceIdInTx(
        tx: TxClient,
        placeId: bigint
    ): Promise<TourismRatingSummaryRow | null> {
        const rows = await tx.$queryRaw<TourismRatingSummaryRow[]>(Prisma.sql`
            SELECT
                s.place_id AS "placeId",
                p.public_id::text AS "placePublicId",
                s.published_review_count AS "publishedReviewCount",
                s.average_rating::text AS "averageRating",
                s.updated_at AS "updatedAt"
            FROM community.place_rating_summaries s
            JOIN core.core_places p ON p.id = s.place_id
            WHERE s.place_id = ${placeId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    private async findProfileByPlaceIdInTx(
        tx: TxClient,
        placeId: bigint
    ): Promise<TourismPlaceProfileRow | null> {
        const rows = await tx.$queryRaw<TourismPlaceProfileRow[]>(Prisma.sql`
            SELECT
                pf.place_id AS "placeId",
                pf.tourism_type_id AS "tourismTypeId",
                tt.code AS "tourismType",
                tt.name_en AS "tourismTypeNameEn",
                tt.name_mm AS "tourismTypeNameMm",
                pf.short_description AS "shortDescription",
                pf.price_level AS "priceLevel",
                pf.editor_pick AS "editorPick",
                pf.is_public AS "isPublic",
                pf.editorial_score AS "editorialScore",
                pf.manual_boost AS "manualBoost",
                pf.season_mode AS "seasonMode",
                pf.season_start_month AS "seasonStartMonth",
                pf.season_end_month AS "seasonEndMonth",
                pf.created_at AS "createdAt",
                pf.updated_at AS "updatedAt"
            FROM tourism.place_profiles pf
            INNER JOIN ref.ref_tourism_types tt ON tt.id = pf.tourism_type_id
            WHERE pf.place_id = ${placeId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async findActiveRankingConfig(
        scopeType: TourismGeoRankingScope
    ): Promise<TourismRankingConfigRow | null> {
        const rows = await this.prisma.$queryRaw<TourismRankingConfigRow[]>`
            SELECT
                id,
                scope_type AS "scopeType",
                algorithm_version AS "algorithmVersion",
                editorial_weight::float8 AS "editorialWeight",
                importance_weight::float8 AS "importanceWeight",
                review_weight::float8 AS "reviewWeight",
                popularity_weight::float8 AS "popularityWeight",
                effective_from AS "effectiveFrom",
                is_active AS "isActive"
            FROM tourism.ranking_configs
            WHERE scope_type = ${scopeType}
              AND is_active IS TRUE
            ORDER BY effective_from DESC, id DESC
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    /**
     * Batch-load tourism ranking candidates for one independent geographic scope.
     * temporarily_closed rows are included so the service can exclude them after scoring.
     */
    async listGeoRankingCandidates(input: {
        scope: TourismGeoRankingScope;
        townshipAdminAreaId?: bigint | null;
        regionAdminAreaId?: bigint | null;
        tourismType?: string | null;
    }): Promise<TourismGeoRankingCandidateRow[]> {
        const typeFilter = input.tourismType
            ? Prisma.sql`AND tt.code = ${input.tourismType}`
            : Prisma.empty;

        let scopeFilter = Prisma.empty;
        if (input.scope === "township") {
            if (input.townshipAdminAreaId == null) return [];
            scopeFilter = Prisma.sql`
                AND (${PLACE_TOWNSHIP_RESOLVE_SQL}) = ${input.townshipAdminAreaId}
            `;
        } else if (input.scope === "region") {
            if (input.regionAdminAreaId == null) return [];
            scopeFilter = Prisma.sql`
                AND (
                    WITH start_point AS (
                        SELECT COALESCE(
                            (${PLACE_TOWNSHIP_RESOLVE_SQL}),
                            p.admin_area_id
                        ) AS start_admin_area_id
                    )
                    SELECT (${PLACE_REGION_RESOLVE_FROM_START_SQL})
                    FROM start_point
                    WHERE start_admin_area_id IS NOT NULL
                ) = ${input.regionAdminAreaId}
            `;
        }

        return this.prisma.$queryRaw<TourismGeoRankingCandidateRow[]>`
            SELECT
                p.id AS "placeId",
                p.public_id::text AS "publicId",
                p.display_name AS "displayName",
                p.primary_name AS "primaryName",
                name_mm.name AS "nameMm",
                name_en.name AS "nameEn",
                p.lat,
                p.lng,
                p.importance_score::float8 AS "importanceScore",
                p.is_verified AS "isVerified",
                tt.code AS "tourismType",
                tt.name_en AS "tourismTypeNameEn",
                tt.name_mm AS "tourismTypeNameMm",
                pf.short_description AS "shortDescription",
                pf.price_level AS "priceLevel",
                pf.editor_pick AS "editorPick",
                pf.editorial_score AS "editorialScore",
                pf.manual_boost AS "manualBoost",
                pf.season_mode AS "seasonMode",
                pf.season_start_month AS "seasonStartMonth",
                pf.season_end_month AS "seasonEndMonth",
                COALESCE(s.published_review_count, 0)::int AS "publishedReviewCount",
                s.average_rating::float8 AS "averageRating",
                COALESCE(
                    NULLIF(trim(township_en.name), ''),
                    NULLIF(trim(township_mm.name), ''),
                    NULLIF(trim(township_aa.canonical_name), '')
                ) AS "townshipName"
            FROM tourism.place_profiles AS pf
            INNER JOIN core.core_places AS p ON p.id = pf.place_id
            INNER JOIN ref.ref_tourism_types AS tt ON tt.id = pf.tourism_type_id
            LEFT JOIN community.place_rating_summaries AS s ON s.place_id = p.id
            LEFT JOIN core.core_admin_areas AS township_aa
                ON township_aa.id = (${PLACE_TOWNSHIP_RESOLVE_SQL})
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = township_aa.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) = 'en'
                      OR upper(trim(coalesce(n.script_code, ''))) = 'LATN'
                  )
                ORDER BY n.is_primary DESC NULLS LAST, n.id ASC
                LIMIT 1
            ) AS township_en ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = township_aa.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) = 'my'
                      OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
                  )
                ORDER BY n.is_primary DESC NULLS LAST, n.id ASC
                LIMIT 1
            ) AS township_mm ON true
            ${tourismPlaceNameMmLateralSql()}
            ${tourismPlaceNameEnLateralSql()}
            WHERE pf.is_public IS TRUE
              AND p.is_public IS TRUE
              AND p.deleted_at IS NULL
              ${typeFilter}
              ${scopeFilter}
        `;
    }

    /**
     * Recent manual-boost audit rows for one place (exceptional ranking overrides).
     */
    async listRecentManualBoostAudits(
        placeId: bigint,
        limit = 5
    ): Promise<
        Array<{
            createdAt: Date;
            actionType: string;
            manualBoost: number | null;
            reason: string | null;
        }>
    > {
        const rows = await this.prisma.auditLog.findMany({
            where: {
                entityType: TOURISM_PROFILE_AUDIT_ENTITY_TYPE,
                entityId: placeId,
                actionType: {
                    in: [
                        "tourism_place_profile_manual_boost_set",
                        "tourism_place_profile_manual_boost_updated",
                    ],
                },
            },
            orderBy: { createdAt: "desc" },
            take: Math.min(Math.max(limit, 1), 20),
            select: {
                createdAt: true,
                actionType: true,
                afterSnapshot: true,
            },
        });

        return rows.map((row) => {
            const after =
                row.afterSnapshot && typeof row.afterSnapshot === "object"
                    ? (row.afterSnapshot as Record<string, unknown>)
                    : null;
            const boostRaw = after?.manual_boost;
            const reasonRaw = after?.manual_boost_reason;
            return {
                createdAt: row.createdAt,
                actionType: row.actionType,
                manualBoost:
                    typeof boostRaw === "number" && Number.isFinite(boostRaw)
                        ? boostRaw
                        : null,
                reason:
                    typeof reasonRaw === "string" && reasonRaw.trim()
                        ? reasonRaw.trim()
                        : null,
            };
        });
    }

    /**
     * Query-time tourism curation candidates.
     * Excludes places with profiles and curator-ignored places.
     */
    async listTourismCandidates(input: {
        regionAdminAreaId?: bigint | null;
        townshipAdminAreaId?: bigint | null;
        categoryCode?: string | null;
        q?: string | null;
        limit: number;
        offset: number;
    }): Promise<{ rows: TourismCandidateRow[]; total: number }> {
        const filters = tourismCandidateFilterSql(input);
        const totalRows = await this.prisma.$queryRaw<Array<{ total: number }>>`
            SELECT COUNT(*)::int AS total
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS c ON c.id = p.category_id
            ${tourismPlaceNameMmLateralSql()}
            ${tourismPlaceNameEnLateralSql()}
            WHERE ${tourismCandidateEligibilitySql()}
              ${filters}
        `;

        const rows = await this.prisma.$queryRaw<TourismCandidateRow[]>`
            SELECT
                p.id AS "placeId",
                p.public_id::text AS "publicId",
                p.display_name AS "displayName",
                p.primary_name AS "primaryName",
                name_mm.name AS "nameMm",
                name_en.name AS "nameEn",
                p.lat,
                p.lng,
                p.importance_score::float8 AS "importanceScore",
                p.is_verified AS "isVerified",
                p.is_public AS "isPublic",
                c.code AS "categoryCode",
                c.name AS "categoryName",
                c.name_mm AS "categoryNameMm",
                (${PLACE_TOWNSHIP_RESOLVE_SQL}) AS "townshipAdminAreaId",
                COALESCE(
                    NULLIF(trim(township_en.name), ''),
                    NULLIF(trim(township_mm.name), ''),
                    NULLIF(trim(township_aa.canonical_name), '')
                ) AS "townshipName",
                COALESCE(
                    NULLIF(trim(region_en.name), ''),
                    NULLIF(trim(region_mm.name), ''),
                    NULLIF(trim(region_aa.canonical_name), '')
                ) AS "regionName",
                NULLIF(btrim(COALESCE(
                    p.normalized_data #>> '{source_tags,tourism}',
                    p.normalized_data #>> '{tags,tourism}'
                )), '') AS "osmTourism",
                NULLIF(btrim(COALESCE(
                    p.normalized_data #>> '{source_tags,historic}',
                    p.normalized_data #>> '{tags,historic}'
                )), '') AS "osmHistoric",
                NULLIF(btrim(COALESCE(
                    p.normalized_data #>> '{source_tags,leisure}',
                    p.normalized_data #>> '{tags,leisure}'
                )), '') AS "osmLeisure",
                NULLIF(btrim(COALESCE(
                    p.normalized_data #>> '{source_tags,natural}',
                    p.normalized_data #>> '{tags,natural}'
                )), '') AS "osmNatural"
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS c ON c.id = p.category_id
            ${tourismPlaceNameMmLateralSql()}
            ${tourismPlaceNameEnLateralSql()}
            LEFT JOIN LATERAL (
                SELECT (${PLACE_TOWNSHIP_RESOLVE_SQL}) AS township_id
            ) AS township_link ON true
            LEFT JOIN core.core_admin_areas AS township_aa
                ON township_aa.id = township_link.township_id
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = township_aa.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) IN ('en', 'eng')
                      OR upper(trim(coalesce(n.script_code, ''))) = 'LATN'
                  )
                ORDER BY n.is_primary DESC NULLS LAST, n.id ASC
                LIMIT 1
            ) AS township_en ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = township_aa.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) = 'my'
                      OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
                  )
                ORDER BY n.is_primary DESC NULLS LAST, n.id ASC
                LIMIT 1
            ) AS township_mm ON true
            LEFT JOIN LATERAL (
                SELECT (${PLACE_REGION_RESOLVE_FROM_START_SQL}) AS region_id
                FROM (SELECT township_link.township_id AS start_admin_area_id) AS start_point
                WHERE start_admin_area_id IS NOT NULL
            ) AS region_link ON true
            LEFT JOIN core.core_admin_areas AS region_aa ON region_aa.id = region_link.region_id
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = region_aa.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) IN ('en', 'eng')
                      OR upper(trim(coalesce(n.script_code, ''))) = 'LATN'
                  )
                ORDER BY n.is_primary DESC NULLS LAST, n.id ASC
                LIMIT 1
            ) AS region_en ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = region_aa.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) = 'my'
                      OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
                  )
                ORDER BY n.is_primary DESC NULLS LAST, n.id ASC
                LIMIT 1
            ) AS region_mm ON true
            WHERE ${tourismCandidateEligibilitySql()}
              ${filters}
            ORDER BY
                COALESCE(p.importance_score, 0) DESC,
                p.is_verified DESC,
                p.id ASC
            LIMIT ${input.limit}
            OFFSET ${input.offset}
        `;

        return { rows, total: totalRows[0]?.total ?? 0 };
    }

    /**
     * Township-scoped place search for Tourism admin pickers.
     * Includes places that already have tourism.place_profiles (caller may block them).
     */
    async searchPlacesForPicker(input: {
        townshipAdminAreaId: bigint;
        q: string;
        limit: number;
    }): Promise<{
        rows: TourismPlaceSearchRow[];
        townshipName: string | null;
        regionName: string | null;
    }> {
        const areaRows = await this.prisma.$queryRaw<
            Array<{ townshipName: string | null; regionName: string | null }>
        >`
            WITH start_point AS (
                SELECT ${input.townshipAdminAreaId}::bigint AS start_admin_area_id
            )
            SELECT
                COALESCE(
                    NULLIF(trim(township_en.name), ''),
                    NULLIF(trim(township_mm.name), ''),
                    NULLIF(trim(aa.canonical_name), '')
                ) AS "townshipName",
                COALESCE(
                    NULLIF(trim(region_en.name), ''),
                    NULLIF(trim(region_mm.name), ''),
                    NULLIF(trim(region_aa.canonical_name), '')
                ) AS "regionName"
            FROM core.core_admin_areas AS aa
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = aa.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) IN ('en', 'eng')
                      OR upper(trim(coalesce(n.script_code, ''))) = 'LATN'
                  )
                ORDER BY n.is_primary DESC NULLS LAST, n.id ASC
                LIMIT 1
            ) AS township_en ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = aa.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) = 'my'
                      OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
                  )
                ORDER BY n.is_primary DESC NULLS LAST, n.id ASC
                LIMIT 1
            ) AS township_mm ON true
            LEFT JOIN LATERAL (
                SELECT (${PLACE_REGION_RESOLVE_FROM_START_SQL}) AS region_id
                FROM start_point
                WHERE start_admin_area_id IS NOT NULL
            ) AS region_link ON true
            LEFT JOIN core.core_admin_areas AS region_aa ON region_aa.id = region_link.region_id
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = region_aa.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) IN ('en', 'eng')
                      OR upper(trim(coalesce(n.script_code, ''))) = 'LATN'
                  )
                ORDER BY n.is_primary DESC NULLS LAST, n.id ASC
                LIMIT 1
            ) AS region_en ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = region_aa.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) = 'my'
                      OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
                  )
                ORDER BY n.is_primary DESC NULLS LAST, n.id ASC
                LIMIT 1
            ) AS region_mm ON true
            WHERE aa.id = ${input.townshipAdminAreaId}
            LIMIT 1
        `;

        const pattern = `%${input.q}%`;
        const prefixPattern = `${input.q}%`;
        const rows = await this.prisma.$queryRaw<TourismPlaceSearchRow[]>`
            SELECT
                p.public_id::text AS "publicId",
                p.display_name AS "displayName",
                p.primary_name AS "primaryName",
                c.code AS "categoryCode",
                c.name AS "categoryName",
                EXISTS (
                    SELECT 1
                    FROM tourism.place_profiles AS pf
                    WHERE pf.place_id = p.id
                ) AS "hasTourismProfile",
                p.is_verified AS "isVerified"
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS c ON c.id = p.category_id
            WHERE p.deleted_at IS NULL
              AND p.is_public IS TRUE
              AND (${PLACE_TOWNSHIP_RESOLVE_SQL}) = ${input.townshipAdminAreaId}
              AND (
                  COALESCE(p.display_name, '') ILIKE ${pattern}
                  OR COALESCE(p.primary_name, '') ILIKE ${pattern}
              )
            ORDER BY
                CASE
                    WHEN lower(COALESCE(p.display_name, p.primary_name, '')) = lower(${input.q})
                        THEN 0
                    WHEN lower(COALESCE(p.display_name, p.primary_name, '')) LIKE lower(${prefixPattern})
                        THEN 1
                    ELSE 2
                END,
                COALESCE(p.importance_score, 0) DESC,
                p.is_verified DESC,
                p.id ASC
            LIMIT ${input.limit}
        `;

        return {
            rows,
            townshipName: areaRows[0]?.townshipName ?? null,
            regionName: areaRows[0]?.regionName ?? null,
        };
    }

    async ignoreTourismCandidate(input: {
        placeId: bigint;
        actorUserId: bigint;
        reason: string | null;
        audit: AuditContext;
    }): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`
                INSERT INTO tourism.place_candidate_ignores (place_id, ignored_by, reason, created_at)
                VALUES (${input.placeId}, ${input.actorUserId}, ${input.reason}, now())
                ON CONFLICT (place_id) DO UPDATE
                SET ignored_by = EXCLUDED.ignored_by,
                    reason = EXCLUDED.reason,
                    created_at = now()
            `;
            await tx.auditLog.create({
                data: {
                    actorUserId: input.actorUserId,
                    actionType: "tourism_place_candidate_ignored",
                    entityType: TOURISM_PROFILE_AUDIT_ENTITY_TYPE,
                    entityId: input.placeId,
                    beforeSnapshot: Prisma.JsonNull,
                    afterSnapshot: {
                        ignored: true,
                        reason: input.reason,
                    },
                    ipAddress: input.audit.ipAddress ?? null,
                    userAgent: input.audit.userAgent ?? null,
                },
            });
        });
    }

    async listTourismCandidateOverview(input: {
        regionAdminAreaId?: bigint | null;
        limit: number;
        offset: number;
    }): Promise<{ rows: TourismCandidateOverviewRow[]; total: number }> {
        const regionFilter =
            input.regionAdminAreaId == null
                ? Prisma.empty
                : Prisma.sql`AND region_id = ${input.regionAdminAreaId}`;

        const totalRows = await this.prisma.$queryRaw<Array<{ total: number }>>`
            WITH scored AS (
                ${tourismCandidateOverviewBaseCteSql()}
            )
            SELECT COUNT(*)::int AS total
            FROM scored
            WHERE TRUE
              ${regionFilter}
        `;

        const rows = await this.prisma.$queryRaw<TourismCandidateOverviewRow[]>`
            WITH scored AS (
                ${tourismCandidateOverviewBaseCteSql()}
            )
            SELECT
                township_admin_area_id AS "townshipAdminAreaId",
                township_name AS "townshipName",
                region_admin_area_id AS "regionAdminAreaId",
                candidate_count AS "candidateCount",
                approved_profile_count AS "approvedProfileCount",
                active_public_profile_count AS "activePublicProfileCount",
                verified_profile_count AS "verifiedProfileCount"
            FROM scored
            WHERE TRUE
              ${regionFilter}
            ORDER BY candidate_count DESC, approved_profile_count DESC, township_admin_area_id ASC
            LIMIT ${input.limit}
            OFFSET ${input.offset}
        `;

        return { rows, total: totalRows[0]?.total ?? 0 };
    }
}

export type TourismRankingConfigRow = {
    id: bigint;
    scopeType: TourismGeoRankingScope;
    algorithmVersion: string;
    editorialWeight: number;
    importanceWeight: number;
    reviewWeight: number;
    popularityWeight: number;
    effectiveFrom: Date;
    isActive: boolean;
};

export type TourismGeoRankingCandidateRow = {
    placeId: bigint;
    publicId: string;
    displayName: string | null;
    primaryName: string | null;
    nameMm: string | null;
    nameEn: string | null;
    lat: number;
    lng: number;
    importanceScore: number | null;
    isVerified: boolean;
    tourismType: string;
    tourismTypeNameEn: string;
    tourismTypeNameMm: string | null;
    shortDescription: string | null;
    priceLevel: number | null;
    editorPick: boolean;
    editorialScore: number;
    manualBoost: number;
    seasonMode: TourismSeasonMode;
    seasonStartMonth: number | null;
    seasonEndMonth: number | null;
    publishedReviewCount: number;
    averageRating: number | null;
    townshipName: string | null;
};

export type TourismCandidateRow = {
    placeId: bigint;
    publicId: string;
    displayName: string | null;
    primaryName: string | null;
    nameMm: string | null;
    nameEn: string | null;
    lat: number;
    lng: number;
    importanceScore: number | null;
    isVerified: boolean;
    isPublic: boolean;
    categoryCode: string | null;
    categoryName: string | null;
    categoryNameMm: string | null;
    townshipAdminAreaId: bigint | null;
    townshipName: string | null;
    regionName: string | null;
    osmTourism: string | null;
    osmHistoric: string | null;
    osmLeisure: string | null;
    osmNatural: string | null;
};

/** Admin picker row — includes places that already have tourism profiles. */
export type TourismPlaceSearchRow = {
    publicId: string;
    displayName: string | null;
    primaryName: string | null;
    categoryCode: string | null;
    categoryName: string | null;
    hasTourismProfile: boolean;
    isVerified: boolean;
};

export type TourismCandidateOverviewRow = {
    townshipAdminAreaId: bigint;
    townshipName: string;
    regionAdminAreaId: bigint | null;
    candidateCount: number;
    approvedProfileCount: number;
    activePublicProfileCount: number;
    verifiedProfileCount: number;
};

/** Same name-resolution priority as public-map place detail (Myanmar). */
function tourismPlaceNameMmLateralSql() {
    return Prisma.sql`
        LEFT JOIN LATERAL (
            SELECT pn.name
            FROM core.core_place_names AS pn
            WHERE pn.place_id = p.id
              AND (
                  pn.language_code = 'my'
                  OR upper(trim(coalesce(pn.script_code, ''))) = 'MYMR'
              )
            ORDER BY
                CASE
                    WHEN pn.name_type = 'official' AND pn.is_primary = true THEN 1
                    WHEN pn.is_primary = true THEN 2
                    WHEN pn.name_type = 'official' THEN 3
                    ELSE 4
                END,
                pn.search_weight DESC NULLS LAST,
                pn.name ASC
            LIMIT 1
        ) AS name_mm ON true
    `;
}

/** Same name-resolution priority as public-map place detail (English). */
function tourismPlaceNameEnLateralSql() {
    return Prisma.sql`
        LEFT JOIN LATERAL (
            SELECT pn.name
            FROM core.core_place_names AS pn
            WHERE pn.place_id = p.id
              AND (
                  pn.language_code = 'en'
                  OR upper(trim(coalesce(pn.script_code, ''))) = 'LATN'
              )
            ORDER BY
                CASE
                    WHEN pn.name_type = 'official' AND pn.is_primary = true THEN 1
                    WHEN pn.is_primary = true THEN 2
                    WHEN pn.name_type = 'official' THEN 3
                    ELSE 4
                END,
                pn.search_weight DESC NULLS LAST,
                pn.name ASC
            LIMIT 1
        ) AS name_en ON true
    `;
}

/**
 * Safe address selector: public linked address only.
 * Exposes full_address + postal_code; never internal address/place link ids.
 */
function tourismPlaceAddressSafeLateralSql() {
    return Prisma.sql`
        LEFT JOIN LATERAL (
            SELECT
                a.full_address,
                a.postal_code
            FROM core.core_place_addresses AS pa
            JOIN core.core_addresses AS a ON a.id = pa.address_id
            WHERE pa.place_id = p.id
              AND a.is_public = true
            ORDER BY pa.is_primary DESC, a.id ASC
            LIMIT 1
        ) AS addr ON true
    `;
}

/**
 * Safe contact selector: public contact fields only.
 * Excludes email and internal contact ids.
 */
function tourismPlaceContactSafeLateralSql() {
    return Prisma.sql`
        LEFT JOIN LATERAL (
            SELECT
                ct.phone,
                ct.website,
                ct.facebook_url,
                ct.opening_hours
            FROM core.core_place_contacts AS ct
            WHERE ct.place_id = p.id
            LIMIT 1
        ) AS contact ON true
    `;
}

function tourismRankingOrderOnAlias(mode: TourismRankingMode): Prisma.Sql {
    if (mode === "nearby") {
        return Prisma.sql`
            r."distanceMeters" ASC NULLS LAST,
            r."publicId" ASC
        `;
    }
    if (mode === "most_reviewed") {
        return Prisma.sql`
            r."publishedReviewCount" DESC,
            r."isVerified" DESC,
            r."publicId" ASC
        `;
    }
    // recommended | top_rated | editor_picks
    return Prisma.sql`
        r."bayesianScore" DESC NULLS LAST,
        r."publishedReviewCount" DESC,
        r."isVerified" DESC,
        r."publicId" ASC
    `;
}

/**
 * Keyset pagination predicate against the ranked CTE alias `r`.
 * Rows must sort strictly after the cursor in the mode's ORDER BY.
 */
function tourismRankingCursorWhereOnAlias(
    mode: TourismRankingMode,
    cursor: TourismRankingCursor
): Prisma.Sql {
    if (mode === "nearby") {
        const distance = cursor.distanceMeters ?? 0;
        return Prisma.sql`(
            r."distanceMeters" > ${distance}
            OR (
                r."distanceMeters" = ${distance}
                AND r."publicId" > ${cursor.publicId}
            )
        )`;
    }

    if (mode === "most_reviewed") {
        return Prisma.sql`(
            r."publishedReviewCount" < ${cursor.publishedReviewCount}
            OR (
                r."publishedReviewCount" = ${cursor.publishedReviewCount}
                AND r."isVerified" < ${cursor.isVerified}
            )
            OR (
                r."publishedReviewCount" = ${cursor.publishedReviewCount}
                AND r."isVerified" = ${cursor.isVerified}
                AND r."publicId" > ${cursor.publicId}
            )
        )`;
    }

    // recommended | top_rated | editor_picks
    if (cursor.bayesianScore === null) {
        return Prisma.sql`(
            r."bayesianScore" IS NULL
            AND (
                r."publishedReviewCount" < ${cursor.publishedReviewCount}
                OR (
                    r."publishedReviewCount" = ${cursor.publishedReviewCount}
                    AND r."isVerified" < ${cursor.isVerified}
                )
                OR (
                    r."publishedReviewCount" = ${cursor.publishedReviewCount}
                    AND r."isVerified" = ${cursor.isVerified}
                    AND r."publicId" > ${cursor.publicId}
                )
            )
        )`;
    }

    return Prisma.sql`(
        r."bayesianScore" < ${cursor.bayesianScore}
        OR (
            r."bayesianScore" = ${cursor.bayesianScore}
            AND r."publishedReviewCount" < ${cursor.publishedReviewCount}
        )
        OR (
            r."bayesianScore" = ${cursor.bayesianScore}
            AND r."publishedReviewCount" = ${cursor.publishedReviewCount}
            AND r."isVerified" < ${cursor.isVerified}
        )
        OR (
            r."bayesianScore" = ${cursor.bayesianScore}
            AND r."publishedReviewCount" = ${cursor.publishedReviewCount}
            AND r."isVerified" = ${cursor.isVerified}
            AND r."publicId" > ${cursor.publicId}
        )
    )`;
}

function tourismCandidateSignalSql(): Prisma.Sql {
    const categoryCodes = TOURISM_CANDIDATE_POI_CATEGORY_CODES.map((code) => Prisma.sql`${code}`);
    const osmTourism = TOURISM_CANDIDATE_OSM_TOURISM_TAGS.map((tag) => Prisma.sql`${tag}`);
    const osmLeisure = TOURISM_CANDIDATE_OSM_LEISURE_TAGS.map((tag) => Prisma.sql`${tag}`);
    const osmNatural = TOURISM_CANDIDATE_OSM_NATURAL_TAGS.map((tag) => Prisma.sql`${tag}`);

    return Prisma.sql`(
        lower(btrim(COALESCE(c.code, ''))) IN (${Prisma.join(categoryCodes)})
        OR lower(btrim(COALESCE(
            p.normalized_data #>> '{source_tags,tourism}',
            p.normalized_data #>> '{tags,tourism}',
            ''
        ))) IN (${Prisma.join(osmTourism)})
        OR NULLIF(btrim(COALESCE(
            p.normalized_data #>> '{source_tags,historic}',
            p.normalized_data #>> '{tags,historic}'
        )), '') IS NOT NULL
        OR lower(btrim(COALESCE(
            p.normalized_data #>> '{source_tags,leisure}',
            p.normalized_data #>> '{tags,leisure}',
            ''
        ))) IN (${Prisma.join(osmLeisure)})
        OR lower(btrim(COALESCE(
            p.normalized_data #>> '{source_tags,natural}',
            p.normalized_data #>> '{tags,natural}',
            ''
        ))) IN (${Prisma.join(osmNatural)})
    )`;
}

/** Eligibility predicate — assumes aliases `p` (core_places) and `c` (ref_poi_categories). */
function tourismCandidateEligibilitySql(): Prisma.Sql {
    return Prisma.sql`
        p.is_public IS TRUE
        AND p.deleted_at IS NULL
        AND NOT EXISTS (
            SELECT 1 FROM tourism.place_profiles AS pf WHERE pf.place_id = p.id
        )
        AND NOT EXISTS (
            SELECT 1 FROM tourism.place_candidate_ignores AS ign WHERE ign.place_id = p.id
        )
        AND ${tourismCandidateSignalSql()}
    `;
}

function tourismCandidateFilterSql(input: {
    regionAdminAreaId?: bigint | null;
    townshipAdminAreaId?: bigint | null;
    categoryCode?: string | null;
    q?: string | null;
}): Prisma.Sql {
    const parts: Prisma.Sql[] = [];

    if (input.townshipAdminAreaId != null) {
        parts.push(Prisma.sql`
            AND (${PLACE_TOWNSHIP_RESOLVE_SQL}) = ${input.townshipAdminAreaId}
        `);
    }

    if (input.regionAdminAreaId != null) {
        parts.push(Prisma.sql`
            AND (
                WITH start_point AS (
                    SELECT COALESCE(
                        (${PLACE_TOWNSHIP_RESOLVE_SQL}),
                        p.admin_area_id
                    ) AS start_admin_area_id
                )
                SELECT (${PLACE_REGION_RESOLVE_FROM_START_SQL})
                FROM start_point
                WHERE start_admin_area_id IS NOT NULL
            ) = ${input.regionAdminAreaId}
        `);
    }

    if (input.categoryCode) {
        parts.push(Prisma.sql`AND lower(btrim(c.code)) = lower(btrim(${input.categoryCode}))`);
    }

    if (input.q) {
        const pattern = `%${input.q}%`;
        parts.push(Prisma.sql`
            AND (
                COALESCE(p.display_name, '') ILIKE ${pattern}
                OR COALESCE(p.primary_name, '') ILIKE ${pattern}
                OR COALESCE(name_mm.name, '') ILIKE ${pattern}
                OR COALESCE(name_en.name, '') ILIKE ${pattern}
            )
        `);
    }

    if (parts.length === 0) return Prisma.empty;
    return Prisma.join(parts, " ");
}

/**
 * Per-township coverage stats.
 * region_id is resolved from township for optional region filtering.
 */
function tourismCandidateOverviewBaseCteSql(): Prisma.Sql {
    return Prisma.sql`
        SELECT
            township_id AS township_admin_area_id,
            COALESCE(
                NULLIF(trim(township_en.name), ''),
                NULLIF(trim(township_mm.name), ''),
                NULLIF(trim(aa.canonical_name), ''),
                township_id::text
            ) AS township_name,
            (
                WITH start_point AS (
                    SELECT township_id AS start_admin_area_id
                )
                SELECT (${PLACE_REGION_RESOLVE_FROM_START_SQL})
                FROM start_point
                WHERE start_admin_area_id IS NOT NULL
            ) AS region_admin_area_id,
            (
                WITH start_point AS (
                    SELECT township_id AS start_admin_area_id
                )
                SELECT (${PLACE_REGION_RESOLVE_FROM_START_SQL})
                FROM start_point
                WHERE start_admin_area_id IS NOT NULL
            ) AS region_id,
            COUNT(*) FILTER (
                WHERE NOT has_profile AND NOT is_ignored AND is_candidate_signal
            )::int AS candidate_count,
            COUNT(*) FILTER (WHERE has_profile)::int AS approved_profile_count,
            COUNT(*) FILTER (
                WHERE has_profile AND profile_is_public IS TRUE
            )::int AS active_public_profile_count,
            COUNT(*) FILTER (
                WHERE has_profile AND place_is_verified IS TRUE
            )::int AS verified_profile_count
        FROM (
            SELECT
                p.id,
                p.is_verified AS place_is_verified,
                (${PLACE_TOWNSHIP_RESOLVE_SQL}) AS township_id,
                EXISTS (
                    SELECT 1 FROM tourism.place_profiles AS pf WHERE pf.place_id = p.id
                ) AS has_profile,
                EXISTS (
                    SELECT 1 FROM tourism.place_candidate_ignores AS ign WHERE ign.place_id = p.id
                ) AS is_ignored,
                COALESCE(
                    (
                        SELECT pf.is_public
                        FROM tourism.place_profiles AS pf
                        WHERE pf.place_id = p.id
                        LIMIT 1
                    ),
                    false
                ) AS profile_is_public,
                ${tourismCandidateSignalSql()} AS is_candidate_signal
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS c ON c.id = p.category_id
            WHERE p.deleted_at IS NULL
              AND p.is_public IS TRUE
        ) AS place_rows
        INNER JOIN core.core_admin_areas AS aa ON aa.id = place_rows.township_id
        LEFT JOIN LATERAL (
            SELECT n.name
            FROM core.core_admin_area_names AS n
            WHERE n.admin_area_id = aa.id
              AND (
                  lower(trim(coalesce(n.language_code, ''))) = 'en'
                  OR upper(trim(coalesce(n.script_code, ''))) = 'LATN'
              )
            ORDER BY n.is_primary DESC NULLS LAST, n.id ASC
            LIMIT 1
        ) AS township_en ON true
        LEFT JOIN LATERAL (
            SELECT n.name
            FROM core.core_admin_area_names AS n
            WHERE n.admin_area_id = aa.id
              AND (
                  lower(trim(coalesce(n.language_code, ''))) = 'my'
                  OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
              )
            ORDER BY n.is_primary DESC NULLS LAST, n.id ASC
            LIMIT 1
        ) AS township_mm ON true
        WHERE place_rows.township_id IS NOT NULL
          AND (
              has_profile
              OR (NOT is_ignored AND is_candidate_signal)
          )
        GROUP BY
            township_id,
            aa.canonical_name,
            township_en.name,
            township_mm.name
    `;
}
