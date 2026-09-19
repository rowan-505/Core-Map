import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TourismReviewsService } from "./tourism.service.js";
import type { TourismReviewsRepository } from "./tourism.repo.js";
import { tourismTestPlaceCore, tourismTestProfileRow } from "./tourism.test-fixtures.js";

describe("TourismReviewsService candidates", () => {
    it("lists candidates with suggested tourism types", async () => {
        const repo = {
            listTourismCandidates: async () => ({
                total: 1,
                rows: [
                    {
                        placeId: 1n,
                        publicId: "11111111-1111-4111-8111-111111111111",
                        displayName: "Shwedagon",
                        primaryName: "Shwedagon",
                        nameMm: null,
                        nameEn: "Shwedagon",
                        lat: 16.8,
                        lng: 96.1,
                        importanceScore: 90,
                        isVerified: true,
                        isPublic: true,
                        categoryCode: "pagoda",
                        categoryName: "Pagoda",
                        categoryNameMm: null,
                        townshipAdminAreaId: 10n,
                        townshipName: "Dagon",
                        regionName: "Yangon Region",
                        osmTourism: null,
                        osmHistoric: null,
                        osmLeisure: null,
                        osmNatural: null,
                    },
                ],
            }),
        };

        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
        const page = await service.listTourismCandidates({
            limit: 25,
            offset: 0,
        });

        assert.equal(page.total, 1);
        assert.equal(page.items[0]?.suggested_tourism_type, "religious");
        assert.equal(page.items[0]?.category_code, "pagoda");
        assert.equal(page.items[0]?.township_name, "Dagon");
        assert.equal(page.items[0]?.region_name, "Yangon Region");
    });

    it("approve reuses createPlaceProfile and blocks duplicates", async () => {
        const calls: string[] = [];
        const repo = {
            findUsableUserIdByPublicId: async () => 7n,
            findPlaceCoreByPublicId: async () => tourismTestPlaceCore(),
            findProfileByPlaceId: async () => tourismTestProfileRow(),
            findTourismTypeIdByCode: async () => 1n,
            createPlaceProfile: async () => {
                calls.push("create");
                return tourismTestProfileRow();
            },
            findAdminTourismPlaceByPublicId: async () => null,
        };

        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
        await assert.rejects(
            () =>
                service.approveTourismCandidate("user-1", "11111111-1111-4111-8111-111111111111", {
                    tourism_type: "attraction",
                    editorial_score: 50,
                    season_mode: "all_year",
                    is_public: true,
                    manual_boost: 0,
                    season_start_month: null,
                    season_end_month: null,
                }),
            (error: unknown) =>
                error instanceof Error &&
                "code" in error &&
                (error as { code?: string }).code === "PROFILE_EXISTS"
        );
        assert.deepEqual(calls, []);
    });

    it("ignore persists and refuses places that already have profiles", async () => {
        let ignored = false;
        const repo = {
            findUsableUserIdByPublicId: async () => 7n,
            findPlaceCoreByPublicId: async () => tourismTestPlaceCore(),
            findProfileByPlaceId: async () => null,
            ignoreTourismCandidate: async () => {
                ignored = true;
            },
        };

        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
        const result = await service.ignoreTourismCandidate(
            "user-1",
            "11111111-1111-4111-8111-111111111111",
            { reason: "not tourism" }
        );
        assert.equal(result.ignored, true);
        assert.equal(ignored, true);

        const withProfile = new TourismReviewsService({
            findUsableUserIdByPublicId: async () => 7n,
            findPlaceCoreByPublicId: async () => tourismTestPlaceCore(),
            findProfileByPlaceId: async () => tourismTestProfileRow(),
            ignoreTourismCandidate: async () => {
                throw new Error("should not ignore");
            },
        } as unknown as TourismReviewsRepository);

        await assert.rejects(
            () =>
                withProfile.ignoreTourismCandidate(
                    "user-1",
                    "11111111-1111-4111-8111-111111111111",
                    {}
                ),
            (error: unknown) =>
                error instanceof Error &&
                "code" in error &&
                (error as { code?: string }).code === "PROFILE_EXISTS"
        );
    });

    it("overview returns coverage status", async () => {
        const service = new TourismReviewsService({
            listTourismCandidateOverview: async () => ({
                total: 2,
                rows: [
                    {
                        townshipAdminAreaId: 1n,
                        townshipName: "A",
                        regionAdminAreaId: 9n,
                        candidateCount: 0,
                        approvedProfileCount: 4,
                        activePublicProfileCount: 4,
                        verifiedProfileCount: 2,
                    },
                    {
                        townshipAdminAreaId: 2n,
                        townshipName: "B",
                        regionAdminAreaId: 9n,
                        candidateCount: 12,
                        approvedProfileCount: 0,
                        activePublicProfileCount: 0,
                        verifiedProfileCount: 0,
                    },
                ],
            }),
        } as unknown as TourismReviewsRepository);

        const page = await service.listTourismCandidatesOverview({ limit: 100, offset: 0 });
        assert.equal(page.items[0]?.coverage_status, "covered");
        assert.equal(page.items[1]?.coverage_status, "none");
    });
});
