import type { PrismaClient } from "@prisma/client";

import { PlacePopularityService } from "../place-popularity/place-popularity.service.js";
import type { PlacePopularityContextKind } from "../place-popularity/place-popularity.weights.js";
import { TourismReviewsError } from "./tourism.errors.js";
import {
    computeTourismGeoRankingBreakdown,
    previewTourismGeoRankingScore,
    requireValidTourismRankingWeights,
    roundTourismScoreForDisplay,
    sortTourismGeoRankingRows,
    toTourismGeoRankingBreakdownDto,
    TOURISM_GEO_RANKING_ALGORITHM_VERSION,
    TOURISM_GEO_RANKING_V1_WEIGHTS,
    type TourismGeoRankingBreakdown,
    type TourismGeoRankingInputs,
    type TourismGeoRankingScope,
    type TourismRankingWeights,
    type TourismSeasonMode,
} from "./tourism.geo-ranking.js";
import {
    TourismReviewsRepository,
    type TourismGeoRankingCandidateRow,
    type TourismRankingConfigRow,
} from "./tourism.repo.js";
import { deriveCoalescedDisplayName, trimName } from "../../lib/entity-names/derive-display-name.js";

export type TourismGeoRankingListQuery = {
    scope: TourismGeoRankingScope;
    admin_area_id?: string;
    tourism_type?: string;
    limit?: number;
    offset?: number;
    lang?: "my" | "en";
    reference_month?: number;
    include_breakdown?: boolean;
};

export type TourismGeoRankedPlacePublicDto = {
    rank: number;
    public_id: string;
    name: string;
    name_mm: string | null;
    name_en: string | null;
    lat: number;
    lng: number;
    tourism_type: string;
    tourism_type_name_en: string;
    tourism_type_name_mm: string | null;
    short_description: string | null;
    price_level: number | null;
    editor_pick: boolean;
    average_rating: number | null;
    published_review_count: number;
    season_mode: string;
    township_name: string | null;
};

export type TourismGeoRankedPlaceAdminDto = TourismGeoRankedPlacePublicDto & {
    algorithm_version: string;
    scope: TourismGeoRankingScope;
    editorial_score: number;
    editorial_weight: number;
    editorial_contribution: number;
    importance_score: number;
    importance_weight: number;
    importance_contribution: number;
    review_score: number;
    review_weight: number;
    review_contribution: number;
    popularity_score: number;
    popularity_weight: number;
    popularity_contribution: number;
    season_modifier: number;
    season_start_month: number | null;
    season_end_month: number | null;
    manual_boost: number;
    base_score: number;
    season_adjusted_score: number;
    final_score: number;
};

export type TourismGeoRankingPageDto = {
    scope: TourismGeoRankingScope;
    algorithm_version: string;
    admin_area_id: string | null;
    total: number;
    limit: number;
    offset: number;
    items: Array<TourismGeoRankedPlacePublicDto | TourismGeoRankedPlaceAdminDto>;
};

export type TourismPlaceGeoRanksDto = {
    public_id: string;
    township: { rank: number; total: number; admin_area_id: string } | null;
    region: { rank: number; total: number; admin_area_id: string } | null;
    national: { rank: number; total: number } | null;
};

export type TourismGeoRankingPreviewProposed = {
    editorial_score?: number;
    season_mode?: TourismSeasonMode;
    season_start_month?: number | null;
    season_end_month?: number | null;
    manual_boost?: number;
};

export type TourismGeoRankingPreviewQuery = {
    place_public_id: string;
    scope: TourismGeoRankingScope;
    admin_area_id?: string;
    reference_month?: number;
    proposed?: TourismGeoRankingPreviewProposed;
};

export type TourismGeoRankingPreviewSnapshot = {
    rank: number | null;
    final_score: number | null;
    excluded: boolean;
    algorithm_version: string;
    scope: TourismGeoRankingScope;
    editorial_score: number;
    editorial_weight: number;
    editorial_contribution: number;
    importance_score: number;
    importance_weight: number;
    importance_contribution: number;
    review_score: number;
    review_weight: number;
    review_contribution: number;
    popularity_score: number;
    popularity_weight: number;
    popularity_contribution: number;
    season_modifier: number;
    manual_boost: number;
    base_score: number;
    season_adjusted_score: number;
};

export type TourismGeoRankingPreviewDto = {
    algorithm_version: string;
    scope: TourismGeoRankingScope;
    admin_area_id: string | null;
    place_public_id: string;
    has_changes: boolean;
    current: TourismGeoRankingPreviewSnapshot;
    preview: TourismGeoRankingPreviewSnapshot;
};

