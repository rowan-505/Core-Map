import type {
    TourismModerationEventRow,
    TourismPlaceCoreRow,
    TourismPlaceProfileDetailRow,
    TourismPlaceProfileRow,
    TourismRankedPlaceRow,
    TourismRatingSummaryRow,
    TourismReviewRow,
    TourismReviewsRepository,
    TourismGlobalRatingStats,
    TourismTypeRow,
} from "./tourism.repo.js";
import type { TourismReviewStatus, TourismSeasonMode } from "./tourism.types.js";
import type { TourismRankingCursor, TourismReviewCursor } from "./tourism.schema.js";
import {
    compareTourismRankSortKeys,
    computeTourismBayesianScore,
    TOURISM_TOP_RATED_MIN_REVIEWS,
    type TourismRankingMode,
} from "./tourism.ranking.js";

export const TOURISM_TEST_PLACE_PUBLIC = "11111111-1111-4111-8111-111111111111";
export const TOURISM_TEST_USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const TOURISM_TEST_USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const TOURISM_TEST_ADMIN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const TOURISM_TEST_REVIEW_PUBLIC = "22222222-2222-4222-8222-222222222222";

export function tourismTestReviewRow(
    overrides: Partial<TourismReviewRow> = {}
): TourismReviewRow {
    return {
        id: 1n,
        publicId: TOURISM_TEST_REVIEW_PUBLIC,
        placeId: 100n,
        placePublicId: TOURISM_TEST_PLACE_PUBLIC,
        userId: 10n,
        authorPublicId: TOURISM_TEST_USER_A,
        authorDisplayName: "Author A",
        rating: 5,
        title: "Great",
        body: "Nice place",
        status: "pending",
        moderationNote: null,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        publishedAt: null,
        ...overrides,
    };
}

export function tourismTestPlaceCore(
    overrides: Partial<TourismPlaceCoreRow> = {}
): TourismPlaceCoreRow {
    return {
        placeId: 100n,
        publicId: TOURISM_TEST_PLACE_PUBLIC,
        primaryName: "Shwedagon",
        displayName: "ရွှေတိဂုံ",
        nameMm: "ရွှေတိဂုံ",
        nameEn: "Shwedagon Pagoda",
        lat: 16.7982,
        lng: 96.1498,
        categoryCode: "pagoda",
        categoryName: "Pagoda",
        placeIsPublic: true,
        placeDeletedAt: null,
        isVerified: true,
        importanceScore: 75,
        ...overrides,
    };
}

