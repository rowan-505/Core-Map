import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

import authPlugin from "../../plugins/auth.js";
import placeReviewsRoutes from "../place-reviews/place-reviews.routes.js";
import { PlaceReviewsService } from "../place-reviews/place-reviews.service.js";
import tourismRoutes from "./tourism.routes.js";
import { TourismReviewsService } from "./tourism.service.js";
import type { TourismReviewsRepository } from "./tourism.repo.js";
import type { PlaceReviewsRepository } from "../place-reviews/place-reviews.repo.js";
import {
    FakeTourismReviewsRepository,
    TOURISM_TEST_ADMIN,
    TOURISM_TEST_PLACE_PUBLIC,
    TOURISM_TEST_REVIEW_PUBLIC,
    TOURISM_TEST_USER_A,
    TOURISM_TEST_USER_B,
    tourismTestPlaceCore,
    tourismTestProfileRow,
    tourismTestReviewRow,
} from "./tourism.test-fixtures.js";

type Json = Record<string, unknown>;

async function withTourismApp(
    run: (ctx: {
        app: ReturnType<typeof Fastify>;
        repo: FakeTourismReviewsRepository;
        authHeader: (publicId: string, roles?: string[]) => { authorization: string };
    }) => Promise<void>
) {
    const previous = {
        JWT_SECRET: process.env.JWT_SECRET,
        AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET,
        AUTH_BYPASS: process.env.AUTH_BYPASS,
        NODE_ENV: process.env.NODE_ENV,
    };
    process.env.JWT_SECRET = "tourism-integration-test-secret";
    process.env.AUTH_JWT_SECRET = "tourism-integration-test-secret";
    delete process.env.AUTH_BYPASS;
    process.env.NODE_ENV = "test";

    const repo = new FakeTourismReviewsRepository();
    const tourismService = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
    const placeReviewsService = new PlaceReviewsService(
        repo as unknown as PlaceReviewsRepository
    );
    const app = Fastify();

    try {
        await app.register(rateLimit, { global: false });
        await app.register(authPlugin);
        await app.register(tourismRoutes, { service: tourismService });
        await app.register(placeReviewsRoutes, { service: placeReviewsService });
        await app.ready();

        const authHeader = (publicId: string, roles: string[] = ["user"]) => ({
            authorization: `Bearer ${app.jwt.sign({
                sub: publicId,
                email: `${publicId}@example.com`,
                roles,
            })}`,
        });

        await run({ app, repo, authHeader });
    } finally {
        await app.close();
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

function bodyJson(response: { body: string }): Json {
    return JSON.parse(response.body) as Json;
}

describe("tourism reviews HTTP integration", () => {
    it("lists active tourism taxonomy publicly", async () => {
        await withTourismApp(async ({ app }) => {
            const response = await app.inject({
                method: "GET",
                url: "/tourism/types",
            });
            assert.equal(response.statusCode, 200);
            const items = bodyJson(response).items as Json[];
            assert.equal(items[0]?.code, "attraction");
            assert.equal(items[0]?.name_en, "Attraction");
            assert.equal(items[0]?.sort_order, 10);
        });
    });

    it("rejects unauthenticated create/update/delete/my-review", async () => {
        await withTourismApp(async ({ app }) => {
            const create = await app.inject({
                method: "POST",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/reviews`,
                payload: { rating: 5 },
            });
            assert.equal(create.statusCode, 401);

            const mine = await app.inject({
                method: "GET",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/my-review`,
            });
            assert.equal(mine.statusCode, 401);

            const patch = await app.inject({
                method: "PATCH",
                url: `/reviews/22222222-2222-4222-8222-222222222222`,
                payload: { rating: 4 },
            });
            assert.equal(patch.statusCode, 401);

            const del = await app.inject({
                method: "DELETE",
                url: `/reviews/22222222-2222-4222-8222-222222222222`,
            });
            assert.equal(del.statusCode, 401);
        });
    });

    it("allows public list without auth and creates a pending review when authenticated", async () => {
        await withTourismApp(async ({ app, authHeader }) => {
            const publicList = await app.inject({
                method: "GET",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/reviews`,
            });
            assert.equal(publicList.statusCode, 200);
            const empty = bodyJson(publicList);
            assert.deepEqual(empty.items, []);
            assert.equal(empty.next_cursor, null);

            const created = await app.inject({
                method: "POST",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/reviews`,
                headers: authHeader(TOURISM_TEST_USER_A),
                payload: { rating: 5, title: "Great visit" },
            });
            assert.equal(created.statusCode, 201);
            const review = bodyJson(created);
            assert.equal(review.status, "pending");
            assert.equal(review.rating, 5);
            assert.equal(review.title, "Great visit");
            assert.ok(!("password" in review));
            assert.ok(!("password_hash" in review));
            assert.ok(!("id" in review));
            assert.ok(!("user_id" in review));
            assert.ok(!("place_id" in review));
            assert.equal(typeof review.public_id, "string");
            assert.equal((review.author as Json).public_id, TOURISM_TEST_USER_A);
        });
    });

    it("returns clear duplicate-review errors", async () => {
        await withTourismApp(async ({ app, authHeader }) => {
            const headers = authHeader(TOURISM_TEST_USER_A);
            const first = await app.inject({
                method: "POST",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/reviews`,
                headers,
                payload: { rating: 5 },
            });
            assert.equal(first.statusCode, 201);

            const second = await app.inject({
                method: "POST",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/reviews`,
                headers,
                payload: { rating: 4 },
            });
            assert.equal(second.statusCode, 409);
            const err = bodyJson(second);
            assert.equal(err.code, "DUPLICATE_REVIEW");
            assert.match(String(err.message), /already have a review/i);
        });
    });

    it("allows author update and rejects non-author update", async () => {
        await withTourismApp(async ({ app, authHeader }) => {
            const created = await app.inject({
                method: "POST",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/reviews`,
                headers: authHeader(TOURISM_TEST_USER_A),
                payload: { rating: 5, title: "First" },
            });
            const reviewId = String(bodyJson(created).public_id);

            const updated = await app.inject({
                method: "PATCH",
                url: `/reviews/${reviewId}`,
                headers: authHeader(TOURISM_TEST_USER_A),
                payload: { rating: 4, title: "Updated" },
            });
            assert.equal(updated.statusCode, 200);
            assert.equal(bodyJson(updated).rating, 4);
            assert.equal(bodyJson(updated).title, "Updated");

            const denied = await app.inject({
                method: "PATCH",
                url: `/reviews/${reviewId}`,
                headers: authHeader(TOURISM_TEST_USER_B),
                payload: { rating: 1 },
            });
            assert.equal(denied.statusCode, 403);
            assert.equal(bodyJson(denied).code, "FORBIDDEN");
        });
    });

    it("allows author deletion", async () => {
        await withTourismApp(async ({ app, authHeader }) => {
            const created = await app.inject({
                method: "POST",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/reviews`,
                headers: authHeader(TOURISM_TEST_USER_A),
                payload: { rating: 5 },
            });
            const reviewId = String(bodyJson(created).public_id);

            const deleted = await app.inject({
                method: "DELETE",
                url: `/reviews/${reviewId}`,
                headers: authHeader(TOURISM_TEST_USER_A),
            });
            assert.equal(deleted.statusCode, 200);
            assert.equal(bodyJson(deleted).status, "deleted");

            const mine = await app.inject({
                method: "GET",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/my-review`,
                headers: authHeader(TOURISM_TEST_USER_A),
            });
            assert.equal(mine.statusCode, 200);
            assert.equal(mine.body, "null");
        });
    });

    it("exposes only published reviews on the public list", async () => {
        await withTourismApp(async ({ app, authHeader, repo }) => {
            const pending = await app.inject({
                method: "POST",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/reviews`,
                headers: authHeader(TOURISM_TEST_USER_A),
                payload: { rating: 5, title: "Pending only" },
            });
            assert.equal(pending.statusCode, 201);
            const pendingId = String(bodyJson(pending).public_id);

            repo.reviews.set(
                "pub-1",
                tourismTestReviewRow({
                    id: 99n,
                    publicId: "55555555-5555-4555-8555-555555555555",
                    userId: 20n,
                    authorPublicId: TOURISM_TEST_USER_B,
                    status: "published",
                    rating: 4,
                    title: "Published",
                    createdAt: new Date("2026-09-20T00:00:00.000Z"),
                    publishedAt: new Date("2026-09-20T00:00:00.000Z"),
                })
            );

            const list = await app.inject({
                method: "GET",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/reviews`,
            });
            assert.equal(list.statusCode, 200);
            const page = bodyJson(list);
            const items = page.items as Json[];
            assert.equal(items.length, 1);
            assert.equal(items[0]?.title, "Published");
            assert.equal(items[0]?.status, "published");
            assert.ok(!("moderation_note" in (items[0] ?? {})));

            const authorSeesPending = await app.inject({
                method: "GET",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/my-review`,
                headers: authHeader(TOURISM_TEST_USER_A),
            });
            assert.equal(authorSeesPending.statusCode, 200);
            assert.equal(bodyJson(authorSeesPending).public_id, pendingId);
            assert.equal(bodyJson(authorSeesPending).status, "pending");

            const otherCannotSeePending = await app.inject({
                method: "GET",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/my-review`,
                headers: authHeader(TOURISM_TEST_USER_B),
            });
            assert.equal(otherCannotSeePending.statusCode, 200);
            assert.equal(otherCannotSeePending.body, "null");
        });
    });

    it("paginates public reviews with stable ordering", async () => {
        await withTourismApp(async ({ app, repo }) => {
            for (let i = 1; i <= 3; i += 1) {
                const publicId = `66666666-6666-4666-8666-${String(i).padStart(12, "0")}`;
                repo.reviews.set(
                    publicId,
                    tourismTestReviewRow({
                        id: BigInt(i),
                        publicId,
                        status: "published",
                        title: `R${i}`,
                        createdAt: new Date(`2026-09-${10 + i}T00:00:00.000Z`),
                        publishedAt: new Date(`2026-09-${10 + i}T00:00:00.000Z`),
                    })
                );
            }

            const page1 = await app.inject({
                method: "GET",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/reviews?limit=2`,
            });
            assert.equal(page1.statusCode, 200);
            const first = bodyJson(page1);
            const firstItems = first.items as Json[];
            assert.equal(firstItems.length, 2);
            assert.equal(firstItems[0]?.title, "R3");
            assert.equal(firstItems[1]?.title, "R2");
            assert.equal(typeof first.next_cursor, "string");

            const page2 = await app.inject({
                method: "GET",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/reviews?limit=2&cursor=${encodeURIComponent(String(first.next_cursor))}`,
            });
            assert.equal(page2.statusCode, 200);
            const second = bodyJson(page2);
            const secondItems = second.items as Json[];
            assert.equal(secondItems.length, 1);
            assert.equal(secondItems[0]?.title, "R1");
            assert.equal(second.next_cursor, null);
        });
    });

    it("updates rating summary when a review is published", async () => {
        await withTourismApp(async ({ app, authHeader, repo }) => {
            const created = await app.inject({
                method: "POST",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/reviews`,
                headers: authHeader(TOURISM_TEST_USER_A),
                payload: { rating: 5 },
            });
            assert.equal(created.statusCode, 201);
            const reviewId = String(bodyJson(created).public_id);
            assert.ok(repo.refreshCalls.includes(100n));

            const moderated = await app.inject({
                method: "POST",
                url: `/admin/reviews/${reviewId}/publish`,
                headers: authHeader(TOURISM_TEST_ADMIN, ["admin"]),
                payload: { note: "Approved" },
            });
            assert.equal(moderated.statusCode, 200);
            assert.equal(bodyJson(moderated).status, "published");

            const summary = await app.inject({
                method: "POST",
                url: `/admin/places/${TOURISM_TEST_PLACE_PUBLIC}/rating-summary/refresh`,
                headers: authHeader(TOURISM_TEST_ADMIN, ["admin"]),
            });
            assert.equal(summary.statusCode, 200);
            const payload = bodyJson(summary);
            assert.equal(payload.published_review_count, 1);
            assert.equal(payload.average_rating, 5);
            assert.equal(payload.place_public_id, TOURISM_TEST_PLACE_PUBLIC);
        });
    });

    it("enforces admin role checks on moderation endpoints", async () => {
        await withTourismApp(async ({ app, authHeader, repo }) => {
            repo.reviews.set(
                TOURISM_TEST_REVIEW_PUBLIC,
                tourismTestReviewRow({ status: "pending" })
            );

            const paths = [
                { method: "GET" as const, url: "/admin/reviews" },
                {
                    method: "GET" as const,
                    url: `/admin/reviews/${TOURISM_TEST_REVIEW_PUBLIC}`,
                },
                {
                    method: "POST" as const,
                    url: `/admin/reviews/${TOURISM_TEST_REVIEW_PUBLIC}/publish`,
                },
                {
                    method: "POST" as const,
                    url: `/admin/reviews/${TOURISM_TEST_REVIEW_PUBLIC}/reject`,
                },
                {
                    method: "POST" as const,
                    url: `/admin/reviews/${TOURISM_TEST_REVIEW_PUBLIC}/hide`,
                },
                {
                    method: "POST" as const,
                    url: `/admin/reviews/${TOURISM_TEST_REVIEW_PUBLIC}/restore`,
                },
            ];

            for (const path of paths) {
                const unauth = await app.inject({
                    method: path.method,
                    url: path.url,
                    payload: path.method === "POST" ? {} : undefined,
                });
                assert.equal(unauth.statusCode, 401, path.url);

                const user = await app.inject({
                    method: path.method,
                    url: path.url,
                    headers: authHeader(TOURISM_TEST_USER_A, ["user"]),
                    payload: path.method === "POST" ? {} : undefined,
                });
                assert.equal(user.statusCode, 403, path.url);

                const viewer = await app.inject({
                    method: path.method,
                    url: path.url,
                    headers: authHeader(TOURISM_TEST_USER_A, ["viewer"]),
                    payload: path.method === "POST" ? {} : undefined,
                });
                assert.equal(viewer.statusCode, 403, path.url);
            }

            const allowed = await app.inject({
                method: "GET",
                url: "/admin/reviews",
                headers: authHeader(TOURISM_TEST_ADMIN, ["admin"]),
            });
            assert.equal(allowed.statusCode, 200);

            const superAdmin = await app.inject({
                method: "POST",
                url: `/admin/reviews/${TOURISM_TEST_REVIEW_PUBLIC}/publish`,
                headers: authHeader(TOURISM_TEST_ADMIN, ["super_admin"]),
                payload: {},
            });
            assert.equal(superAdmin.statusCode, 200);
            assert.equal(bodyJson(superAdmin).status, "published");
        });
    });

    it("supports admin list filters and action transitions", async () => {
        await withTourismApp(async ({ app, authHeader, repo }) => {
            repo.reviews.set(
                TOURISM_TEST_REVIEW_PUBLIC,
                tourismTestReviewRow({ status: "pending" })
            );
            repo.reviews.set(
                "55555555-5555-4555-8555-555555555555",
                tourismTestReviewRow({
                    id: 2n,
                    publicId: "55555555-5555-4555-8555-555555555555",
                    userId: 20n,
                    authorPublicId: TOURISM_TEST_USER_B,
                    status: "published",
                    publishedAt: new Date("2026-09-10T00:00:00.000Z"),
                    createdAt: new Date("2026-09-10T00:00:00.000Z"),
                })
            );

            const list = await app.inject({
                method: "GET",
                url: `/admin/reviews?status=pending&placeId=${TOURISM_TEST_PLACE_PUBLIC}&authorId=${TOURISM_TEST_USER_A}`,
                headers: authHeader(TOURISM_TEST_ADMIN, ["admin"]),
            });
            assert.equal(list.statusCode, 200);
            const items = bodyJson(list).items as Json[];
            assert.equal(items.length, 1);
            assert.equal(items[0]?.public_id, TOURISM_TEST_REVIEW_PUBLIC);

            const publish = await app.inject({
                method: "POST",
                url: `/admin/reviews/${TOURISM_TEST_REVIEW_PUBLIC}/publish`,
                headers: authHeader(TOURISM_TEST_ADMIN, ["admin"]),
                payload: {},
            });
            assert.equal(publish.statusCode, 200);
            assert.equal(bodyJson(publish).status, "published");

            const idempotent = await app.inject({
                method: "POST",
                url: `/admin/reviews/${TOURISM_TEST_REVIEW_PUBLIC}/publish`,
                headers: authHeader(TOURISM_TEST_ADMIN, ["admin"]),
                payload: {},
            });
            assert.equal(idempotent.statusCode, 200);
            assert.equal(repo.moderationEvents.length, 1);

            const hide = await app.inject({
                method: "POST",
                url: `/admin/reviews/${TOURISM_TEST_REVIEW_PUBLIC}/hide`,
                headers: authHeader(TOURISM_TEST_ADMIN, ["admin"]),
                payload: { note: "Temp hide" },
            });
            assert.equal(hide.statusCode, 200);
            assert.equal(bodyJson(hide).status, "hidden");

            const restore = await app.inject({
                method: "POST",
                url: `/admin/reviews/${TOURISM_TEST_REVIEW_PUBLIC}/restore`,
                headers: authHeader(TOURISM_TEST_ADMIN, ["admin"]),
                payload: {},
            });
            assert.equal(restore.statusCode, 200);
            assert.equal(bodyJson(restore).status, "published");

            const detail = await app.inject({
                method: "GET",
                url: `/admin/reviews/${TOURISM_TEST_REVIEW_PUBLIC}`,
                headers: authHeader(TOURISM_TEST_ADMIN, ["admin"]),
            });
            assert.equal(detail.statusCode, 200);
            const history = bodyJson(detail).moderation_history as Json[];
            assert.equal(history.length, 3);

            repo.reviews.set(
                TOURISM_TEST_REVIEW_PUBLIC,
                tourismTestReviewRow({ status: "deleted" })
            );
            const restoreDeleted = await app.inject({
                method: "POST",
                url: `/admin/reviews/${TOURISM_TEST_REVIEW_PUBLIC}/restore`,
                headers: authHeader(TOURISM_TEST_ADMIN, ["admin"]),
                payload: {},
            });
            assert.equal(restoreDeleted.statusCode, 409);
            assert.equal(bodyJson(restoreDeleted).code, "DELETED");

            const restorePending = await app.inject({
                method: "POST",
                url: `/admin/reviews/55555555-5555-4555-8555-555555555555/restore`,
                headers: authHeader(TOURISM_TEST_ADMIN, ["admin"]),
                payload: {},
            });
            assert.equal(restorePending.statusCode, 409);
            assert.equal(bodyJson(restorePending).code, "INVALID_TRANSITION");
        });
    });

    it("returns validation errors for bad payloads", async () => {
        await withTourismApp(async ({ app, authHeader }) => {
            const bad = await app.inject({
                method: "POST",
                url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/reviews`,
                headers: authHeader(TOURISM_TEST_USER_A),
                payload: { rating: 9, title: "   " },
            });
            assert.equal(bad.statusCode, 400);
            const payload = bodyJson(bad);
            // Fastify OpenAPI schema may reject before Zod; both are clear validation errors.
            assert.ok(
                /must be <= 5|invalid place review payload/i.test(String(payload.message))
            );
        });
    });

    it("serves public tourism profiles and enforces admin profile writes", async () => {
        await withTourismApp(async ({ app, authHeader, repo }) => {
            const missing = await app.inject({
                method: "GET",
                url: `/tourism/places/${TOURISM_TEST_PLACE_PUBLIC}`,
            });
            assert.equal(missing.statusCode, 404);
            assert.equal(bodyJson(missing).code, "PROFILE_NOT_FOUND");

            const unauthorized = await app.inject({
                method: "POST",
                url: `/admin/tourism/places/${TOURISM_TEST_PLACE_PUBLIC}/profile`,
                headers: authHeader(TOURISM_TEST_USER_A, ["user"]),
                payload: { tourism_type: "attraction" },
            });
            assert.equal(unauthorized.statusCode, 403);

            const created = await app.inject({
                method: "POST",
                url: `/admin/tourism/places/${TOURISM_TEST_PLACE_PUBLIC}/profile`,
                headers: authHeader(TOURISM_TEST_ADMIN, ["admin"]),
                payload: {
                    tourism_type: "attraction",
                    short_description: "Iconic",
                    price_level: 2,
                    editor_pick: true,
                    editorial_score: 80,
                    manual_boost: 4,
                    manual_boost_reason: "Temporary festival corridor boost",
                    season_mode: "best_months",
                    season_start_month: 11,
                    season_end_month: 2,
                },
            });
            assert.equal(created.statusCode, 201);
            assert.equal(bodyJson(created).tourism_type, "attraction");
            assert.equal(bodyJson(created).editor_pick, true);
            assert.equal(bodyJson(created).tourism_type_name_en, "Attraction");
            assert.equal(bodyJson(created).editorial_score, 80);
            assert.equal(bodyJson(created).manual_boost, 4);
            assert.equal(bodyJson(created).importance_score, 75);

            const publicGet = await app.inject({
                method: "GET",
                url: `/tourism/places/${TOURISM_TEST_PLACE_PUBLIC}?lang=en`,
            });
            assert.equal(publicGet.statusCode, 200);
            assert.equal(bodyJson(publicGet).name, "Shwedagon Pagoda");
            assert.equal(bodyJson(publicGet).tourism_type, "attraction");
            assert.equal(bodyJson(publicGet).tourism_type_name_en, "Attraction");
            assert.ok(!("importance_score" in bodyJson(publicGet)));
            assert.ok(!("is_public" in bodyJson(publicGet)));

            const myGet = await app.inject({
                method: "GET",
                url: `/tourism/places/${TOURISM_TEST_PLACE_PUBLIC}?lang=my`,
            });
            assert.equal(bodyJson(myGet).name, "ရွှေတိဂုံ");

            const patched = await app.inject({
                method: "PATCH",
                url: `/admin/tourism/places/${TOURISM_TEST_PLACE_PUBLIC}/profile`,
                headers: authHeader(TOURISM_TEST_ADMIN, ["admin"]),
                payload: {
                    is_public: false,
                    price_level: 1,
                    manual_boost: -3,
                    manual_boost_reason: "Correct over-boost after review",
                },
            });
            assert.equal(patched.statusCode, 200);
            assert.equal(bodyJson(patched).is_public, false);
            assert.equal(bodyJson(patched).manual_boost, -3);

            const hidden = await app.inject({
                method: "GET",
                url: `/tourism/places/${TOURISM_TEST_PLACE_PUBLIC}`,
            });
            assert.equal(hidden.statusCode, 404);
            assert.equal(bodyJson(hidden).code, "PROFILE_NOT_PUBLIC");

            repo.profiles.set(100n, tourismTestProfileRow({ isPublic: true }));
            repo.placeCores.set(
                TOURISM_TEST_PLACE_PUBLIC,
                tourismTestPlaceCore({ placeDeletedAt: new Date("2026-09-02T00:00:00.000Z") })
            );
            const deletedPlace = await app.inject({
                method: "GET",
                url: `/tourism/places/${TOURISM_TEST_PLACE_PUBLIC}`,
            });
            assert.equal(deletedPlace.statusCode, 404);
            assert.equal(bodyJson(deletedPlace).code, "PLACE_NOT_FOUND");
        });
    });

    it("lists ranked tourism places by mode", async () => {
        await withTourismApp(async ({ app, repo }) => {
            repo.profiles.set(100n, tourismTestProfileRow({ editorPick: true }));
            repo.summaries.set(100n, {
                placeId: 100n,
                placePublicId: TOURISM_TEST_PLACE_PUBLIC,
                publishedReviewCount: 5,
                averageRating: "4.80",
                updatedAt: new Date(),
            });
            for (let i = 1; i <= 5; i += 1) {
                const publicId = `99999999-9999-4999-8999-${String(i).padStart(12, "0")}`;
                repo.reviews.set(
                    publicId,
                    tourismTestReviewRow({
                        id: BigInt(i),
                        publicId,
                        rating: 5,
                        status: "published",
                    })
                );
            }

            const recommended = await app.inject({
                method: "GET",
                url: "/tourism/places?mode=recommended&limit=10",
            });
            assert.equal(recommended.statusCode, 200);
            const page = bodyJson(recommended);
            assert.equal(page.mode, "recommended");
            assert.ok(Array.isArray(page.items));
            assert.equal((page.items as Json[])[0]?.public_id, TOURISM_TEST_PLACE_PUBLIC);
            assert.equal((page.items as Json[])[0]?.published_review_count, 5);
            assert.ok(!("bayesian_score" in ((page.items as Json[])[0] ?? {})));

            const nearbyMissing = await app.inject({
                method: "GET",
                url: "/tourism/places?mode=nearby",
            });
            assert.equal(nearbyMissing.statusCode, 400);

            const nearby = await app.inject({
                method: "GET",
                url: "/tourism/places?mode=nearby&lat=16.7982&lng=96.1498&radius_m=5000",
            });
            assert.equal(nearby.statusCode, 200);
            assert.equal(bodyJson(nearby).mode, "nearby");

            const picks = await app.inject({
                method: "GET",
                url: "/tourism/places?mode=editor_picks",
            });
            assert.equal(picks.statusCode, 200);
            assert.ok((bodyJson(picks).items as Json[]).every((item) => item.editor_pick === true));
        });
    });

    it("rate-limits authenticated review creation", async () => {
        await withTourismApp(async ({ app, authHeader }) => {
            const headers = authHeader(TOURISM_TEST_USER_A);
            let sawTooMany = false;
            // Rate limit counts attempts (including duplicate 409s).
            for (let i = 0; i < 21; i += 1) {
                const response = await app.inject({
                    method: "POST",
                    url: `/places/${TOURISM_TEST_PLACE_PUBLIC}/reviews`,
                    headers,
                    payload: { rating: 4, title: `rate-${i}` },
                });
                if (response.statusCode === 429) {
                    sawTooMany = true;
                    break;
                }
                assert.ok(
                    response.statusCode === 201 || response.statusCode === 409,
                    `unexpected status ${response.statusCode}`
                );
            }
            assert.equal(sawTooMany, true);
        });
    });
});