type ScoredRow = {
    candidate: TourismGeoRankingCandidateRow;
    finalScore: number;
    importanceScore: number;
    editorialScore: number;
    placeId: bigint;
    breakdown: TourismGeoRankingBreakdown;
};

type ScopeIds = {
    scope: TourismGeoRankingScope;
    townshipAdminAreaId: bigint | null;
    regionAdminAreaId: bigint | null;
    adminAreaId: string | null;
};

function scopeToPopularityContext(scope: TourismGeoRankingScope): PlacePopularityContextKind {
    if (scope === "township") return "tourism_township";
    if (scope === "region") return "tourism_region";
    return "tourism_national";
}

function weightsFromConfig(
    config: TourismRankingConfigRow | null,
    scope: TourismGeoRankingScope
): TourismRankingWeights {
    if (config) {
        return requireValidTourismRankingWeights(
            {
                editorialWeight: Number(config.editorialWeight),
                importanceWeight: Number(config.importanceWeight),
                reviewWeight: Number(config.reviewWeight),
                popularityWeight: Number(config.popularityWeight),
            },
            `tourism.ranking_configs(${scope})`
        );
    }
    return requireValidTourismRankingWeights(
        TOURISM_GEO_RANKING_V1_WEIGHTS[scope],
        `TOURISM_GEO_RANKING_V1_WEIGHTS.${scope}`
    );
}

function hasProposedChanges(proposed: TourismGeoRankingPreviewProposed | undefined): boolean {
    if (!proposed) return false;
    return (
        proposed.editorial_score !== undefined ||
        proposed.season_mode !== undefined ||
        proposed.season_start_month !== undefined ||
        proposed.season_end_month !== undefined ||
        proposed.manual_boost !== undefined
    );
}

/**
 * Geographic Tourism Recommendation Ranking V1.
 * Single server-side implementation for public list, admin list, preview, and breakdown.
 */
export class TourismGeoRankingService {
    constructor(
        private readonly repo: TourismReviewsRepository,
        private readonly popularity: PlacePopularityService
    ) {}

    static create(prisma: PrismaClient): TourismGeoRankingService {
        return new TourismGeoRankingService(
            new TourismReviewsRepository(prisma),
            PlacePopularityService.create(prisma)
        );
    }

    /**
     * Pure single-place score preview — same formula as listRanking breakdown.
     * Does not hit the database.
     */
    previewScore(
        input: TourismGeoRankingInputs,
        scope: TourismGeoRankingScope,
        weights?: TourismRankingWeights
    ): TourismGeoRankingBreakdown {
        return previewTourismGeoRankingScore(
            input,
            scope,
            weights ?? TOURISM_GEO_RANKING_V1_WEIGHTS[scope]
        );
    }

    async listRanking(query: TourismGeoRankingListQuery): Promise<TourismGeoRankingPageDto> {
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
        const offset = Math.max(query.offset ?? 0, 0);
        const includeBreakdown = query.include_breakdown === true;
        const resolved = this.resolveScopeIds(query.scope, query.admin_area_id);
        const scored = await this.scoreScope({
            scope: resolved.scope,
            townshipAdminAreaId: resolved.townshipAdminAreaId,
            regionAdminAreaId: resolved.regionAdminAreaId,
            tourismType: query.tourism_type ?? null,
            referenceMonth: query.reference_month,
        });

        const pageRows = scored.sorted.slice(offset, offset + limit);
        const items = pageRows.map((row, index) =>
            this.toDto(row, offset + index + 1, query.lang, includeBreakdown)
        );

        return {
            scope: resolved.scope,
            algorithm_version: scored.algorithmVersion,
            admin_area_id: resolved.adminAreaId,
            total: scored.sorted.length,
            limit,
            offset,
            items,
        };
    }