/** Approximate meters between two WGS84 points (fake ranking only). */
export function tourismTestDistanceMeters(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

export function tourismTestProfileRow(
    overrides: Partial<TourismPlaceProfileRow> = {}
): TourismPlaceProfileRow {
    return {
        placeId: 100n,
        tourismTypeId: 1n,
        tourismType: "attraction",
        tourismTypeNameEn: "Attraction",
        tourismTypeNameMm: "ဆွဲဆောင်မှု",
        shortDescription: "Famous pagoda",
        priceLevel: 1,
        editorPick: false,
        isPublic: true,
        editorialScore: 50,
        manualBoost: 0,
        seasonMode: "all_year",
        seasonStartMonth: null,
        seasonEndMonth: null,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        ...overrides,
    };
}

export class FakeTourismReviewsRepository implements Partial<TourismReviewsRepository> {
    users = new Map<string, { id: bigint; active: boolean; displayName: string }>([
        [TOURISM_TEST_USER_A, { id: 10n, active: true, displayName: "Author A" }],
        [TOURISM_TEST_USER_B, { id: 20n, active: true, displayName: "Author B" }],
        [TOURISM_TEST_ADMIN, { id: 40n, active: true, displayName: "Admin" }],
        ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", { id: 30n, active: false, displayName: "Inactive" }],
    ]);
    places = new Map<string, bigint>([[TOURISM_TEST_PLACE_PUBLIC, 100n]]);
    placeCores = new Map<string, TourismPlaceCoreRow>([
        [TOURISM_TEST_PLACE_PUBLIC, tourismTestPlaceCore()],
    ]);
    profiles = new Map<bigint, TourismPlaceProfileRow>();
    tourismTypes = new Map<string, TourismTypeRow & { id: bigint }>([
        ["attraction", { id: 1n, code: "attraction", nameEn: "Attraction", nameMm: "ဆွဲဆောင်မှု", sortOrder: 10 }],
        ["museum", { id: 2n, code: "museum", nameEn: "Museum", nameMm: "ပြတိုက်", sortOrder: 20 }],
        ["market", { id: 3n, code: "market", nameEn: "Market", nameMm: "ဈေး", sortOrder: 30 }],
    ]);
    reviews = new Map<string, TourismReviewRow>();
    activeByPlaceUser = new Map<string, string>();
    moderationEvents: Array<{
        reviewId: bigint;
        actorUserId: bigint | null;
        fromStatus: string;
        toStatus: string;
        note: string | null;
        createdAt: Date;
    }> = [];
    auditEvents: Array<{ actionType: string; entityId: bigint }> = [];
    refreshCalls: bigint[] = [];
    summaries = new Map<bigint, TourismRatingSummaryRow>();
    nextId = 1n;

    private key(placeId: bigint, userId: bigint) {
        return `${placeId}:${userId}`;
    }

    private authorPublicIdFor(userId: bigint): string {
        for (const [publicId, user] of this.users) {
            if (user.id === userId) return publicId;
        }
        return TOURISM_TEST_USER_A;
    }

    private displayNameFor(userId: bigint): string {
        for (const user of this.users.values()) {
            if (user.id === userId) return user.displayName;
        }
        return "Author";
    }

    private toDetail(
        place: TourismPlaceCoreRow,
        profile: TourismPlaceProfileRow
    ): TourismPlaceProfileDetailRow {
        const summary = this.summaries.get(place.placeId);
        return {
            ...place,
            ...profile,
            address: {
                fullAddress: "Pagoda Road, Yangon",
                postalCode: "11181",
            },
            contact: {
                phone: "+95-1-000000",
                website: "https://example.com",
                facebookUrl: null,
                openingHours: "06:00-20:00",
            },
            publishedReviewCount: summary?.publishedReviewCount ?? 0,
            averageRating: summary?.averageRating ?? null,
        };
    }

    async findUsableUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const user = this.users.get(publicId);
        if (!user || !user.active) return null;
        return user.id;
    }

    async findUserIdByPublicId(publicId: string): Promise<bigint | null> {
        return this.users.get(publicId)?.id ?? null;
    }

    async findActivePlaceIdByPublicId(publicId: string): Promise<bigint | null> {
        const core = this.placeCores.get(publicId);
        if (!core || core.placeDeletedAt) return null;
        return core.placeId;
    }

    async findPlaceCoreByPublicId(publicId: string): Promise<TourismPlaceCoreRow | null> {
        return this.placeCores.get(publicId) ?? null;
    }

    async findProfileByPlaceId(placeId: bigint): Promise<TourismPlaceProfileRow | null> {
        return this.profiles.get(placeId) ?? null;
    }

    async findTourismTypeIdByCode(code: string): Promise<bigint | null> {
        return this.tourismTypes.get(code)?.id ?? null;
    }

    async listTourismTypes(): Promise<TourismTypeRow[]> {
        return [...this.tourismTypes.values()]
            .sort((a, b) => a.sortOrder - b.sortOrder || Number(a.id - b.id))
            .map(({ code, nameEn, nameMm, sortOrder }) => ({ code, nameEn, nameMm, sortOrder }));
    }

    async findPublicTourismPlaceByPublicId(
        publicId: string
    ): Promise<TourismPlaceProfileDetailRow | null> {
        const place = this.placeCores.get(publicId);
        if (!place || place.placeDeletedAt || !place.placeIsPublic) return null;
        const profile = this.profiles.get(place.placeId);
        if (!profile || !profile.isPublic) return null;
        return this.toDetail(place, profile);
    }

    async findAdminTourismPlaceByPublicId(
        publicId: string
    ): Promise<TourismPlaceProfileDetailRow | null> {
        const place = this.placeCores.get(publicId);
        if (!place) return null;
        const profile = this.profiles.get(place.placeId);
        if (!profile) return null;
        return this.toDetail(place, profile);
    }

    async listRecentManualBoostAudits(): Promise<
        Array<{
            createdAt: Date;
            actionType: string;
            manualBoost: number | null;
            reason: string | null;
        }>
    > {
        return [];
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
        manualBoostReason?: string | null;
        audit?: unknown;
    }): Promise<TourismPlaceProfileRow> {
        if (this.profiles.has(input.placeId)) {
            throw new Error("duplicate key value violates unique constraint");
        }
        const row = tourismTestProfileRow({
            placeId: input.placeId,
            tourismTypeId: input.tourismTypeId,
            tourismType: input.tourismType,
            tourismTypeNameEn: this.tourismTypes.get(input.tourismType)?.nameEn ?? input.tourismType,
            tourismTypeNameMm: this.tourismTypes.get(input.tourismType)?.nameMm ?? null,
            shortDescription: input.shortDescription,
            priceLevel: input.priceLevel,
            editorPick: input.editorPick,
            isPublic: input.isPublic,
            editorialScore: input.editorialScore,
            manualBoost: input.manualBoost,
            seasonMode: input.seasonMode,
            seasonStartMonth: input.seasonStartMonth,
            seasonEndMonth: input.seasonEndMonth,
        });
        this.profiles.set(input.placeId, row);
        this.auditEvents.push({
            actionType:
                input.manualBoost !== 0
                    ? "tourism_place_profile_manual_boost_set"
                    : "tourism_place_profile_created",
            entityId: input.placeId,
        });
        return structuredClone(row);
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
        audit?: unknown;
    }): Promise<TourismPlaceProfileRow> {
        const next = {
            ...input.before,
            tourismTypeId: input.tourismTypeId,
            tourismType: input.tourismType,
            tourismTypeNameEn: this.tourismTypes.get(input.tourismType)?.nameEn ?? input.tourismType,
            tourismTypeNameMm: this.tourismTypes.get(input.tourismType)?.nameMm ?? null,
            shortDescription: input.shortDescription,
            priceLevel: input.priceLevel,
            editorPick: input.editorPick,
            isPublic: input.isPublic,
            editorialScore: input.editorialScore,
            manualBoost: input.manualBoost,
            seasonMode: input.seasonMode,
            seasonStartMonth: input.seasonStartMonth,
            seasonEndMonth: input.seasonEndMonth,
            updatedAt: new Date("2026-09-05T00:00:00.000Z"),
        };
        this.profiles.set(input.placeId, next);
        this.auditEvents.push({
            actionType:
                input.before.manualBoost !== input.manualBoost
                    ? "tourism_place_profile_manual_boost_updated"
                    : "tourism_place_profile_updated",
            entityId: input.placeId,
        });
        return structuredClone(next);
    }

    async getGlobalPublishedRatingStats(): Promise<TourismGlobalRatingStats> {
        const published = [...this.reviews.values()].filter((row) => row.status === "published");
        if (published.length === 0) {
            return { publishedReviewCount: 0, averageRating: null };
        }
        const averageRating =
            published.reduce((sum, row) => sum + row.rating, 0) / published.length;
        return {
            publishedReviewCount: published.length,
            averageRating,
        };
    }

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
        const global = await this.getGlobalPublishedRatingStats();
        const rows: TourismRankedPlaceRow[] = [];

        for (const place of this.placeCores.values()) {
            if (place.placeDeletedAt || !place.placeIsPublic) continue;
            const profile = this.profiles.get(place.placeId);
            if (!profile || !profile.isPublic) continue;
            if (input.tourismType && profile.tourismType !== input.tourismType) continue;
            if (input.mode === "editor_picks" && !profile.editorPick) continue;

            const summary = this.summaries.get(place.placeId);
            const publishedReviewCount = summary?.publishedReviewCount ?? 0;
            const averageRating =
                summary?.averageRating === null || summary?.averageRating === undefined
                    ? null
                    : Number(summary.averageRating);

            if (
                input.mode === "top_rated" &&
                publishedReviewCount < TOURISM_TOP_RATED_MIN_REVIEWS
            ) {
                continue;
            }

            if (input.bbox && place.lat !== null && place.lng !== null) {
                const [minLng, minLat, maxLng, maxLat] = input.bbox;
                if (
                    place.lng < minLng ||
                    place.lng > maxLng ||
                    place.lat < minLat ||
                    place.lat > maxLat
                ) {
                    continue;
                }
            }

            let distanceMeters: number | null = null;
            if (input.lat !== undefined && input.lng !== undefined && place.lat !== null && place.lng !== null) {
                distanceMeters = tourismTestDistanceMeters(
                    input.lat,
                    input.lng,
                    place.lat,
                    place.lng
                );
                if (
                    input.mode === "nearby" &&
                    input.radiusMeters !== undefined &&
                    distanceMeters > input.radiusMeters
                ) {
                    continue;
                }
            }

            const bayesianScore = computeTourismBayesianScore({
                placeAverageRating: averageRating,
                publishedReviewCount,
                globalAverageRating: global.averageRating,
                globalPublishedReviewCount: global.publishedReviewCount,
            });

            rows.push({
                placeId: place.placeId,
                publicId: place.publicId,
                primaryName: place.primaryName,
                displayName: place.displayName,
                nameMm: place.nameMm,
                nameEn: place.nameEn,
                lat: place.lat,
                lng: place.lng,
                isVerified: place.isVerified,
                tourismType: profile.tourismType,
                tourismTypeNameEn: profile.tourismTypeNameEn,
                tourismTypeNameMm: profile.tourismTypeNameMm,
                shortDescription: profile.shortDescription,
                priceLevel: profile.priceLevel,
                editorPick: profile.editorPick,
                publishedReviewCount,
                averageRating:
                    averageRating === null ? null : averageRating.toFixed(2),
                bayesianScore,
                distanceMeters,
            });
        }

        // Allow tests to override isVerified via placeCores.isVerified.
        rows.sort((a, b) =>
            compareTourismRankSortKeys(input.mode, {
                bayesianScore: a.bayesianScore,
                publishedReviewCount: a.publishedReviewCount,
                isVerified: a.isVerified,
                distanceMeters: a.distanceMeters,
                publicId: a.publicId,
            }, {
                bayesianScore: b.bayesianScore,
                publishedReviewCount: b.publishedReviewCount,
                isVerified: b.isVerified,
                distanceMeters: b.distanceMeters,
                publicId: b.publicId,
            })
        );

        let filtered = rows;
        if (input.cursor) {
            filtered = rows.filter((row) => {
                const cmp = compareTourismRankSortKeys(
                    input.mode,
                    {
                        bayesianScore: row.bayesianScore,
                        publishedReviewCount: row.publishedReviewCount,
                        isVerified: row.isVerified,
                        distanceMeters: row.distanceMeters,
                        publicId: row.publicId,
                    },
                    {
                        bayesianScore: input.cursor!.bayesianScore,
                        publishedReviewCount: input.cursor!.publishedReviewCount,
                        isVerified: input.cursor!.isVerified,
                        distanceMeters: input.cursor!.distanceMeters,
                        publicId: input.cursor!.publicId,
                    }
                );
                return cmp > 0;
            });
        }

        return filtered.slice(0, input.limit + 1).map((row) => structuredClone(row));
    }

    async findReviewByPublicId(publicId: string): Promise<TourismReviewRow | null> {
        return this.reviews.get(publicId) ?? null;
    }

    async findActiveReviewByPlaceAndUser(
        placeId: bigint,
        userId: bigint
    ): Promise<TourismReviewRow | null> {
        const publicId = this.activeByPlaceUser.get(this.key(placeId, userId));
        if (!publicId) return null;
        const row = this.reviews.get(publicId);
        if (!row || row.status === "deleted") return null;
        return structuredClone(row);
    }

    async listPublishedReviews(input: {
        placeId: bigint;
        cursor?: TourismReviewCursor;
        limit: number;
    }): Promise<TourismReviewRow[]> {
        let rows = [...this.reviews.values()]
            .filter((row) => row.placeId === input.placeId && row.status === "published")
            .sort((a, b) => {
                const byTime = b.createdAt.getTime() - a.createdAt.getTime();
                if (byTime !== 0) return byTime;
                return b.publicId.localeCompare(a.publicId);
            });

        if (input.cursor) {
            rows = rows.filter((row) => {
                const t = row.createdAt.getTime() - input.cursor!.createdAt.getTime();
                if (t < 0) return true;
                if (t > 0) return false;
                return row.publicId < input.cursor!.publicId;
            });
        }

        return rows.slice(0, input.limit + 1).map((row) => structuredClone(row));
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
        let rows = [...this.reviews.values()].sort((a, b) => {
            const byTime = b.createdAt.getTime() - a.createdAt.getTime();
            if (byTime !== 0) return byTime;
            return b.publicId.localeCompare(a.publicId);
        });

        if (input.status) {
            rows = rows.filter((row) => row.status === input.status);
        }
        if (input.placeId !== undefined) {
            rows = rows.filter((row) => row.placeId === input.placeId);
        }
        if (input.authorUserId !== undefined) {
            rows = rows.filter((row) => row.userId === input.authorUserId);
        }
        if (input.createdFrom) {
            rows = rows.filter((row) => row.createdAt >= input.createdFrom!);
        }
        if (input.createdTo) {
            rows = rows.filter((row) => row.createdAt <= input.createdTo!);
        }
        if (input.cursor) {
            rows = rows.filter((row) => {
                const t = row.createdAt.getTime() - input.cursor!.createdAt.getTime();
                if (t < 0) return true;
                if (t > 0) return false;
                return row.publicId < input.cursor!.publicId;
            });
        }

        return rows.slice(0, input.limit + 1).map((row) => structuredClone(row));
    }

    async listModerationEvents(reviewId: bigint): Promise<TourismModerationEventRow[]> {
        return this.moderationEvents
            .filter((event) => event.reviewId === reviewId)
            .map((event, index) => ({
                id: BigInt(index + 1),
                reviewId: event.reviewId,
                fromStatus: event.fromStatus as TourismReviewStatus,
                toStatus: event.toStatus as TourismReviewStatus,
                note: event.note,
                createdAt: event.createdAt,
                actorPublicId: event.actorUserId
                    ? this.authorPublicIdFor(event.actorUserId)
                    : null,
                actorDisplayName: event.actorUserId
                    ? this.displayNameFor(event.actorUserId)
                    : null,
            }));
    }

    async createReview(input: {
        placeId: bigint;
        userId: bigint;
        rating: number;
        title: string | null;
        body: string | null;
    }): Promise<TourismReviewRow> {
        if (this.activeByPlaceUser.has(this.key(input.placeId, input.userId))) {
            throw new Error(
                'duplicate key value violates unique constraint "place_reviews_one_active"'
            );
        }
        const id = this.nextId;
        this.nextId += 1n;
        const row = tourismTestReviewRow({
            id,
            publicId: `33333333-3333-4333-8333-${String(id).padStart(12, "0")}`,
            placeId: input.placeId,
            userId: input.userId,
            authorPublicId: this.authorPublicIdFor(input.userId),
            authorDisplayName: this.displayNameFor(input.userId),
            rating: input.rating,
            title: input.title,
            body: input.body,
            status: "pending",
            createdAt: new Date(`2026-09-${String(10 + Number(id)).padStart(2, "0")}T00:00:00.000Z`),
        });
        this.reviews.set(row.publicId, row);
        this.activeByPlaceUser.set(this.key(input.placeId, input.userId), row.publicId);
        this.refreshCalls.push(input.placeId);
        return structuredClone(row);
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
        const existing = [...this.reviews.values()].find((row) => row.id === input.reviewId);
        if (!existing) throw new Error("missing review");
        const next = {
            ...existing,
            rating: input.rating,
            title: input.title,
            body: input.body,
            status: input.nextStatus,
            updatedAt: new Date("2026-09-02T00:00:00.000Z"),
        };
        this.reviews.set(next.publicId, next);
        if (input.fromStatus !== input.nextStatus) {
            this.moderationEvents.push({
                reviewId: input.reviewId,
                actorUserId: input.userId,
                fromStatus: input.fromStatus,
                toStatus: input.nextStatus,
                note: "author_edit",
                createdAt: new Date(),
            });
        }
        this.refreshCalls.push(input.placeId);
        return structuredClone(next);
    }

    async softDeleteOwnReview(input: {
        reviewId: bigint;
        placeId: bigint;
        actorUserId: bigint;
        fromStatus: TourismReviewStatus;
    }): Promise<TourismReviewRow> {
        const existing = [...this.reviews.values()].find((row) => row.id === input.reviewId);
        if (!existing) throw new Error("missing review");
        const next = { ...existing, status: "deleted" as const };
        this.reviews.set(next.publicId, next);
        this.activeByPlaceUser.delete(this.key(input.placeId, existing.userId));
        this.moderationEvents.push({
            reviewId: input.reviewId,
            actorUserId: input.actorUserId,
            fromStatus: input.fromStatus,
            toStatus: "deleted",
            note: null,
            createdAt: new Date(),
        });
        this.refreshCalls.push(input.placeId);
        return structuredClone(next);
    }

    async changeModerationStatus(input: {
        reviewId: bigint;
        placeId: bigint;
        actorUserId: bigint;
        fromStatus: TourismReviewStatus;
        toStatus: Exclude<TourismReviewStatus, "deleted">;
        note: string | null;
    }): Promise<TourismReviewRow> {
        const existing = [...this.reviews.values()].find((row) => row.id === input.reviewId);
        if (!existing) throw new Error("missing review");
        const next = {
            ...existing,
            status: input.toStatus,
            moderationNote: input.note,
            publishedAt:
                input.toStatus === "published"
                    ? (existing.publishedAt ?? new Date("2026-09-03T00:00:00.000Z"))
                    : existing.publishedAt,
        };
        this.reviews.set(next.publicId, next);
        this.moderationEvents.push({
            reviewId: input.reviewId,
            actorUserId: input.actorUserId,
            fromStatus: input.fromStatus,
            toStatus: input.toStatus,
            note: input.note,
            createdAt: new Date(),
        });
        this.refreshCalls.push(input.placeId);
        return structuredClone(next);
    }

    async refreshRatingSummary(placeId: bigint): Promise<TourismRatingSummaryRow> {
        this.refreshCalls.push(placeId);
        const published = [...this.reviews.values()].filter(
            (row) => row.placeId === placeId && row.status === "published"
        );
        const summary: TourismRatingSummaryRow = {
            placeId,
            placePublicId: TOURISM_TEST_PLACE_PUBLIC,
            publishedReviewCount: published.length,
            averageRating:
                published.length === 0
                    ? null
                    : (
                          published.reduce((sum, row) => sum + row.rating, 0) / published.length
                      ).toFixed(2),
            updatedAt: new Date("2026-09-04T00:00:00.000Z"),
        };
        this.summaries.set(placeId, summary);
        return summary;
    }
}
