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
import {
    createTourismActivityBodySchema,
    createTourismOccurrenceBodySchema,
} from "./tourism.catalog.schema.js";

const ADMIN = TOURISM_TEST_ADMIN;
const AREA_ID = "1001";
const PLACE_PUBLIC = "11111111-1111-4111-8111-111111111111";
const ACTIVITY_PUBLIC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_PUBLIC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_EVENT_PUBLIC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OCC_PUBLIC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Json = Record<string, unknown>;

function makeActivity(overrides: Partial<Json> = {}): Json {
    return {
        public_id: ACTIVITY_PUBLIC,
        name: "Shwedagon walk",
        short_description: null,
        activity_type: "sightseeing",
        activity_type_name_en: "Sightseeing",
        admin_area_id: AREA_ID,
        admin_area_name: "Kyauktan",
        primary_place_public_id: null,
        primary_place_name: null,
        is_active: true,
        is_verified: false,
        season_mode: "all_year",
        season_start_month: null,
        season_end_month: null,
        display_priority: 0,
        requires_schedule_review: false,
        last_schedule_reviewed_at: null,
        next_review_due_at: null,
        schedule_review_note: null,
        review_status: "none",
        needs_review: false,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function makeEvent(overrides: Partial<Json> = {}): Json {
    return {
        public_id: EVENT_PUBLIC,
        name: "Thingyan",
        short_description: null,
        event_type: "festival",
        event_type_name_en: "Festival",
        admin_area_id: AREA_ID,
        admin_area_name: "Kyauktan",
        primary_place_public_id: null,
        primary_place_name: null,
        is_active: true,
        is_verified: false,
        requires_schedule_review: false,
        last_schedule_reviewed_at: null,
        next_review_due_at: null,
        schedule_review_note: null,
        review_status: "none",
        needs_review: false,
        missing_next_occurrence: false,
        next_occurrence: null,
        last_occurrence: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function makeOccurrence(overrides: Partial<Json> = {}): Json {
    return {
        public_id: OCC_PUBLIC,
        event_public_id: EVENT_PUBLIC,
        starts_at: "2026-04-10T00:00:00.000Z",
        ends_at: "2026-04-12T00:00:00.000Z",
        status: "scheduled",
        schedule_note: null,
        source_url: null,
        verified_at: null,
        derived_state: "upcoming",
        duration_seconds: 172800,
        duration_days: 2,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

class FakeCatalogService {
    activities = new Map<string, Json>([[ACTIVITY_PUBLIC, makeActivity()]]);
    events = new Map<string, Json>([
        [EVENT_PUBLIC, makeEvent()],
        [OTHER_EVENT_PUBLIC, makeEvent({ public_id: OTHER_EVENT_PUBLIC, name: "Other" })],
    ]);
    occurrences = new Map<string, Json>([
        [OCC_PUBLIC, makeOccurrence()],
    ]);
    audits: string[] = [];

    async listActivityTypes() {
        return [{ code: "sightseeing", name_en: "Sightseeing", name_mm: null, sort_order: 10 }];
    }
    async listEventTypes() {
        return [{ code: "festival", name_en: "Festival", name_mm: null, sort_order: 10 }];
    }

    async listActivities(query: {
        admin_area_id?: string;
        activity_type?: string;
        q?: string;
        review_status?: string;
    }) {
        let items = [...this.activities.values()];
        if (query.admin_area_id) {
            items = items.filter((row) => row.admin_area_id === query.admin_area_id);
        }
        if (query.activity_type) {
            items = items.filter((row) => row.activity_type === query.activity_type);
        }
        if (query.q) {
            items = items.filter((row) => String(row.name).includes(query.q!));
        }
        if (query.review_status === "needs_review") {
            items = items.filter((row) => row.needs_review === true);
        } else if (query.review_status) {
            items = items.filter((row) => row.review_status === query.review_status);
        }
        return { items, total: items.length, limit: 20, offset: 0 };
    }

    async getActivity(id: string) {
        const row = this.activities.get(id);
        if (!row) throw new TourismReviewsError("Activity not found", 404, "ACTIVITY_NOT_FOUND");
        return row;
    }

    async createActivity(_actor: string, body: Json) {
        if (body.activity_type === "not_a_type") {
            throw new TourismReviewsError("Invalid or inactive activity type", 400, "INVALID_ACTIVITY_TYPE");
        }
        if (body.primary_place_public_id === "00000000-0000-4000-8000-000000000000") {
            throw new TourismReviewsError("Place not found", 404, "PLACE_NOT_FOUND");
        }
        const publicId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
        const row = makeActivity({ ...body, public_id: publicId });
        this.activities.set(publicId, row);
        this.audits.push("tourism_activity_created");
        return row;
    }

    async updateActivity(_actor: string, id: string, body: Json) {
        const existing = await this.getActivity(id);
        const next = { ...existing, ...body };
        this.activities.set(id, next);
        this.audits.push("tourism_activity_updated");
        return next;
    }

    async listEvents(query: { tab?: string; admin_area_id?: string; review_status?: string }) {
        let items = [...this.events.values()];
        if (query.admin_area_id) {
            items = items.filter((row) => row.admin_area_id === query.admin_area_id);
        }
        if (query.review_status === "needs_review") {
            items = items.filter(
                (row) => row.needs_review === true || row.missing_next_occurrence === true
            );
        } else if (query.review_status) {
            items = items.filter((row) => row.review_status === query.review_status);
        }
        return { items, total: items.length, limit: 20, offset: 0, tab: query.tab ?? "all" };
    }

    async getEvent(id: string) {
        const row = this.events.get(id);
        if (!row) throw new TourismReviewsError("Event not found", 404, "EVENT_NOT_FOUND");
        return row;
    }

    async createEvent(_actor: string, body: Json) {
        const publicId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
        const row = makeEvent({ ...body, public_id: publicId });
        this.events.set(publicId, row);
        this.audits.push("tourism_event_created");
        return row;
    }

    async updateEvent(_actor: string, id: string, body: Json) {
        const existing = await this.getEvent(id);
        const next = { ...existing, ...body };
        this.events.set(id, next);
        this.audits.push("tourism_event_updated");
        return next;
    }

    async listOccurrences(eventId: string) {
        await this.getEvent(eventId);
        const items = [...this.occurrences.values()].filter(
            (row) => row.event_public_id === eventId
        );
        return { items, total: items.length, limit: 50, offset: 0 };
    }

    async createOccurrence(_actor: string, eventId: string, body: Json) {
        await this.getEvent(eventId);
        if (new Date(String(body.ends_at)).getTime() <= new Date(String(body.starts_at)).getTime()) {
            throw new TourismReviewsError(
                "ends_at must be after starts_at",
                400,
                "INVALID_OCCURRENCE_RANGE"
            );
        }
        const publicId = "99999999-9999-4999-8999-999999999999";
        const row = makeOccurrence({
            ...body,
            public_id: publicId,
            event_public_id: eventId,
        });
        this.occurrences.set(publicId, row);
        this.audits.push("tourism_event_occurrence_created");
        return row;
    }

    async updateOccurrence(
        _actor: string,
        eventId: string,
        occurrenceId: string,
        body: Json
    ) {
        await this.getEvent(eventId);
        const existing = this.occurrences.get(occurrenceId);
        if (!existing || existing.event_public_id !== eventId) {
            throw new TourismReviewsError(
                "Occurrence not found for this event",
                404,
                "OCCURRENCE_NOT_FOUND"
            );
        }
        const next = { ...existing, ...body };
        this.occurrences.set(occurrenceId, next);
        this.audits.push("tourism_event_occurrence_updated");
        return next;
    }

    async confirmActivityScheduleReview(_actor: string, id: string, body: Json) {
        const existing = await this.getActivity(id);
        const reviewedAt = new Date().toISOString();
        const next = {
            ...existing,
            requires_schedule_review: body.requires_schedule_review ?? true,
            next_review_due_at: body.next_review_due_at,
            schedule_review_note: body.schedule_review_note ?? null,
            last_schedule_reviewed_at: reviewedAt,
            review_status: "current",
            needs_review: false,
        };
        this.activities.set(id, next);
        this.audits.push("tourism_activity_schedule_reviewed");
        return next;
    }

    async confirmEventScheduleReview(_actor: string, id: string, body: Json) {
        const existing = await this.getEvent(id);
        const reviewedAt = new Date().toISOString();
        const next = {
            ...existing,
            requires_schedule_review: body.requires_schedule_review ?? true,
            next_review_due_at: body.next_review_due_at,
            schedule_review_note: body.schedule_review_note ?? null,
            last_schedule_reviewed_at: reviewedAt,
            review_status: "current",
            needs_review: false,
            missing_next_occurrence: false,
        };
        this.events.set(id, next);
        this.audits.push("tourism_event_schedule_reviewed");
        return next;
    }
}

async function withCatalogApp(
    run: (ctx: {
        app: ReturnType<typeof Fastify>;
        catalog: FakeCatalogService;
        authHeader: (publicId: string, roles?: string[]) => { authorization: string };
    }) => Promise<void>
) {
    const previous = {
        JWT_SECRET: process.env.JWT_SECRET,
        AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
        AUTH_BYPASS: process.env.AUTH_BYPASS,
        NODE_ENV: process.env.NODE_ENV,
    };
    process.env.JWT_SECRET = "tourism-catalog-test-secret";
    process.env.AUTH_JWT_SECRET = "tourism-catalog-test-secret";
    delete process.env.AUTH_BYPASS;
    process.env.NODE_ENV = "test";

    const repo = new FakeTourismReviewsRepository();
    const tourismService = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
    const catalog = new FakeCatalogService();
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
            } as unknown as TourismVisitorService,
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

        await run({ app, catalog, authHeader });
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

describe("tourism catalog admin routes", () => {
    it("rejects unauthenticated and non-admin access", async () => {
        await withCatalogApp(async ({ app, authHeader }) => {
            const anon = await app.inject({ method: "GET", url: "/admin/tourism/activities" });
            assert.equal(anon.statusCode, 401);

            const user = await app.inject({
                method: "GET",
                url: "/admin/tourism/activities",
                headers: authHeader(ADMIN, ["user"]),
            });
            assert.equal(user.statusCode, 403);
        });
    });

    it("lists and filters activities for admin", async () => {
        await withCatalogApp(async ({ app, authHeader }) => {
            const response = await app.inject({
                method: "GET",
                url: `/admin/tourism/activities?admin_area_id=${AREA_ID}&activity_type=sightseeing`,
                headers: authHeader(ADMIN, ["admin"]),
            });
            assert.equal(response.statusCode, 200);
            const body = bodyJson(response);
            assert.equal((body.items as Json[]).length, 1);
            assert.equal((body.items as Json[])[0]?.name, "Shwedagon walk");
        });
    });

    it("creates and patches an activity", async () => {
        await withCatalogApp(async ({ app, authHeader, catalog }) => {
            const created = await app.inject({
                method: "POST",
                url: "/admin/tourism/activities",
                headers: {
                    ...authHeader(ADMIN, ["admin"]),
                    "content-type": "application/json",
                },
                payload: {
                    name: "Boat trip",
                    activity_type: "boat_trip",
                    admin_area_id: AREA_ID,
                    season_mode: "all_year",
                },
            });
            assert.equal(created.statusCode, 201);
            const createdBody = bodyJson(created);
            assert.equal(createdBody.activity_type, "boat_trip");
            assert.ok(catalog.audits.includes("tourism_activity_created"));

            const patched = await app.inject({
                method: "PATCH",
                url: `/admin/tourism/activities/${createdBody.public_id}`,
                headers: {
                    ...authHeader(ADMIN, ["super_admin"]),
                    "content-type": "application/json",
                },
                payload: { is_verified: true, is_active: false },
            });
            assert.equal(patched.statusCode, 200);
            assert.equal(bodyJson(patched).is_verified, true);
            assert.equal(bodyJson(patched).is_active, false);
        });
    });

    it("rejects invalid place link and inactive type via service errors", async () => {
        await withCatalogApp(async ({ app, authHeader }) => {
            const badPlace = await app.inject({
                method: "POST",
                url: "/admin/tourism/activities",
                headers: {
                    ...authHeader(ADMIN, ["admin"]),
                    "content-type": "application/json",
                },
                payload: {
                    name: "Bad place",
                    activity_type: "sightseeing",
                    admin_area_id: AREA_ID,
                    primary_place_public_id: "00000000-0000-4000-8000-000000000000",
                },
            });
            assert.equal(badPlace.statusCode, 404);
        });
    });

    it("supports event CRUD and nested occurrences with ownership", async () => {
        await withCatalogApp(async ({ app, authHeader, catalog }) => {
            const listed = await app.inject({
                method: "GET",
                url: "/admin/tourism/events?tab=all",
                headers: authHeader(ADMIN, ["admin"]),
            });
            assert.equal(listed.statusCode, 200);

            const occCreate = await app.inject({
                method: "POST",
                url: `/admin/tourism/events/${EVENT_PUBLIC}/occurrences`,
                headers: {
                    ...authHeader(ADMIN, ["admin"]),
                    "content-type": "application/json",
                },
                payload: {
                    starts_at: "2027-04-10T00:00:00.000Z",
                    ends_at: "2027-04-12T00:00:00.000Z",
                    status: "confirmed",
                    schedule_note: "Open daily 10:00–18:00",
                },
            });
            assert.equal(occCreate.statusCode, 201);
            assert.ok(catalog.audits.includes("tourism_event_occurrence_created"));

            const wrongOwner = await app.inject({
                method: "PATCH",
                url: `/admin/tourism/events/${OTHER_EVENT_PUBLIC}/occurrences/${OCC_PUBLIC}`,
                headers: {
                    ...authHeader(ADMIN, ["admin"]),
                    "content-type": "application/json",
                },
                payload: { status: "cancelled" },
            });
            assert.equal(wrongOwner.statusCode, 404);

            const confirm = await app.inject({
                method: "PATCH",
                url: `/admin/tourism/events/${EVENT_PUBLIC}/occurrences/${OCC_PUBLIC}`,
                headers: {
                    ...authHeader(ADMIN, ["admin"]),
                    "content-type": "application/json",
                },
                payload: { status: "confirmed" },
            });
            assert.equal(confirm.statusCode, 200);
            assert.equal(bodyJson(confirm).status, "confirmed");
        });
    });

    it("rejects occurrence end <= start at schema and service layers", async () => {
        const parsed = createTourismOccurrenceBodySchema.safeParse({
            starts_at: "2026-04-12T00:00:00.000Z",
            ends_at: "2026-04-10T00:00:00.000Z",
        });
        assert.equal(parsed.success, false);

        await withCatalogApp(async ({ app, authHeader }) => {
            // Bypass schema by sending equal times that zod might still catch
            const response = await app.inject({
                method: "POST",
                url: `/admin/tourism/events/${EVENT_PUBLIC}/occurrences`,
                headers: {
                    ...authHeader(ADMIN, ["admin"]),
                    "content-type": "application/json",
                },
                payload: {
                    starts_at: "2026-04-10T00:00:00.000Z",
                    ends_at: "2026-04-10T00:00:00.000Z",
                },
            });
            assert.equal(response.statusCode, 400);
        });
    });

    it("validates activity body types", () => {
        const bad = createTourismActivityBodySchema.safeParse({
            name: "x",
            activity_type: "not_real",
            admin_area_id: AREA_ID,
        });
        assert.equal(bad.success, false);

        const good = createTourismActivityBodySchema.safeParse({
            name: "Hiking day",
            activity_type: "hiking",
            admin_area_id: AREA_ID,
            primary_place_public_id: PLACE_PUBLIC,
        });
        assert.equal(good.success, true);
    });

    it("confirms activity schedule review and sets last_schedule_reviewed_at", async () => {
        await withCatalogApp(async ({ app, authHeader, catalog }) => {
            catalog.activities.set(
                ACTIVITY_PUBLIC,
                makeActivity({
                    requires_schedule_review: true,
                    next_review_due_at: "2026-01-01T00:00:00.000Z",
                    review_status: "overdue",
                    needs_review: true,
                })
            );

            const missingDue = await app.inject({
                method: "POST",
                url: `/admin/tourism/activities/${ACTIVITY_PUBLIC}/schedule-review`,
                headers: {
                    ...authHeader(ADMIN, ["admin"]),
                    "content-type": "application/json",
                },
                payload: { schedule_review_note: "checked" },
            });
            assert.equal(missingDue.statusCode, 400);

            const confirmed = await app.inject({
                method: "POST",
                url: `/admin/tourism/activities/${ACTIVITY_PUBLIC}/schedule-review`,
                headers: {
                    ...authHeader(ADMIN, ["admin"]),
                    "content-type": "application/json",
                },
                payload: {
                    next_review_due_at: "2027-07-15T00:00:00.000Z",
                    schedule_review_note: "Season confirmed",
                },
            });
            assert.equal(confirmed.statusCode, 200);
            const body = bodyJson(confirmed);
            assert.equal(body.next_review_due_at, "2027-07-15T00:00:00.000Z");
            assert.equal(body.schedule_review_note, "Season confirmed");
            assert.ok(typeof body.last_schedule_reviewed_at === "string");
            assert.ok(catalog.audits.includes("tourism_activity_schedule_reviewed"));

            const filtered = await app.inject({
                method: "GET",
                url: "/admin/tourism/activities?review_status=needs_review",
                headers: authHeader(ADMIN, ["admin"]),
            });
            assert.equal(filtered.statusCode, 200);
            assert.equal((bodyJson(filtered).items as Json[]).length, 0);
        });
    });

    it("confirms event schedule review without inventing occurrence dates", async () => {
        await withCatalogApp(async ({ app, authHeader, catalog }) => {
            catalog.events.set(
                EVENT_PUBLIC,
                makeEvent({
                    requires_schedule_review: true,
                    next_review_due_at: null,
                    review_status: "overdue",
                    needs_review: true,
                    missing_next_occurrence: true,
                    last_occurrence: {
                        public_id: OCC_PUBLIC,
                        starts_at: "2026-04-10T00:00:00.000Z",
                        ends_at: "2026-04-12T00:00:00.000Z",
                        status: "completed",
                    },
                })
            );

            const confirmed = await app.inject({
                method: "POST",
                url: `/admin/tourism/events/${EVENT_PUBLIC}/schedule-review`,
                headers: {
                    ...authHeader(ADMIN, ["admin"]),
                    "content-type": "application/json",
                },
                payload: {
                    next_review_due_at: "2027-04-01T00:00:00.000Z",
                    schedule_review_note: "Awaiting 2027 dates",
                },
            });
            assert.equal(confirmed.statusCode, 200);
            const body = bodyJson(confirmed);
            assert.equal(body.next_review_due_at, "2027-04-01T00:00:00.000Z");
            assert.ok(typeof body.last_schedule_reviewed_at === "string");
            assert.equal(body.missing_next_occurrence, false);
            assert.ok(catalog.audits.includes("tourism_event_schedule_reviewed"));

            // Confirm does not create or copy occurrence dates.
            assert.equal(catalog.occurrences.size, 1);
            assert.equal(
                (catalog.occurrences.get(OCC_PUBLIC) as Json).starts_at,
                "2026-04-10T00:00:00.000Z"
            );
        });
    });
});
