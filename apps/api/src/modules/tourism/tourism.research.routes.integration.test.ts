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
import {
    TourismResearchService,
    mapResearchPayloadToPrefill,
} from "./tourism.research.service.js";
import { TourismReviewsError } from "./tourism.errors.js";
import {
    bulkImportTourismResearchBodySchema,
    listAdminTourismResearchQuerySchema,
} from "./tourism.research.schema.js";
import {
    FakeTourismReviewsRepository,
    TOURISM_TEST_ADMIN,
} from "./tourism.test-fixtures.js";

const ADMIN = TOURISM_TEST_ADMIN;
const AREA = "1001";
const CANDIDATE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Json = Record<string, unknown>;

function makeCandidate(overrides: Partial<Json> = {}): Json {
    return {
        public_id: CANDIDATE_ID,
        admin_area_id: AREA,
        admin_area_name: "Kyauktan",
        entity_type: "food",
        name: "Mohinga",
        research_status: "new",
        evidence_confidence: 72,
        research_provider: "manual",
        research_run_id: "run-1",
        candidate_key: "food:mohinga",
        researched_at: "2026-06-01T00:00:00.000Z",
        reviewed_by_public_id: null,
        reviewed_at: null,
        created_entity_type: null,
        created_entity_public_id: null,
        source_count: 1,
        latest_source_date: "2026-05-01T00:00:00.000Z",
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
        normalized_payload: {
            description: "Rice noodle fish soup",
            food_type: "dish",
            labels: ["must_try"],
            sources: [
                {
                    url: "https://example.com/mohinga",
                    title: "Guide",
                    published_at: "2026-05-01T00:00:00.000Z",
                },
            ],
            uncertainties: ["Exact origin unclear"],
            conflicts: [],
        },
        evidence: {
            description: "Rice noodle fish soup",
            short_description: null,
            reference_scores: null,
            editorial_recommendation: null,
            sources: [
                {
                    url: "https://example.com/mohinga",
                    title: "Guide",
                    published_at: "2026-05-01T00:00:00.000Z",
                },
            ],
            uncertainties: ["Exact origin unclear"],
            conflicts: [],
            aliases: [],
            notes: null,
        },
        ...overrides,
    };
}

class FakeResearchService {
    candidates = new Map<string, Json>([[CANDIDATE_ID, makeCandidate()]]);

    async list(query: {
        admin_area_id?: string;
        entity_type?: string;
        research_status?: string;
        q?: string;
        evidence_confidence_min?: number;
    }) {
        let items = [...this.candidates.values()];
        if (query.admin_area_id) {
            items = items.filter((row) => row.admin_area_id === query.admin_area_id);
        }
        if (query.entity_type) {
            items = items.filter((row) => row.entity_type === query.entity_type);
        }
        if (query.research_status) {
            items = items.filter((row) => row.research_status === query.research_status);
        }
        if (query.q) {
            items = items.filter((row) =>
                String(row.name).toLowerCase().includes(query.q!.toLowerCase())
            );
        }
        if (query.evidence_confidence_min !== undefined) {
            items = items.filter(
                (row) =>
                    typeof row.evidence_confidence === "number" &&
                    row.evidence_confidence >= query.evidence_confidence_min!
            );
        }
        return { items, total: items.length, limit: 20, offset: 0 };
    }

    async get(id: string) {
        const row = this.candidates.get(id);
        if (!row) {
            throw new TourismReviewsError(
                "Research candidate not found",
                404,
                "RESEARCH_CANDIDATE_NOT_FOUND"
            );
        }
        return row;
    }

    async getPrefill(id: string) {
        const candidate = await this.get(id);
        return {
            candidate,
            prefill: mapResearchPayloadToPrefill(
                String(candidate.entity_type),
                String(candidate.name),
                String(candidate.admin_area_id),
                candidate.normalized_payload as never
            ),
            target_form:
                candidate.entity_type === "food"
                    ? "tourism_food"
                    : candidate.entity_type === "local_guide"
                      ? "tourism_local_guide"
                      : candidate.entity_type === "advisory"
                        ? "tourism_advisory"
                        : "other",
        };
    }