    /**
     * Admin ranking preview: overlay proposed editable fields in memory, then
     * re-run the same authoritative scope ranking used by public/admin lists.
     */
    async previewRanking(
        query: TourismGeoRankingPreviewQuery
    ): Promise<TourismGeoRankingPreviewDto> {
        const resolved = this.resolveScopeIds(query.scope, query.admin_area_id);
        const proposed = query.proposed ?? {};
        const scored = await this.scoreScope({
            scope: resolved.scope,
            townshipAdminAreaId: resolved.townshipAdminAreaId,
            regionAdminAreaId: resolved.regionAdminAreaId,
            tourismType: null,
            referenceMonth: query.reference_month,
            overlay: {
                placePublicId: query.place_public_id,
                proposed,
            },
        });

        const target = scored.candidates.find(
            (row) => row.publicId === query.place_public_id
        );
        if (!target) {
            throw new TourismReviewsError(
                "Attraction is not in this ranking scope (or has no public tourism profile)",
                404,
                "PROFILE_NOT_FOUND"
            );
        }

        const currentRow = scored.baselineSorted.find(
            (row) => row.candidate.publicId === query.place_public_id
        );
        const previewRow = scored.sorted.find(
            (row) => row.candidate.publicId === query.place_public_id
        );

        const currentBreakdown =
            currentRow?.breakdown ??
            scored.baselineExcluded.get(query.place_public_id) ??
            null;
        const previewBreakdown =
            previewRow?.breakdown ??
            scored.previewExcluded.get(query.place_public_id) ??
            null;

        if (!currentBreakdown || !previewBreakdown) {
            throw new TourismReviewsError(
                "Could not compute ranking preview for this attraction",
                500,
                "PREVIEW_FAILED"
            );
        }

        const currentRank = currentRow
            ? scored.baselineSorted.findIndex(
                  (row) => row.candidate.publicId === query.place_public_id
              ) + 1
            : null;
        const previewRank = previewRow
            ? scored.sorted.findIndex(
                  (row) => row.candidate.publicId === query.place_public_id
              ) + 1
            : null;

        return {
            algorithm_version: scored.algorithmVersion,
            scope: resolved.scope,
            admin_area_id: resolved.adminAreaId,
            place_public_id: query.place_public_id,
            has_changes: hasProposedChanges(proposed),
            current: this.toPreviewSnapshot(currentBreakdown, currentRank),
            preview: this.toPreviewSnapshot(previewBreakdown, previewRank),
        };
    }

    async getPlaceGeoRanks(placePublicId: string): Promise<TourismPlaceGeoRanksDto> {
        const placeId = await this.repo.findActivePlaceIdByPublicId(placePublicId);
        if (placeId === null) {
            throw new TourismReviewsError("Tourism profile not found", 404, "PROFILE_NOT_FOUND");
        }
        const profile = await this.repo.findProfileByPlaceId(placeId);
        if (!profile || !profile.isPublic) {
            throw new TourismReviewsError("Tourism profile not found", 404, "PROFILE_NOT_FOUND");
        }

        const [townshipAdminAreaId, regionAdminAreaId] = await Promise.all([
            this.popularity.resolveTownshipAdminAreaIdForPlace(placeId),
            this.popularity.resolveRegionAdminAreaIdForPlace(placeId),
        ]);

        const [townshipPage, regionPage, nationalPage] = await Promise.all([
            townshipAdminAreaId
                ? this.listRanking({
                      scope: "township",
                      admin_area_id: String(townshipAdminAreaId),
                      limit: 10_000,
                      offset: 0,
                  })
                : Promise.resolve(null),
            regionAdminAreaId
                ? this.listRanking({
                      scope: "region",
                      admin_area_id: String(regionAdminAreaId),
                      limit: 10_000,
                      offset: 0,
                  })
                : Promise.resolve(null),
            this.listRanking({ scope: "national", limit: 10_000, offset: 0 }),
        ]);

        const findRank = (page: TourismGeoRankingPageDto | null) => {
            if (!page) return null;
            const idx = page.items.findIndex((item) => item.public_id === placePublicId);
            if (idx < 0) return null;
            return { rank: page.offset + idx + 1, total: page.total };
        };

        const townshipRank = findRank(townshipPage);
        const regionRank = findRank(regionPage);
        const nationalRank = findRank(nationalPage);

        return {
            public_id: placePublicId,
            township:
                townshipRank && townshipAdminAreaId
                    ? { ...townshipRank, admin_area_id: String(townshipAdminAreaId) }
                    : null,
            region:
                regionRank && regionAdminAreaId
                    ? { ...regionRank, admin_area_id: String(regionAdminAreaId) }
                    : null,
            national: nationalRank,
        };
    }

