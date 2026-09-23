import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

import authPlugin from "../../plugins/auth.js";
import tourismRoutes from "./tourism.routes.js";
import { TourismReviewsService } from "./tourism.service.js";
import type { TourismReviewsRepository } from "./tourism.repo.js";
import { TourismCatalogService } from "./tourism.catalog.service.js";
import {
    FakeTourismReviewsRepository,
} from "./tourism.test-fixtures.js";
import type {
    TourismActivityPublicDto,
    TourismEventPublicDto,
} from "./tourism.catalog.service.js";

const AREA = "1001";

type Json = Record<string, unknown>;

class FakePublicCatalogService {
    activities: TourismActivityPublicDto[] = [
        {
            public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "Active hike",
            short_description: "Trail",
            activity_type: "hiking",
            activity_type_name_en: "Hiking",
            admin_area_name: "Kyauktan",
            is_verified: true,
            season_mode: "all_year",
            season_start_month: null,
            season_end_month: null,
            display_priority: 10,
            primary_place: {
                public_id: "11111111-1111-4111-8111-111111111111",
                name: "Trailhead",
                lat: 16.7,
                lng: 96.5,
            },
        },
        {
            public_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            name: "Unverified craft",
            short_description: null,
            activity_type: "workshop",
            activity_type_name_en: "Workshop",
            admin_area_name: "Kyauktan",
            is_verified: false,
            season_mode: "best_months",
            season_start_month: 11,
            season_end_month: 2,
            display_priority: 0,
            primary_place: null,
        },
    ];

    happening: TourismEventPublicDto[] = [
        {
            public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            name: "Long festival",
            short_description: "Two months",
            event_type: "festival",
            event_type_name_en: "Festival",
            admin_area_name: "Kyauktan",
            is_verified: true,
            primary_place: null,
            occurrence: {
                public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                starts_at: "2026-06-01T00:00:00.000Z",
                ends_at: "2026-08-01T00:00:00.000Z",
                status: "confirmed",
                schedule_note: "Open daily 10:00–18:00",
                derived_state: "happening_now",
                duration_days: 61,
            },
        },
    ];

    upcoming: TourismEventPublicDto[] = [
        {
            public_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            name: "Cross-year market",
            short_description: null,
            event_type: "market_event",
            event_type_name_en: "Market event",
            admin_area_name: "Kyauktan",
            is_verified: false,
            primary_place: {
                public_id: "22222222-2222-4222-8222-222222222222",
                name: "Market square",
                lat: 16.8,
                lng: 96.4,
            },
            occurrence: {
                public_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                starts_at: "2026-12-28T00:00:00.000Z",
                ends_at: "2027-01-05T00:00:00.000Z",
                status: "scheduled",
                schedule_note: "Weekends only during the festival period",
                derived_state: "upcoming",
                duration_days: 8,
            },
        },
    ];

    async listPublicActivities(query: { admin_area_id?: string }) {
        let items = this.activities;
        if (query.admin_area_id && query.admin_area_id !== AREA) {
            items = [];
        }
        return { items, total: items.length, limit: 20, offset: 0 };
    }

    async listPublicEvents(query: {
        status: "happening_now" | "upcoming";
        admin_area_id?: string;
    }) {
        let items = query.status === "happening_now" ? this.happening : this.upcoming;
        if (query.admin_area_id && query.admin_area_id !== AREA) {
            items = [];
        }
        return {
            status: query.status,
            items,
            total: items.length,
            limit: 20,
            offset: 0,
        };
    }

    // Unused admin stubs so routes option typing stays happy if called
    async listActivityTypes() {
        return [];
    }
}