    async bulkImport(_actor: string, body: { candidates: Json[] }) {
        const created: Json[] = [];
        for (const [index, item] of body.candidates.entries()) {
            const publicId = `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${index}`;
            const row = makeCandidate({
                ...item,
                public_id: publicId,
                research_status: item.research_status ?? "new",
                candidate_key: item.candidate_key ?? `key-${index}`,
            });
            this.candidates.set(publicId, row);
            created.push(row);
        }
        return { imported: created.length, updated: 0, skipped: 0, items: created };
    }

    async updateStatus(_actor: string, id: string, body: Json) {
        const existing = await this.get(id);
        if (existing.research_status === "added" && body.research_status !== "added") {
            throw new TourismReviewsError(
                "Added research candidates cannot change status",
                409,
                "RESEARCH_ALREADY_ADDED"
            );
        }
        const next = {
            ...existing,
            research_status: body.research_status,
            created_entity_type: body.created_entity_type ?? null,
            created_entity_public_id: body.created_entity_public_id ?? null,
            reviewed_at: "2026-06-15T00:00:00.000Z",
        };
        this.candidates.set(id, next);
        return next;
    }

    async markReviewing(actor: string, id: string) {
        return this.updateStatus(actor, id, { research_status: "reviewing" });
    }

    async markRejected(actor: string, id: string) {
        return this.updateStatus(actor, id, { research_status: "rejected" });
    }

    async markNeedsResearch(actor: string, id: string) {
        return this.updateStatus(actor, id, { research_status: "needs_research" });
    }

    async markAdded(actor: string, id: string, body: Json) {
        return this.updateStatus(actor, id, {
            research_status: "added",
            created_entity_type: body.created_entity_type,
            created_entity_public_id: body.created_entity_public_id,
        });
    }
}