    private resolveScopeIds(
        scope: TourismGeoRankingScope,
        adminAreaId?: string
    ): ScopeIds {
        if (scope === "township") {
            if (!adminAreaId || !/^\d+$/.test(adminAreaId)) {
                throw new TourismReviewsError(
                    "admin_area_id is required for township ranking",
                    400,
                    "INVALID_SCOPE"
                );
            }
            return {
                scope,
                townshipAdminAreaId: BigInt(adminAreaId),
                regionAdminAreaId: null,
                adminAreaId,
            };
        }
        if (scope === "region") {
            if (!adminAreaId || !/^\d+$/.test(adminAreaId)) {
                throw new TourismReviewsError(
                    "admin_area_id is required for region ranking",
                    400,
                    "INVALID_SCOPE"
                );
            }
            return {
                scope,
                townshipAdminAreaId: null,
                regionAdminAreaId: BigInt(adminAreaId),
                adminAreaId,
            };
        }
        return {
            scope,
            townshipAdminAreaId: null,
            regionAdminAreaId: null,
            adminAreaId: null,
        };
    }

    private async scoreScope(input: {
        scope: TourismGeoRankingScope;
        townshipAdminAreaId: bigint | null;
        regionAdminAreaId: bigint | null;
        tourismType: string | null;
        referenceMonth?: number;
        overlay?: {
            placePublicId: string;
            proposed: TourismGeoRankingPreviewProposed;
        };
    }): Promise<{
        algorithmVersion: string;
        candidates: TourismGeoRankingCandidateRow[];
        sorted: ScoredRow[];
        baselineSorted: ScoredRow[];
        baselineExcluded: Map<string, TourismGeoRankingBreakdown>;
        previewExcluded: Map<string, TourismGeoRankingBreakdown>;
    }> {
        const [config, candidates, popularityResult] = await Promise.all([
            this.repo.findActiveRankingConfig(input.scope),
            this.repo.listGeoRankingCandidates({
                scope: input.scope,
                townshipAdminAreaId: input.townshipAdminAreaId,
                regionAdminAreaId: input.regionAdminAreaId,
                tourismType: input.tourismType,
            }),
            this.popularity.computeContextScores({
                kind: scopeToPopularityContext(input.scope),
                townshipAdminAreaId: input.townshipAdminAreaId,
                regionAdminAreaId: input.regionAdminAreaId,
            }),
        ]);

        const popularityByPlace = new Map(
            popularityResult.items.map((item) => [item.placeId, item.popularityScore])
        );
        const weights = weightsFromConfig(config, input.scope);
        const algorithmVersion =
            config?.algorithmVersion ?? TOURISM_GEO_RANKING_ALGORITHM_VERSION;

        const baselineExcluded = new Map<string, TourismGeoRankingBreakdown>();
        const previewExcluded = new Map<string, TourismGeoRankingBreakdown>();
        const baselineScored: ScoredRow[] = [];
        const previewScored: ScoredRow[] = [];
        const hasOverlay = Boolean(input.overlay);

        for (const candidate of candidates) {
            const popularityScore =
                popularityByPlace.get(String(candidate.placeId)) ?? 50;
            const baselineBreakdown = computeTourismGeoRankingBreakdown(
                {
                    editorialScore: candidate.editorialScore,
                    importanceScore: candidate.importanceScore,
                    averageRating: candidate.averageRating,
                    publishedReviewCount: candidate.publishedReviewCount,
                    popularityScore,
                    seasonMode: candidate.seasonMode,
                    seasonStartMonth: candidate.seasonStartMonth,
                    seasonEndMonth: candidate.seasonEndMonth,
                    manualBoost: candidate.manualBoost,
                    referenceMonth: input.referenceMonth,
                },
                weights,
                input.scope
            );

            if (baselineBreakdown.excluded) {
                baselineExcluded.set(candidate.publicId, baselineBreakdown);
            } else {
                baselineScored.push({
                    candidate,
                    finalScore: baselineBreakdown.finalScore,
                    importanceScore: baselineBreakdown.importanceScore,
                    editorialScore: baselineBreakdown.editorialScore,
                    placeId: candidate.placeId,
                    breakdown: baselineBreakdown,
                });
            }

            if (!hasOverlay) {
                continue;
            }

            const overlayApplies =
                input.overlay!.placePublicId === candidate.publicId;
            const proposed = overlayApplies ? input.overlay!.proposed : undefined;
            const overlayCandidate: TourismGeoRankingCandidateRow = overlayApplies
                ? {
                      ...candidate,
                      editorialScore:
                          proposed?.editorial_score ?? candidate.editorialScore,
                      seasonMode: proposed?.season_mode ?? candidate.seasonMode,
                      seasonStartMonth:
                          proposed?.season_start_month !== undefined
                              ? proposed.season_start_month
                              : candidate.seasonStartMonth,
                      seasonEndMonth:
                          proposed?.season_end_month !== undefined
                              ? proposed.season_end_month
                              : candidate.seasonEndMonth,
                      manualBoost: proposed?.manual_boost ?? candidate.manualBoost,
                  }
                : candidate;

            const previewBreakdown = computeTourismGeoRankingBreakdown(
                {
                    editorialScore: overlayCandidate.editorialScore,
                    importanceScore: overlayCandidate.importanceScore,
                    averageRating: overlayCandidate.averageRating,
                    publishedReviewCount: overlayCandidate.publishedReviewCount,
                    popularityScore,
                    seasonMode: overlayCandidate.seasonMode,
                    seasonStartMonth: overlayCandidate.seasonStartMonth,
                    seasonEndMonth: overlayCandidate.seasonEndMonth,
                    manualBoost: overlayCandidate.manualBoost,
                    referenceMonth: input.referenceMonth,
                },
                weights,
                input.scope
            );

            if (previewBreakdown.excluded) {
                previewExcluded.set(candidate.publicId, previewBreakdown);
            } else {
                previewScored.push({
                    candidate: overlayCandidate,
                    finalScore: previewBreakdown.finalScore,
                    importanceScore: previewBreakdown.importanceScore,
                    editorialScore: previewBreakdown.editorialScore,
                    placeId: overlayCandidate.placeId,
                    breakdown: previewBreakdown,
                });
            }
        }

        const baselineSorted = sortTourismGeoRankingRows(baselineScored);
        const sorted = hasOverlay
            ? sortTourismGeoRankingRows(previewScored)
            : baselineSorted;

        return {
            algorithmVersion,
            candidates,
            sorted,
            baselineSorted,
            baselineExcluded,
            previewExcluded: hasOverlay ? previewExcluded : baselineExcluded,
        };
    }