async function withPublicApp(
    run: (ctx: { app: ReturnType<typeof Fastify> }) => Promise<void>
) {
    const previous = {
        JWT_SECRET: process.env.JWT_SECRET,
        AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
        AUTH_BYPASS: process.env.AUTH_BYPASS,
        NODE_ENV: process.env.NODE_ENV,
    };
    process.env.JWT_SECRET = "tourism-discover-public-test";
    process.env.AUTH_JWT_SECRET = "tourism-discover-public-test";
    delete process.env.AUTH_BYPASS;
    process.env.NODE_ENV = "test";

    const repo = new FakeTourismReviewsRepository();
    const tourismService = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
    const catalog = new FakePublicCatalogService();
    const app = Fastify();

    try {
        await app.register(rateLimit, { global: false });
        await app.register(authPlugin);
        await app.register(tourismRoutes, {
            service: tourismService,
            catalogService: catalog as unknown as TourismCatalogService,
            visitorService: {
                listPublicFoods: async () => ({ items: [], total: 0, limit: 20, offset: 0 }),
                listPublicGuides: async () => ({ items: [], total: 0, limit: 20, offset: 0 }),
                listPublicAdvisories: async () => ({ items: [], total: 0, limit: 20, offset: 0 }),
            } as unknown as import("./tourism.visitor.service.js").TourismVisitorService,
            researchService: {
                list: async () => ({ items: [], total: 0, limit: 20, offset: 0 }),
            } as unknown as import("./tourism.research.service.js").TourismResearchService,
        });
        await app.ready();
        await run({ app });
    } finally {
        await app.close();
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

function bodyJson(response: { body: string }): Json {
    return JSON.parse(response.body) as Json;
}

function assertNoAdminLeak(item: Json) {
    assert.equal("created_by" in item, false);
    assert.equal("updated_by" in item, false);
    assert.equal("schedule_review_note" in item, false);
    assert.equal("requires_schedule_review" in item, false);
    assert.equal("last_schedule_reviewed_at" in item, false);
    assert.equal("next_review_due_at" in item, false);
    assert.equal("needs_review" in item, false);
    assert.equal("review_status" in item, false);
    assert.equal("created_at" in item, false);
    assert.equal("admin_area_id" in item, false);
}

describe("public tourism discover routes", () => {
    it("lists activities without auth and sorts verified first in fixture order", async () => {
        await withPublicApp(async ({ app }) => {
            const response = await app.inject({
                method: "GET",
                url: `/tourism/activities?admin_area_id=${AREA}`,
            });
            assert.equal(response.statusCode, 200);
            const body = bodyJson(response);
            const items = body.items as Json[];
            assert.equal(items.length, 2);
            assert.equal(items[0]?.is_verified, true);
            assert.equal(items[1]?.is_verified, false);
            assertNoAdminLeak(items[0]!);
            assert.ok((items[0] as Json).primary_place);
        });
    });

    it("filters activities by township", async () => {
        await withPublicApp(async ({ app }) => {
            const response = await app.inject({
                method: "GET",
                url: "/tourism/activities?admin_area_id=9999",
            });
            assert.equal(response.statusCode, 200);
            assert.equal((bodyJson(response).items as Json[]).length, 0);
        });
    });

    it("returns happening_now and upcoming event cards with duration", async () => {
        await withPublicApp(async ({ app }) => {
            const now = await app.inject({
                method: "GET",
                url: "/tourism/events?status=happening_now",
            });
            assert.equal(now.statusCode, 200);
            const happening = (bodyJson(now).items as Json[])[0]!;
            assert.equal(happening.name, "Long festival");
            assert.equal((happening.occurrence as Json).derived_state, "happening_now");
            assert.equal((happening.occurrence as Json).duration_days, 61);
            assertNoAdminLeak(happening);

            const upcoming = await app.inject({
                method: "GET",
                url: "/tourism/events?status=upcoming",
            });
            assert.equal(upcoming.statusCode, 200);
            const next = (bodyJson(upcoming).items as Json[])[0]!;
            assert.equal(next.name, "Cross-year market");
            assert.equal((next.occurrence as Json).status, "scheduled");
            assertNoAdminLeak(next);
        });
    });

    it("rejects invalid public event status", async () => {
        await withPublicApp(async ({ app }) => {
            const response = await app.inject({
                method: "GET",
                url: "/tourism/events?status=cancelled",
            });
            assert.equal(response.statusCode, 400);
        });
    });
});
