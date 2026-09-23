import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

import authPlugin from "../../plugins/auth.js";
import tourismRoutes from "./tourism.routes.js";
import { TourismReviewsService } from "./tourism.service.js";
import type { TourismReviewsRepository } from "./tourism.repo.js";
import { TourismCatalogService } from "./tourism.catalog.service.js";
import { TourismVisitorService } from "./tourism.visitor.service.js";
import { TourismReviewsError } from "./tourism.errors.js";
import {
    FakeTourismReviewsRepository,
    TOURISM_TEST_ADMIN,
} from "./tourism.test-fixtures.js";

const ADMIN = TOURISM_TEST_ADMIN;
const AREA_ID = "1001";
const FOOD_PUBLIC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GUIDE_PUBLIC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADVISORY_PUBLIC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PLACE_PUBLIC = "11111111-1111-4111-8111-111111111111";
const OTHER_PLACE = "22222222-2222-4222-8222-222222222222";

type Json = Record<string, unknown>;

function makeFood(overrides: Partial<Json> = {}): Json {
    return {
        public_id: FOOD_PUBLIC,
        name: "Mohinga",
        name_en: "Mohinga",
        name_mm: null,
        short_description: null,
        food_type: "dish",
        labels: ["must_try"],
        admin_area_id: AREA_ID,
        admin_area_name: "Kyauktan",
        is_active: true,
        is_verified: true,
        source_url: null,
        verified_at: "2026-01-01T00:00:00.000Z",
        places: [],
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function makeGuide(overrides: Partial<Json> = {}): Json {
    return {
        public_id: GUIDE_PUBLIC,
        admin_area_id: AREA_ID,
        admin_area_name: "Kyauktan",
        place_public_id: null,
        place_name: null,
        guide_type: "etiquette",
        title: "Temple tips",
        short_description: null,
        content: "Remove shoes.",
        is_active: true,
        is_verified: true,
        source_url: null,
        verified_at: "2026-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function makeAdvisory(overrides: Partial<Json> = {}): Json {
    return {
        public_id: ADVISORY_PUBLIC,
        admin_area_id: AREA_ID,
        admin_area_name: "Kyauktan",
        place_public_id: null,
        place_name: null,
        activity_public_id: null,
        activity_name: null,
        event_public_id: null,
        event_name: null,
        advisory_type: "access",
        title: "Ferry delayed",
        description: "Expect longer waits.",
        severity: "caution",
        effective_from: null,
        effective_until: null,
        is_active: true,
        is_verified: true,
        source_url: null,
        verified_at: "2026-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

class FakeVisitorService {
    foods = new Map<string, Json>([[FOOD_PUBLIC, makeFood()]]);
    guides = new Map<string, Json>([
        [GUIDE_PUBLIC, makeGuide()],
        [
            "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            makeGuide({
                public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                title: "Place tip",
                place_public_id: PLACE_PUBLIC,
                place_name: "Shwedagon",
            }),
        ],
    ]);
    advisories = new Map<string, Json>([[ADVISORY_PUBLIC, makeAdvisory()]]);
    links = new Set<string>();
    now = new Date("2026-06-15T12:00:00.000Z");

    async listAdminFoods(query: {
        admin_area_id?: string;
        food_type?: string;
        label?: string;
        is_active?: boolean;
        is_verified?: boolean;
        q?: string;
    }) {
        let items = [...this.foods.values()];
        if (query.admin_area_id) {
            items = items.filter((row) => row.admin_area_id === query.admin_area_id);
        }
        if (query.food_type) {
            items = items.filter((row) => row.food_type === query.food_type);
        }
        if (query.label) {
            items = items.filter((row) => (row.labels as string[]).includes(query.label!));
        }
        if (query.is_active !== undefined) {
            items = items.filter((row) => row.is_active === query.is_active);
        }
        if (query.is_verified !== undefined) {
            items = items.filter((row) => row.is_verified === query.is_verified);
        }
        if (query.q) {
            items = items.filter((row) => String(row.name).toLowerCase().includes(query.q!.toLowerCase()));
        }
        return { items, total: items.length, limit: 20, offset: 0 };
    }

    async getAdminFood(id: string) {
        const row = this.foods.get(id);
        if (!row) throw new TourismReviewsError("Food not found", 404, "FOOD_NOT_FOUND");
        return row;
    }

    async createFood(_actor: string, body: Json) {
        const publicId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
        const row = makeFood({ ...body, public_id: publicId, places: [] });
        this.foods.set(publicId, row);
        return row;
    }

    async updateFood(_actor: string, id: string, body: Json) {
        const existing = await this.getAdminFood(id);
        const next = { ...existing, ...body };
        this.foods.set(id, next);
        return next;
    }

    async createFoodPlaceLink(_actor: string, foodId: string, body: Json) {
        await this.getAdminFood(foodId);
        const key = `${foodId}:${body.place_public_id}`;
        if (this.links.has(key)) {
            throw new TourismReviewsError(
                "Food is already linked to this place",
                409,
                "FOOD_PLACE_LINK_EXISTS"
            );
        }
        this.links.add(key);
        return {
            place_public_id: body.place_public_id,
            place_name: "Linked place",
            lat: 16.8,
            lng: 96.1,
            availability_note: body.availability_note ?? null,
            is_signature_here: body.is_signature_here ?? false,
            is_verified: body.is_verified ?? false,
            source_url: body.source_url ?? null,
            verified_at: null,
        };
    }

    async updateFoodPlaceLink(
        _actor: string,
        foodId: string,
        placePublicId: string,
        body: Json
    ) {
        const key = `${foodId}:${placePublicId}`;
        if (!this.links.has(key)) {
            throw new TourismReviewsError(
                "Food place link not found",
                404,
                "FOOD_PLACE_LINK_NOT_FOUND"
            );
        }
        return {
            place_public_id: placePublicId,
            place_name: "Linked place",
            lat: 16.8,
            lng: 96.1,
            availability_note: body.availability_note ?? null,
            is_signature_here: body.is_signature_here ?? false,
            is_verified: body.is_verified ?? false,
            source_url: body.source_url ?? null,
            verified_at: null,
        };
    }

    async deleteFoodPlaceLink(_actor: string, foodId: string, placePublicId: string) {
        const key = `${foodId}:${placePublicId}`;
        if (!this.links.has(key)) {
            throw new TourismReviewsError(
                "Food place link not found",
                404,
                "FOOD_PLACE_LINK_NOT_FOUND"
            );
        }
        this.links.delete(key);
        return { deleted: true as const };
    }

    async listPublicFoods(query: { admin_area_id?: string }) {
        let items = [...this.foods.values()].filter(
            (row) => row.is_active === true && row.is_verified === true
        );
        if (query.admin_area_id) {
            items = items.filter((row) => row.admin_area_id === query.admin_area_id);
        }
        return {
            items: items.map((row) => ({
                public_id: row.public_id,
                name: row.name,
                name_en: row.name_en,
                name_mm: row.name_mm,
                short_description: row.short_description,
                food_type: row.food_type,
                labels: row.labels,
                admin_area_name: row.admin_area_name,
                places: row.places,
            })),
            total: items.length,
            limit: 20,
            offset: 0,
        };
    }

    async getPublicFood(id: string) {
        const row = this.foods.get(id);
        if (!row || row.is_active !== true || row.is_verified !== true) {
            throw new TourismReviewsError("Food not found", 404, "FOOD_NOT_FOUND");
        }
        return {
            public_id: row.public_id,
            name: row.name,
            name_en: row.name_en,
            name_mm: row.name_mm,
            short_description: row.short_description,
            food_type: row.food_type,
            labels: row.labels,
            admin_area_name: row.admin_area_name,
            places: row.places,
        };
    }

    async listAdminGuides(query: {
        admin_area_id?: string;
        place_public_id?: string;
        guide_type?: string;
    }) {
        let items = [...this.guides.values()];
        if (query.admin_area_id) {
            items = items.filter((row) => row.admin_area_id === query.admin_area_id);
        }
        if (query.place_public_id) {
            items = items.filter((row) => row.place_public_id === query.place_public_id);
        }
        if (query.guide_type) {
            items = items.filter((row) => row.guide_type === query.guide_type);
        }
        return { items, total: items.length, limit: 20, offset: 0 };
    }

    async getAdminGuide(id: string) {
        const row = this.guides.get(id);
        if (!row) throw new TourismReviewsError("Guide not found", 404, "GUIDE_NOT_FOUND");
        return row;
    }

    async createGuide(_actor: string, body: Json) {
        const publicId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
        const row = makeGuide({ ...body, public_id: publicId });
        this.guides.set(publicId, row);
        return row;
    }

    async updateGuide(_actor: string, id: string, body: Json) {
        const existing = await this.getAdminGuide(id);
        const next = { ...existing, ...body };
        this.guides.set(id, next);
        return next;
    }

    async listPublicGuides(query: {
        admin_area_id?: string;
        place_public_id?: string;
    }) {
        let items = [...this.guides.values()].filter(
            (row) => row.is_active === true && row.is_verified === true
        );
        if (query.admin_area_id) {
            items = items.filter((row) => row.admin_area_id === query.admin_area_id);
        }
        if (query.place_public_id) {
            items = items.filter((row) => row.place_public_id === query.place_public_id);
        }
        return {
            items: items.map((row) => ({
                public_id: row.public_id,
                admin_area_name: row.admin_area_name,
                place_public_id: row.place_public_id,
                place_name: row.place_name,
                guide_type: row.guide_type,
                title: row.title,
                short_description: row.short_description,
                content: row.content,
            })),
            total: items.length,
            limit: 20,
            offset: 0,
        };
    }

    async listAdminAdvisories() {
        const items = [...this.advisories.values()];
        return { items, total: items.length, limit: 20, offset: 0 };
    }

    async getAdminAdvisory(id: string) {
        const row = this.advisories.get(id);
        if (!row) throw new TourismReviewsError("Advisory not found", 404, "ADVISORY_NOT_FOUND");
        return row;
    }

    async createAdvisory(_actor: string, body: Json) {
        const publicId = "99999999-9999-4999-8999-999999999999";
        const row = makeAdvisory({ ...body, public_id: publicId });
        this.advisories.set(publicId, row);
        return row;
    }

    async updateAdvisory(_actor: string, id: string, body: Json) {
        const existing = await this.getAdminAdvisory(id);
        const next = { ...existing, ...body };
        this.advisories.set(id, next);
        return next;
    }

    async listPublicAdvisories(query: { admin_area_id?: string }) {
        let items = [...this.advisories.values()].filter((row) => {
            if (row.is_active !== true || row.is_verified !== true) return false;
            const from = row.effective_from ? new Date(String(row.effective_from)) : null;
            const until = row.effective_until ? new Date(String(row.effective_until)) : null;
            if (from && this.now < from) return false;
            if (until && this.now > until) return false;
            return true;
        });
        if (query.admin_area_id) {
            items = items.filter((row) => row.admin_area_id === query.admin_area_id);
        }
        return {
            items: items.map((row) => ({
                public_id: row.public_id,
                admin_area_name: row.admin_area_name,
                place_public_id: row.place_public_id,
                place_name: row.place_name,
                advisory_type: row.advisory_type,
                title: row.title,
                description: row.description,
                severity: row.severity,
                effective_from: row.effective_from,
                effective_until: row.effective_until,
            })),
            total: items.length,
            limit: 20,
            offset: 0,
        };
    }
}

async function withVisitorApp(
    run: (ctx: {
        app: ReturnType<typeof Fastify>;
        visitor: FakeVisitorService;
        authHeader: (publicId: string, roles?: string[]) => { authorization: string };
    }) => Promise<void>
) {
    const previous = {
        JWT_SECRET: process.env.JWT_SECRET,
        AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
        AUTH_BYPASS: process.env.AUTH_BYPASS,
        NODE_ENV: process.env.NODE_ENV,
    };
    process.env.JWT_SECRET = "tourism-visitor-test-secret";
    process.env.AUTH_JWT_SECRET = "tourism-visitor-test-secret";
    delete process.env.AUTH_BYPASS;
    process.env.NODE_ENV = "test";

    const repo = new FakeTourismReviewsRepository();
    const tourismService = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
    const visitor = new FakeVisitorService();
    const app = Fastify();

    try {
        await app.register(rateLimit, { global: false });
        await app.register(authPlugin);
        await app.register(tourismRoutes, {
            service: tourismService,
            catalogService: {} as unknown as TourismCatalogService,
            visitorService: visitor as unknown as TourismVisitorService,
            researchService: {
                list: async () => ({ items: [], total: 0, limit: 20, offset: 0 }),
            } as unknown as import("./tourism.research.service.js").TourismResearchService,
        });
        await app.ready();

        const authHeader = (publicId: string, roles: string[] = ["user"]) => ({
            authorization: `Bearer ${app.jwt.sign({
                sub: publicId,
                email: `${publicId}@example.com`,
                roles,
            })}`,
        });

        await run({ app, visitor, authHeader });
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

describe("tourism visitor routes", () => {
    it("rejects unauthorized admin writes", async () => {
        await withVisitorApp(async ({ app, authHeader }) => {
            const anon = await app.inject({
                method: "POST",
                url: "/admin/tourism/foods",
                headers: { "content-type": "application/json" },
                payload: {
                    name: "Mohinga",
                    food_type: "dish",
                    admin_area_id: AREA_ID,
                },
            });
            assert.equal(anon.statusCode, 401);

            const user = await app.inject({
                method: "POST",
                url: "/admin/tourism/foods",
                headers: {
                    ...authHeader(ADMIN, ["user"]),
                    "content-type": "application/json",
                },
                payload: {
                    name: "Mohinga",
                    food_type: "dish",
                    admin_area_id: AREA_ID,
                },
            });
            assert.equal(user.statusCode, 403);
        });
    });

    it("rejects malformed public ids on admin and public routes", async () => {
        await withVisitorApp(async ({ app, authHeader }) => {
            const adminGet = await app.inject({
                method: "GET",
                url: "/admin/tourism/foods/not-a-uuid",
                headers: authHeader(ADMIN, ["admin"]),
            });
            assert.equal(adminGet.statusCode, 400);

            const publicGet = await app.inject({
                method: "GET",
                url: "/tourism/foods/not-a-uuid",
            });
            assert.equal(publicGet.statusCode, 400);
        });
    });

    it("filters admin foods and rejects duplicate food/place links", async () => {
        await withVisitorApp(async ({ app, authHeader, visitor }) => {
            visitor.foods.set(
                "ffffffff-ffff-4fff-8fff-ffffffffffff",
                makeFood({
                    public_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                    name: "Laphet",
                    food_type: "snack",
                    labels: ["traditional"],
                    is_active: false,
                    is_verified: false,
                })
            );

            const filtered = await app.inject({
                method: "GET",
                url: `/admin/tourism/foods?admin_area_id=${AREA_ID}&food_type=dish&label=must_try&is_active=true`,
                headers: authHeader(ADMIN, ["admin"]),
            });
            assert.equal(filtered.statusCode, 200);
            const items = bodyJson(filtered).items as Json[];
            assert.equal(items.length, 1);
            assert.equal(items[0]?.name, "Mohinga");

            const created = await app.inject({
                method: "POST",
                url: `/admin/tourism/foods/${FOOD_PUBLIC}/places`,
                headers: {
                    ...authHeader(ADMIN, ["admin"]),
                    "content-type": "application/json",
                },
                payload: { place_public_id: PLACE_PUBLIC, is_signature_here: true },
            });
            assert.equal(created.statusCode, 201);

            const duplicate = await app.inject({
                method: "POST",
                url: `/admin/tourism/foods/${FOOD_PUBLIC}/places`,
                headers: {
                    ...authHeader(ADMIN, ["admin"]),
                    "content-type": "application/json",
                },
                payload: { place_public_id: PLACE_PUBLIC },
            });
            assert.equal(duplicate.statusCode, 409);
            assert.equal(bodyJson(duplicate).code, "FOOD_PLACE_LINK_EXISTS");
        });
    });

    it("filters guides by township and place", async () => {
        await withVisitorApp(async ({ app, authHeader }) => {
            const byArea = await app.inject({
                method: "GET",
                url: `/admin/tourism/guides?admin_area_id=${AREA_ID}`,
                headers: authHeader(ADMIN, ["admin"]),
            });
            assert.equal(byArea.statusCode, 200);
            assert.equal((bodyJson(byArea).items as Json[]).length, 2);

            const byPlace = await app.inject({
                method: "GET",
                url: `/admin/tourism/guides?place_public_id=${PLACE_PUBLIC}`,
                headers: authHeader(ADMIN, ["admin"]),
            });
            assert.equal(byPlace.statusCode, 200);
            const placeItems = bodyJson(byPlace).items as Json[];
            assert.equal(placeItems.length, 1);
            assert.equal(placeItems[0]?.place_public_id, PLACE_PUBLIC);

            const publicByPlace = await app.inject({
                method: "GET",
                url: `/tourism/guides?place_public_id=${PLACE_PUBLIC}`,
            });
            assert.equal(publicByPlace.statusCode, 200);
            assert.equal((bodyJson(publicByPlace).items as Json[]).length, 1);
        });
    });

    it("hides inactive/unverified foods and expired advisories from public endpoints", async () => {
        await withVisitorApp(async ({ app, visitor }) => {
            visitor.foods.set(
                FOOD_PUBLIC,
                makeFood({ is_active: false, is_verified: true })
            );
            visitor.foods.set(
                "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                makeFood({
                    public_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                    name: "Hidden draft",
                    is_active: true,
                    is_verified: false,
                })
            );

            const foods = await app.inject({ method: "GET", url: "/tourism/foods" });
            assert.equal(foods.statusCode, 200);
            assert.equal((bodyJson(foods).items as Json[]).length, 0);

            const detail = await app.inject({
                method: "GET",
                url: `/tourism/foods/${FOOD_PUBLIC}`,
            });
            assert.equal(detail.statusCode, 404);

            visitor.advisories.set(
                ADVISORY_PUBLIC,
                makeAdvisory({
                    effective_from: "2026-01-01T00:00:00.000Z",
                    effective_until: "2026-02-01T00:00:00.000Z",
                })
            );
            visitor.advisories.set(
                "88888888-8888-4888-8888-888888888888",
                makeAdvisory({
                    public_id: "88888888-8888-4888-8888-888888888888",
                    title: "Current advisory",
                    effective_from: "2026-06-01T00:00:00.000Z",
                    effective_until: "2026-07-01T00:00:00.000Z",
                })
            );
            visitor.advisories.set(
                "77777777-7777-4777-8777-777777777777",
                makeAdvisory({
                    public_id: "77777777-7777-4777-8777-777777777777",
                    title: "Unverified",
                    is_verified: false,
                })
            );

            const advisories = await app.inject({
                method: "GET",
                url: `/tourism/advisories?admin_area_id=${AREA_ID}`,
            });
            assert.equal(advisories.statusCode, 200);
            const advisoryItems = bodyJson(advisories).items as Json[];
            assert.equal(advisoryItems.length, 1);
            assert.equal(advisoryItems[0]?.title, "Current advisory");
        });
    });

    it("allows admin create/update for foods, guides, and advisories", async () => {
        await withVisitorApp(async ({ app, authHeader }) => {
            const food = await app.inject({
                method: "POST",
                url: "/admin/tourism/foods",
                headers: {
                    ...authHeader(ADMIN, ["admin"]),
                    "content-type": "application/json",
                },
                payload: {
                    name: "Shan noodles",
                    food_type: "dish",
                    labels: ["popular"],
                    admin_area_id: AREA_ID,
                },
            });
            assert.equal(food.statusCode, 201);

            const guide = await app.inject({
                method: "POST",
                url: "/admin/tourism/guides",
                headers: {
                    ...authHeader(ADMIN, ["admin"]),
                    "content-type": "application/json",
                },
                payload: {
                    admin_area_id: AREA_ID,
                    place_public_id: OTHER_PLACE,
                    guide_type: "visitor_tip",
                    title: "Market hours",
                    content: "Go early.",
                },
            });
            assert.equal(guide.statusCode, 201);

            const advisory = await app.inject({
                method: "POST",
                url: "/admin/tourism/advisories",
                headers: {
                    ...authHeader(ADMIN, ["admin"]),
                    "content-type": "application/json",
                },
                payload: {
                    admin_area_id: AREA_ID,
                    advisory_type: "weather",
                    title: "Monsoon rains",
                    description: "Expect flooding on low roads.",
                    severity: "info",
                    effective_from: "2026-06-01T00:00:00.000Z",
                    effective_until: "2026-09-01T00:00:00.000Z",
                },
            });
            assert.equal(advisory.statusCode, 201);
        });
    });
});