    private toPreviewSnapshot(
        breakdown: TourismGeoRankingBreakdown,
        rank: number | null
    ): TourismGeoRankingPreviewSnapshot {
        const dto = toTourismGeoRankingBreakdownDto(
            breakdown,
            rank === null ? undefined : rank
        );
        return {
            rank,
            final_score: breakdown.excluded
                ? null
                : roundTourismScoreForDisplay(breakdown.finalScore),
            excluded: breakdown.excluded,
            algorithm_version: dto.algorithm_version,
            scope: dto.scope,
            editorial_score: dto.editorial_score,
            editorial_weight: dto.editorial_weight,
            editorial_contribution: dto.editorial_contribution,
            importance_score: dto.importance_score,
            importance_weight: dto.importance_weight,
            importance_contribution: dto.importance_contribution,
            review_score: dto.review_score,
            review_weight: dto.review_weight,
            review_contribution: dto.review_contribution,
            popularity_score: dto.popularity_score,
            popularity_weight: dto.popularity_weight,
            popularity_contribution: dto.popularity_contribution,
            season_modifier: dto.season_modifier,
            manual_boost: dto.manual_boost,
            base_score: dto.base_score,
            season_adjusted_score: dto.season_adjusted_score,
        };
    }

    private toDto(
        row: ScoredRow,
        rank: number,
        lang: "my" | "en" | undefined,
        includeBreakdown: boolean
    ): TourismGeoRankedPlacePublicDto | TourismGeoRankedPlaceAdminDto {
        const c = row.candidate;
        const nameMm = trimName(c.nameMm);
        const nameEn = trimName(c.nameEn);
        const displayName = trimName(c.displayName);
        const primaryName = trimName(c.primaryName);
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

        const base: TourismGeoRankedPlacePublicDto = {
            rank,
            public_id: c.publicId,
            name,
            name_mm: nameMm,
            name_en: nameEn,
            lat: c.lat,
            lng: c.lng,
            tourism_type: c.tourismType,
            tourism_type_name_en: c.tourismTypeNameEn,
            tourism_type_name_mm: c.tourismTypeNameMm,
            short_description: c.shortDescription,
            price_level: c.priceLevel,
            editor_pick: c.editorPick,
            average_rating: c.averageRating,
            published_review_count: c.publishedReviewCount,
            season_mode: c.seasonMode,
            township_name: c.townshipName,
        };

        if (!includeBreakdown) return base;

        const breakdownDto = toTourismGeoRankingBreakdownDto(row.breakdown, rank);
        return {
            ...base,
            ...breakdownDto,
            season_start_month: c.seasonStartMonth,
            season_end_month: c.seasonEndMonth,
            rank,
        };
    }
}