async function withResearchApp(
    run: (ctx: {
        app: ReturnType<typeof Fastify>;
        research: FakeResearchService;
        authHeader: (publicId: string, roles?: string[]) => { authorization: string };
    }) => Promise<void>
) {
    const previous = {
        JWT_SECRET: process.env.JWT_SECRET,
        AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
        AUTH_BYPASS: process.env.AUTH_BYPASS,
        NODE_ENV: process.env.NODE_ENV,
    };
    process.env.JWT_SECRET = "tourism-research-test-secret";
    process.env.AUTH_JWT_SECRET = "tourism-research-test-secret";
    delete process.env.AUTH_BYPASS;
    process.env.NODE_ENV = "test";

    const repo = new FakeTourismReviewsRepository();
    const tourismService = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
    const research = new FakeResearchService();
    const app = Fastify();

    try {
        await app.register(rateLimit, { global: false });
        await app.register(authPlugin);
        await app.register(tourismRoutes, {
            service: tourismService,
            catalogService: {} as unknown as TourismCatalogService,
            visitorService: {
                listPublicFoods: async () => ({ items: [], total: 0, limit: 20, offset: 0 }),
                listPublicGuides: async () => ({ items: [], total: 0, limit: 20, offset: 0 }),
                listPublicAdvisories: async () => ({ items: [], total: 0, limit: 20, offset: 0 }),
                getPublicFood: async () => {
                    throw new TourismReviewsError("Food not found", 404, "FOOD_NOT_FOUND");
                },
            } as unknown as TourismVisitorService,
            researchService: research as unknown as TourismResearchService,
        });
        await app.ready();

        const authHeader = (publicId: string, roles: string[] = ["user"]) => ({
            authorization: `Bearer ${app.jwt.sign({
                sub: publicId,
                email: `${publicId}@example.com`,
                roles,
            })}`,
        });

        await run({ app, research, authHeader });
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

describe("tourism research schema", () => {
    it("validates list filters and bulk import payload", () => {
        const list = listAdminTourismResearchQuerySchema.safeParse({
            admin_area_id: "1",
            entity_type: "food",
            research_status: "new",
            evidence_confidence_min: "50",
            q: "mohinga",
        });
        assert.equal(list.success, true);

        const ok = bulkImportTourismResearchBodySchema.safeParse({
            candidates: [
                {
                    admin_area_id: "1",
                    candidate_key: "food:mohinga",
                    entity_type: "food",
                    name: "Mohinga",
                    normalized_payload: {
                        food_type: "dish",
                        labels: ["must_try"],
                        sources: [{ url: "https://example.com/a", title: "A" }],
                    },
                    research_provider: "manual",
                    research_run_id: "run-1",
                    researched_at: "2026-06-01T00:00:00.000Z",
                },
            ],
        });
        assert.equal(ok.success, true);

        const byPublicId = bulkImportTourismResearchBodySchema.safeParse({
            candidates: [
                {
                    admin_area_public_id: "11111111-1111-4111-8111-111111111111",
                    candidate_key: "food:mohinga",
                    entity_type: "food",
                    name: "Mohinga",
                    normalized_payload: {
                        sources: [{ url: "https://example.com/a", title: "A" }],
                    },
                    research_provider: "gemini",
                    research_run_id: "interaction-1",
                    researched_at: "2026-06-01T00:00:00.000Z",
                },
            ],
        });
        assert.equal(byPublicId.success, true);

        const noSources = bulkImportTourismResearchBodySchema.safeParse({
            candidates: [
                {
                    admin_area_id: "1",
                    candidate_key: "food:mohinga",
                    entity_type: "food",
                    name: "Mohinga",
                    normalized_payload: { food_type: "dish", sources: [] },
                    research_provider: "manual",
                    research_run_id: "run-1",
                    researched_at: "2026-06-01T00:00:00.000Z",
                },
            ],
        });
        assert.equal(noSources.success, false);

        const bad = bulkImportTourismResearchBodySchema.safeParse({
            candidates: [
                {
                    admin_area_id: "1",
                    candidate_key: "food:mohinga",
                    entity_type: "food",
                    name: "Mohinga",
                    normalized_payload: { unexpected_field: true },
                    research_provider: "manual",
                    research_run_id: "run-1",
                    researched_at: "2026-06-01T00:00:00.000Z",
                },
            ],
        });
        assert.equal(bad.success, false);
    });
});

describe("mapResearchPayloadToPrefill", () => {
    it("prefills food, guide, and advisory forms", () => {
        const food = mapResearchPayloadToPrefill("food", "Mohinga", "1001", {
            food_type: "dish",
            labels: ["must_try"],
            short_description: "Soup",
        });
        assert.equal(food.food_type, "dish");
        assert.deepEqual(food.labels, ["must_try"]);
        assert.equal(food.admin_area_id, "1001");

        const guide = mapResearchPayloadToPrefill("local_guide", "Temple tips", "1001", {
            guide_type: "etiquette",
            title: "Temple tips",
            content: "Remove shoes",
        });
        assert.equal(guide.guide_type, "etiquette");
        assert.equal(guide.content, "Remove shoes");

        const advisory = mapResearchPayloadToPrefill("advisory", "Ferry delay", "1001", {
            advisory_type: "transport",
            severity: "caution",
            description: "Expect waits",
            effective_from: "2026-06-01T00:00:00.000Z",
        });
        assert.equal(advisory.severity, "caution");
        assert.equal(advisory.advisory_type, "transport");
    });
});

describe("tourism research routes", () => {
    it("requires admin for research endpoints", async () => {
        await withResearchApp(async ({ app, authHeader }) => {
            const anon = await app.inject({ method: "GET", url: "/admin/tourism/research" });
            assert.equal(anon.statusCode, 401);

            const user = await app.inject({
                method: "GET",
                url: "/admin/tourism/research",
                headers: authHeader(ADMIN, ["user"]),
            });
            assert.equal(user.statusCode, 403);
        });
    });

    it("lists and filters research candidates", async () => {
        await withResearchApp(async ({ app, authHeader, research }) => {
            research.candidates.set(
                "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                makeCandidate({
                    public_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    name: "Guide tip",
                    entity_type: "local_guide",
                    research_status: "reviewing",
                    evidence_confidence: 40,
                })
            );

            const filtered = await app.inject({
                method: "GET",
                url: `/admin/tourism/research?admin_area_id=${AREA}&entity_type=food&research_status=new&evidence_confidence_min=50`,
                headers: authHeader(ADMIN, ["admin"]),
            });
            assert.equal(filtered.statusCode, 200);
            const items = bodyJson(filtered).items as Json[];
            assert.equal(items.length, 1);
            assert.equal(items[0]?.name, "Mohinga");
        });
    });

    it("returns research detail and prefill mapping", async () => {
        await withResearchApp(async ({ app, authHeader }) => {
            const detail = await app.inject({
                method: "GET",
                url: `/admin/tourism/research/${CANDIDATE_ID}`,
                headers: authHeader(ADMIN, ["admin"]),
            });
            assert.equal(detail.statusCode, 200);
            assert.equal(bodyJson(detail).entity_type, "food");
            assert.ok(Array.isArray((bodyJson(detail).evidence as Json).sources));

            const prefill = await app.inject({
                method: "GET",
                url: `/admin/tourism/research/${CANDIDATE_ID}/prefill`,
                headers: authHeader(ADMIN, ["admin"]),
            });
            assert.equal(prefill.statusCode, 200);
            assert.equal(bodyJson(prefill).target_form, "tourism_food");
            assert.equal((bodyJson(prefill).prefill as Json).food_type, "dish");
        });
    });

    it("marks reviewing/rejected/needs_research and added only via explicit added endpoint", async () => {
        await withResearchApp(async ({ app, authHeader, research }) => {
            const reviewing = await app.inject({
                method: "POST",
                url: `/admin/tourism/research/${CANDIDATE_ID}/reviewing`,
                headers: authHeader(ADMIN, ["admin"]),
            });
            assert.equal(reviewing.statusCode, 200);
            assert.equal(bodyJson(reviewing).research_status, "reviewing");

            const rejected = await app.inject({
                method: "POST",
                url: `/admin/tourism/research/${CANDIDATE_ID}/reject`,
                headers: authHeader(ADMIN, ["admin"]),
            });
            assert.equal(rejected.statusCode, 200);
            assert.equal(bodyJson(rejected).research_status, "rejected");

            research.candidates.set(CANDIDATE_ID, makeCandidate({ research_status: "reviewing" }));

            const needs = await app.inject({
                method: "POST",
                url: `/admin/tourism/research/${CANDIDATE_ID}/needs-research`,
                headers: authHeader(ADMIN, ["admin"]),
            });
            assert.equal(needs.statusCode, 200);
            assert.equal(bodyJson(needs).research_status, "needs_research");

            research.candidates.set(CANDIDATE_ID, makeCandidate({ research_status: "reviewing" }));

            const badAdded = await app.inject({
                method: "POST",
                url: `/admin/tourism/research/${CANDIDATE_ID}/added`,
                headers: {
                    ...authHeader(ADMIN, ["admin"]),
                    "content-type": "application/json",
                },
                payload: {},
            });
            assert.equal(badAdded.statusCode, 400);

            const added = await app.inject({
                method: "POST",
                url: `/admin/tourism/research/${CANDIDATE_ID}/added`,
                headers: {
                    ...authHeader(ADMIN, ["admin"]),
                    "content-type": "application/json",
                },
                payload: {
                    created_entity_type: "food",
                    created_entity_public_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                },
            });
            assert.equal(added.statusCode, 200);
            assert.equal(bodyJson(added).research_status, "added");
            assert.equal(bodyJson(added).created_entity_type, "food");
        });
    });

    it("never exposes research candidates on public tourism endpoints", async () => {
        await withResearchApp(async ({ app }) => {
            const foods = await app.inject({ method: "GET", url: "/tourism/foods" });
            assert.equal(foods.statusCode, 200);
            assert.equal((bodyJson(foods).items as Json[]).length, 0);

            const leaked = await app.inject({
                method: "GET",
                url: "/tourism/research",
            });
            assert.ok(leaked.statusCode === 404 || leaked.statusCode === 400);
        });
    });
});
