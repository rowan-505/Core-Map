import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listAdminTourismPlaceSearchQuerySchema } from "./tourism.schema.js";
import { TourismReviewsService } from "./tourism.service.js";
import type { TourismReviewsRepository } from "./tourism.repo.js";

describe("listAdminTourismPlaceSearchQuerySchema", () => {
    it("requires township admin_area_id and q of at least 2 characters", () => {
        const badTownship = listAdminTourismPlaceSearchQuerySchema.safeParse({
            q: "pagoda",
        });
        assert.equal(badTownship.success, false);

        const shortQ = listAdminTourismPlaceSearchQuerySchema.safeParse({
            admin_area_id: "1001",
            q: "a",
        });
        assert.equal(shortQ.success, false);

        const good = listAdminTourismPlaceSearchQuerySchema.safeParse({
            admin_area_id: "1001",
            q: "pa",
        });
        assert.equal(good.success, true);
        if (good.success) {
            assert.equal(good.data.limit, 15);
            assert.equal(good.data.admin_area_id, "1001");
        }
    });

    it("caps limit at 20", () => {
        const tooHigh = listAdminTourismPlaceSearchQuerySchema.safeParse({
            admin_area_id: "1001",
            q: "pagoda",
            limit: 50,
        });
        assert.equal(tooHigh.success, false);

        const ok = listAdminTourismPlaceSearchQuerySchema.safeParse({
            admin_area_id: "1001",
            q: "pagoda",
            limit: 20,
        });
        assert.equal(ok.success, true);
    });
});

describe("TourismReviewsService.searchPlacesForPicker", () => {
    it("maps rows and keeps has_tourism_profile for attraction blocking", async () => {
        const repo = {
            searchPlacesForPicker: async () => ({
                townshipName: "Kyauktan",
                regionName: "Yangon Region",
                rows: [
                    {
                        publicId: "11111111-1111-4111-8111-111111111111",
                        displayName: "Shwedagon",
                        primaryName: "Shwedagon Pagoda",
                        categoryCode: "religious",
                        categoryName: "Religious site",
                        hasTourismProfile: true,
                        isVerified: true,
                    },
                    {
                        publicId: "22222222-2222-4222-8222-222222222222",
                        displayName: null,
                        primaryName: "Local teashop",
                        categoryCode: "cafe",
                        categoryName: "Cafe",
                        hasTourismProfile: false,
                        isVerified: false,
                    },
                ],
            }),
        };

        const service = new TourismReviewsService(
            repo as unknown as TourismReviewsRepository
        );
        const page = await service.searchPlacesForPicker({
            admin_area_id: "1001",
            q: "sh",
            limit: 15,
        });

        assert.equal(page.township_name, "Kyauktan");
        assert.equal(page.region_name, "Yangon Region");
        assert.equal(page.items.length, 2);
        assert.equal(page.items[0]?.display_name, "Shwedagon");
        assert.equal(page.items[0]?.has_tourism_profile, true);
        assert.equal(page.items[0]?.category_name, "Religious site");
        assert.equal(page.items[1]?.display_name, "Local teashop");
        assert.equal(page.items[1]?.has_tourism_profile, false);
    });
});
