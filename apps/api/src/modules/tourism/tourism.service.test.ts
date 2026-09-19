import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    createTourismReviewBodySchema,
    createTourismPlaceProfileBodySchema,
    decodeTourismReviewCursor,
    encodeTourismReviewCursor,
    InvalidTourismReviewCursorError,
    updateTourismReviewBodySchema,
    updateTourismPlaceProfileBodySchema,
} from "./tourism.schema.js";
import { resolveTourismAdminTransition } from "./tourism.moderation.js";
import { TourismReviewsError, TourismReviewsService } from "./tourism.service.js";
import type { TourismReviewsRepository } from "./tourism.repo.js";
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

describe("tourism.schema validation", () => {
    it("requires rating and trims optional text", () => {
        const parsed = createTourismReviewBodySchema.parse({
            rating: 4,
            title: "  Hello  ",
            body: "  World  ",
        });
        assert.equal(parsed.rating, 4);
        assert.equal(parsed.title, "Hello");
        assert.equal(parsed.body, "World");
    });

    it("rejects empty title after trim", () => {
        const result = createTourismReviewBodySchema.safeParse({
            rating: 3,
            title: "   ",
        });
        assert.equal(result.success, false);
    });

    it("rejects out-of-range rating", () => {
        assert.equal(createTourismReviewBodySchema.safeParse({ rating: 0 }).success, false);
        assert.equal(createTourismReviewBodySchema.safeParse({ rating: 6 }).success, false);
    });

    it("allows clearing title with null on update", () => {
        const parsed = updateTourismReviewBodySchema.parse({ title: null });
        assert.equal(parsed.title, null);
    });

    it("round-trips review cursors", () => {
        const encoded = encodeTourismReviewCursor({
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
            publicId: TOURISM_TEST_REVIEW_PUBLIC,
        });
        const decoded = decodeTourismReviewCursor(encoded);
        assert.equal(decoded.publicId, TOURISM_TEST_REVIEW_PUBLIC);
        assert.equal(decoded.createdAt.toISOString(), "2026-09-01T00:00:00.000Z");
    });

    it("rejects invalid cursors", () => {
        assert.throws(
            () => decodeTourismReviewCursor("not-a-cursor"),
            InvalidTourismReviewCursorError
        );
    });

    it("validates taxonomy and ranking profile fields", () => {
        const created = createTourismPlaceProfileBodySchema.parse({
            tourism_type: "attraction",
        });
        assert.equal(created.editorial_score, 50);
        assert.equal(created.manual_boost, 0);
        assert.equal(created.season_mode, "all_year");
        assert.equal(created.season_start_month, null);
        assert.equal(created.season_end_month, null);
        assert.equal(
            createTourismPlaceProfileBodySchema.safeParse({ tourism_type: "cafe" }).success,
            false
        );
        assert.equal(
            updateTourismPlaceProfileBodySchema.safeParse({ editorial_score: 51 }).success,
            false
        );
        assert.equal(
            updateTourismPlaceProfileBodySchema.safeParse({ manual_boost: 11 }).success,
            false
        );
        assert.equal(
            updateTourismPlaceProfileBodySchema.safeParse({ manual_boost: 3 }).success,
            false
        );
        assert.equal(
            updateTourismPlaceProfileBodySchema.safeParse({
                manual_boost: 3,
                manual_boost_reason: "Corridor correction",
            }).success,
            true
        );
        assert.equal(
            updateTourismPlaceProfileBodySchema.safeParse({ season_start_month: 13 }).success,
            false
        );
    });
});

describe("tourism.service", () => {
    it("creates a pending review and refreshes summary", async () => {
        const repo = new FakeTourismReviewsRepository();
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
        const created = await service.createReview(TOURISM_TEST_USER_A, TOURISM_TEST_PLACE_PUBLIC, {
            rating: 5,
            title: "Nice",
        });
        assert.equal(created.status, "pending");
        assert.equal(created.rating, 5);
        assert.equal(created.author.public_id, TOURISM_TEST_USER_A);
        assert.deepEqual(repo.refreshCalls, [100n]);
    });

    it("prevents duplicate active reviews", async () => {
        const repo = new FakeTourismReviewsRepository();
        const existing = tourismTestReviewRow();
        repo.reviews.set(existing.publicId, existing);
        repo.activeByPlaceUser.set("100:10", existing.publicId);
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);

        await assert.rejects(
            () => service.createReview(TOURISM_TEST_USER_A, TOURISM_TEST_PLACE_PUBLIC, { rating: 4 }),
            (error: unknown) =>
                error instanceof TourismReviewsError &&
                error.statusCode === 409 &&
                error.code === "DUPLICATE_REVIEW"
        );
    });

    it("blocks ownership violations on update and delete", async () => {
        const repo = new FakeTourismReviewsRepository();
        const existing = tourismTestReviewRow({ status: "pending" });
        repo.reviews.set(existing.publicId, existing);
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);

        await assert.rejects(
            () =>
                service.updateOwnReview(TOURISM_TEST_USER_B, TOURISM_TEST_REVIEW_PUBLIC, {
                    rating: 2,
                }),
            (error: unknown) =>
                error instanceof TourismReviewsError && error.statusCode === 403
        );
        await assert.rejects(
            () => service.softDeleteOwnReview(TOURISM_TEST_USER_B, TOURISM_TEST_REVIEW_PUBLIC),
            (error: unknown) =>
                error instanceof TourismReviewsError && error.statusCode === 403
        );
    });

    it("returns a published review to pending on edit", async () => {
        const repo = new FakeTourismReviewsRepository();
        const existing = tourismTestReviewRow({
            status: "published",
            publishedAt: new Date("2026-09-01T12:00:00.000Z"),
        });
        repo.reviews.set(existing.publicId, existing);
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);

        const updated = await service.updateOwnReview(
            TOURISM_TEST_USER_A,
            TOURISM_TEST_REVIEW_PUBLIC,
            { rating: 3 }
        );
        assert.equal(updated.status, "pending");
        assert.equal(updated.rating, 3);
        assert.equal(repo.moderationEvents.length, 1);
        assert.equal(repo.moderationEvents[0]?.toStatus, "pending");
        assert.deepEqual(repo.refreshCalls, [100n]);
    });

    it("soft-deletes own review and records moderation event", async () => {
        const repo = new FakeTourismReviewsRepository();
        const existing = tourismTestReviewRow({ status: "published" });
        repo.reviews.set(existing.publicId, existing);
        repo.activeByPlaceUser.set("100:10", existing.publicId);
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);

        const deleted = await service.softDeleteOwnReview(
            TOURISM_TEST_USER_A,
            TOURISM_TEST_REVIEW_PUBLIC
        );
        assert.equal(deleted.status, "deleted");
        assert.equal(repo.moderationEvents[0]?.toStatus, "deleted");
        assert.equal(await repo.findActiveReviewByPlaceAndUser(100n, 10n), null);
    });

    it("allows a new review after soft-delete", async () => {
        const repo = new FakeTourismReviewsRepository();
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
        await service.createReview(TOURISM_TEST_USER_A, TOURISM_TEST_PLACE_PUBLIC, { rating: 5 });
        const mine = await service.findMyReviewForPlace(
            TOURISM_TEST_USER_A,
            TOURISM_TEST_PLACE_PUBLIC
        );
        assert.ok(mine);
        await service.softDeleteOwnReview(TOURISM_TEST_USER_A, mine.public_id);
        const again = await service.createReview(TOURISM_TEST_USER_A, TOURISM_TEST_PLACE_PUBLIC, {
            rating: 4,
        });
        assert.equal(again.rating, 4);
        assert.equal(again.status, "pending");
    });

    it("excludes non-published statuses from public list results", async () => {
        const repo = new FakeTourismReviewsRepository();
        repo.reviews.set(
            "p1",
            tourismTestReviewRow({
                publicId: "44444444-4444-4444-8444-444444444441",
                status: "published",
                createdAt: new Date("2026-09-05T00:00:00.000Z"),
            })
        );
        repo.reviews.set(
            "p2",
            tourismTestReviewRow({
                id: 2n,
                publicId: "44444444-4444-4444-8444-444444444442",
                status: "pending",
            })
        );
        repo.reviews.set(
            "p3",
            tourismTestReviewRow({
                id: 3n,
                publicId: "44444444-4444-4444-8444-444444444443",
                status: "rejected",
            })
        );
        repo.reviews.set(
            "p4",
            tourismTestReviewRow({
                id: 4n,
                publicId: "44444444-4444-4444-8444-444444444444",
                status: "hidden",
            })
        );
        repo.reviews.set(
            "p5",
            tourismTestReviewRow({
                id: 5n,
                publicId: "44444444-4444-4444-8444-444444444445",
                status: "deleted",
            })
        );
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
        const page = await service.listPublishedReviews(TOURISM_TEST_PLACE_PUBLIC, { limit: 20 });
        assert.equal(page.items.length, 1);
        assert.equal(page.items[0]?.status, "published");
    });

    it("records moderation events on admin status change", async () => {
        const repo = new FakeTourismReviewsRepository();
        const existing = tourismTestReviewRow({ status: "pending" });
        repo.reviews.set(existing.publicId, existing);
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);

        const published = await service.changeModerationStatus(
            TOURISM_TEST_USER_B,
            TOURISM_TEST_REVIEW_PUBLIC,
            { status: "published", note: "Looks good" }
        );
        assert.equal(published.status, "published");
        assert.equal(repo.moderationEvents[0]?.fromStatus, "pending");
        assert.equal(repo.moderationEvents[0]?.toStatus, "published");
        assert.deepEqual(repo.refreshCalls, [100n]);
    });

    it("refreshes rating summary on demand", async () => {
        const repo = new FakeTourismReviewsRepository();
        repo.reviews.set(
            TOURISM_TEST_REVIEW_PUBLIC,
            tourismTestReviewRow({ status: "published", rating: 4 })
        );
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
        const summary = await service.refreshRatingSummary(TOURISM_TEST_PLACE_PUBLIC);
        assert.equal(summary.published_review_count, 1);
        assert.equal(summary.average_rating, 4);
    });
});

describe("tourism admin moderation transitions", () => {
    it("resolves publish/reject/hide/restore targets", () => {
        assert.deepEqual(
            resolveTourismAdminTransition("publish", { status: "pending", publishedAt: null }),
            { idempotent: false, toStatus: "published" }
        );
        assert.deepEqual(
            resolveTourismAdminTransition("publish", { status: "published", publishedAt: new Date() }),
            { idempotent: true, toStatus: "published" }
        );
        assert.deepEqual(
            resolveTourismAdminTransition("reject", { status: "pending", publishedAt: null }),
            { idempotent: false, toStatus: "rejected" }
        );
        assert.deepEqual(
            resolveTourismAdminTransition("hide", { status: "published", publishedAt: new Date() }),
            { idempotent: false, toStatus: "hidden" }
        );
        assert.deepEqual(
            resolveTourismAdminTransition("restore", {
                status: "hidden",
                publishedAt: new Date("2026-09-01T00:00:00.000Z"),
            }),
            { idempotent: false, toStatus: "published" }
        );
        assert.deepEqual(
            resolveTourismAdminTransition("restore", { status: "hidden", publishedAt: null }),
            { idempotent: false, toStatus: "pending" }
        );
    });

    it("rejects restore for non-hidden and deleted reviews", () => {
        assert.throws(
            () =>
                resolveTourismAdminTransition("restore", {
                    status: "pending",
                    publishedAt: null,
                }),
            (error: unknown) =>
                error instanceof TourismReviewsError && error.code === "INVALID_TRANSITION"
        );
        assert.throws(
            () =>
                resolveTourismAdminTransition("restore", {
                    status: "deleted",
                    publishedAt: null,
                }),
            (error: unknown) =>
                error instanceof TourismReviewsError && error.code === "DELETED"
        );
        assert.throws(
            () =>
                resolveTourismAdminTransition("publish", {
                    status: "deleted",
                    publishedAt: null,
                }),
            (error: unknown) =>
                error instanceof TourismReviewsError && error.code === "DELETED"
        );
    });

    it("publishes, rejects, hides, and restores through applyAdminAction", async () => {
        const repo = new FakeTourismReviewsRepository();
        repo.reviews.set(TOURISM_TEST_REVIEW_PUBLIC, tourismTestReviewRow({ status: "pending" }));
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);

        const published = await service.applyAdminAction(
            TOURISM_TEST_ADMIN,
            TOURISM_TEST_REVIEW_PUBLIC,
            "publish"
        );
        assert.equal(published.status, "published");
        assert.ok(published.published_at);

        const again = await service.applyAdminAction(
            TOURISM_TEST_ADMIN,
            TOURISM_TEST_REVIEW_PUBLIC,
            "publish"
        );
        assert.equal(again.status, "published");
        assert.equal(repo.moderationEvents.length, 1);

        const rejected = await service.applyAdminAction(
            TOURISM_TEST_ADMIN,
            TOURISM_TEST_REVIEW_PUBLIC,
            "reject",
            { note: "Spam" }
        );
        assert.equal(rejected.status, "rejected");
        assert.equal(rejected.moderation_note, "Spam");

        const hidden = await service.applyAdminAction(
            TOURISM_TEST_ADMIN,
            TOURISM_TEST_REVIEW_PUBLIC,
            "hide",
            { note: "Off topic" }
        );
        assert.equal(hidden.status, "hidden");

        const restored = await service.applyAdminAction(
            TOURISM_TEST_ADMIN,
            TOURISM_TEST_REVIEW_PUBLIC,
            "restore"
        );
        assert.equal(restored.status, "published");
        assert.equal(repo.moderationEvents.length, 4);
        assert.deepEqual(repo.refreshCalls, [100n, 100n, 100n, 100n]);
    });

    it("restores never-published hidden reviews to pending", async () => {
        const repo = new FakeTourismReviewsRepository();
        repo.reviews.set(
            TOURISM_TEST_REVIEW_PUBLIC,
            tourismTestReviewRow({ status: "hidden", publishedAt: null })
        );
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
        const restored = await service.applyAdminAction(
            TOURISM_TEST_ADMIN,
            TOURISM_TEST_REVIEW_PUBLIC,
            "restore"
        );
        assert.equal(restored.status, "pending");
    });

    it("cannot restore deleted reviews", async () => {
        const repo = new FakeTourismReviewsRepository();
        repo.reviews.set(
            TOURISM_TEST_REVIEW_PUBLIC,
            tourismTestReviewRow({ status: "deleted" })
        );
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
        await assert.rejects(
            () =>
                service.applyAdminAction(
                    TOURISM_TEST_ADMIN,
                    TOURISM_TEST_REVIEW_PUBLIC,
                    "restore"
                ),
            (error: unknown) =>
                error instanceof TourismReviewsError &&
                error.statusCode === 409 &&
                error.code === "DELETED"
        );
    });

    it("lists admin reviews with filters and detail history", async () => {
        const repo = new FakeTourismReviewsRepository();
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
                createdAt: new Date("2026-09-10T00:00:00.000Z"),
            })
        );
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);

        const pending = await service.listAdminReviews({
            status: "pending",
            limit: 20,
        });
        assert.equal(pending.items.length, 1);
        assert.equal(pending.items[0]?.status, "pending");

        const byAuthor = await service.listAdminReviews({
            authorId: TOURISM_TEST_USER_B,
            limit: 20,
        });
        assert.equal(byAuthor.items.length, 1);
        assert.equal(byAuthor.items[0]?.author.public_id, TOURISM_TEST_USER_B);

        await service.applyAdminAction(
            TOURISM_TEST_ADMIN,
            TOURISM_TEST_REVIEW_PUBLIC,
            "reject",
            { note: "Needs work" }
        );
        const detail = await service.getAdminReview(TOURISM_TEST_REVIEW_PUBLIC);
        assert.equal(detail.status, "rejected");
        assert.equal(detail.moderation_history.length, 1);
        assert.equal(detail.moderation_history[0]?.to_status, "rejected");
        assert.equal(detail.moderation_history[0]?.actor?.public_id, TOURISM_TEST_ADMIN);
    });
});

describe("tourism place ranking", () => {
    function seedRankedFixture() {
        const repo = new FakeTourismReviewsRepository();
        const placeA = tourismTestPlaceCore({
            placeId: 100n,
            publicId: TOURISM_TEST_PLACE_PUBLIC,
            lat: 16.8,
            lng: 96.15,
            isVerified: true,
        });
        const placeBId = "77777777-7777-4777-8777-777777777777";
        const placeB = tourismTestPlaceCore({
            placeId: 200n,
            publicId: placeBId,
            primaryName: "Near Spot",
            displayName: "Near Spot",
            nameMm: null,
            nameEn: "Near Spot",
            lat: 16.801,
            lng: 96.151,
            isVerified: false,
        });
        const placeCId = "88888888-8888-4888-8888-888888888888";
        const placeC = tourismTestPlaceCore({
            placeId: 300n,
            publicId: placeCId,
            primaryName: "Far Spot",
            displayName: "Far Spot",
            nameMm: null,
            nameEn: "Far Spot",
            lat: 17.0,
            lng: 96.3,
            isVerified: true,
        });
        repo.placeCores.set(placeA.publicId, placeA);
        repo.placeCores.set(placeB.publicId, placeB);
        repo.placeCores.set(placeC.publicId, placeC);
        repo.profiles.set(100n, tourismTestProfileRow({ placeId: 100n, editorPick: true }));
        repo.profiles.set(
            200n,
            tourismTestProfileRow({
                placeId: 200n,
                tourismTypeId: 3n,
                tourismType: "market",
                tourismTypeNameEn: "Market",
                tourismTypeNameMm: "ဈေး",
                editorPick: false,
            })
        );
        repo.profiles.set(
            300n,
            tourismTestProfileRow({
                placeId: 300n,
                tourismType: "attraction",
                editorPick: true,
                isPublic: true,
            })
        );
        return { repo, placeBId, placeCId };
    }

    function setSummary(
        repo: FakeTourismReviewsRepository,
        placeId: bigint,
        count: number,
        average: number | null
    ) {
        repo.summaries.set(placeId, {
            placeId,
            placePublicId: "x",
            publishedReviewCount: count,
            averageRating: average === null ? null : average.toFixed(2),
            updatedAt: new Date(),
        });
    }

    function seedPublishedReviews(
        repo: FakeTourismReviewsRepository,
        specs: Array<{ placeId: bigint; rating: number; status?: string }>
    ) {
        let i = 1;
        for (const spec of specs) {
            const publicId = `99999999-9999-4999-8999-${String(i).padStart(12, "0")}`;
            repo.reviews.set(
                publicId,
                tourismTestReviewRow({
                    id: BigInt(i),
                    publicId,
                    placeId: spec.placeId,
                    rating: spec.rating,
                    status: (spec.status ?? "published") as "published",
                })
            );
            i += 1;
        }
    }

    it("uses deterministic fallback when there are zero published reviews", async () => {
        const { repo, placeBId, placeCId } = seedRankedFixture();
        setSummary(repo, 100n, 0, null);
        setSummary(repo, 200n, 0, null);
        setSummary(repo, 300n, 0, null);
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
        const page = await service.listRankedPlaces({ mode: "recommended", limit: 20 });
        assert.equal(page.items.every((item) => item.average_rating === null), true);
        assert.ok(!("bayesian_score" in (page.items[0] ?? {})));
        // Fallback: review count tie → verified first, then public_id
        assert.equal(page.items[0]?.public_id, TOURISM_TEST_PLACE_PUBLIC);
        assert.equal(page.items[1]?.public_id, placeCId);
        assert.equal(page.items[2]?.public_id, placeBId);
    });

    it("ranks one five-star review and verifies aggregates against direct stats", async () => {
        const { repo } = seedRankedFixture();
        seedPublishedReviews(repo, [{ placeId: 100n, rating: 5 }]);
        setSummary(repo, 100n, 1, 5);
        setSummary(repo, 200n, 0, null);
        setSummary(repo, 300n, 0, null);
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
        const page = await service.listRankedPlaces({ mode: "recommended", limit: 20 });
        const top = page.items.find((item) => item.public_id === TOURISM_TEST_PLACE_PUBLIC);
        assert.ok(top);
        assert.equal(top.published_review_count, 1);
        assert.equal(top.average_rating, 5);

        const direct = await repo.getGlobalPublishedRatingStats();
        assert.equal(direct.publishedReviewCount, 1);
        assert.equal(direct.averageRating, 5);
        assert.equal(top.average_rating, direct.averageRating);
    });

    it("keeps one low rating below a stronger place after global average changes", async () => {
        const { repo, placeCId } = seedRankedFixture();
        seedPublishedReviews(repo, [
            { placeId: 100n, rating: 1 },
            { placeId: 300n, rating: 5 },
            { placeId: 300n, rating: 5 },
            { placeId: 300n, rating: 5 },
            { placeId: 300n, rating: 5 },
            { placeId: 300n, rating: 5 },
        ]);
        setSummary(repo, 100n, 1, 1);
        setSummary(repo, 300n, 5, 5);
        setSummary(repo, 200n, 0, null);
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
        const page = await service.listRankedPlaces({ mode: "recommended", limit: 20 });
        assert.equal(page.items[0]?.public_id, placeCId);
        assert.equal(page.items[1]?.public_id, TOURISM_TEST_PLACE_PUBLIC);
    });

    it("enforces top_rated minimum of five published reviews", async () => {
        const { repo, placeCId } = seedRankedFixture();
        seedPublishedReviews(repo, [
            { placeId: 100n, rating: 5 },
            { placeId: 100n, rating: 5 },
            { placeId: 100n, rating: 5 },
            { placeId: 100n, rating: 5 },
            { placeId: 300n, rating: 4 },
            { placeId: 300n, rating: 4 },
            { placeId: 300n, rating: 4 },
            { placeId: 300n, rating: 4 },
            { placeId: 300n, rating: 4 },
        ]);
        setSummary(repo, 100n, 4, 5);
        setSummary(repo, 300n, 5, 4);
        setSummary(repo, 200n, 0, null);
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
        const page = await service.listRankedPlaces({ mode: "top_rated", limit: 20 });
        assert.equal(page.items.length, 1);
        assert.equal(page.items[0]?.public_id, placeCId);
        assert.ok((page.items[0]?.published_review_count ?? 0) >= 5);
    });

    it("orders nearby by distance and filters editor picks", async () => {
        const { repo, placeBId, placeCId } = seedRankedFixture();
        setSummary(repo, 100n, 0, null);
        setSummary(repo, 200n, 0, null);
        setSummary(repo, 300n, 0, null);
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);

        const nearby = await service.listRankedPlaces({
            mode: "nearby",
            lat: 16.8,
            lng: 96.15,
            radius_m: 50_000,
            limit: 20,
        });
        assert.equal(nearby.items[0]?.public_id, TOURISM_TEST_PLACE_PUBLIC);
        assert.equal(nearby.items[1]?.public_id, placeBId);
        assert.equal(nearby.items[2]?.public_id, placeCId);
        assert.ok((nearby.items[0]?.distance_meters ?? 1) <= (nearby.items[1]?.distance_meters ?? 0));

        const picks = await service.listRankedPlaces({ mode: "editor_picks", limit: 20 });
        assert.equal(picks.items.length, 2);
        assert.ok(picks.items.every((item) => item.editor_pick));
        assert.ok(!picks.items.some((item) => item.public_id === placeBId));
    });

    it("excludes hidden/rejected/deleted reviews from global averages used for ranking", async () => {
        const { repo } = seedRankedFixture();
        seedPublishedReviews(repo, [
            { placeId: 100n, rating: 5, status: "published" },
            { placeId: 100n, rating: 1, status: "hidden" },
            { placeId: 100n, rating: 1, status: "rejected" },
            { placeId: 100n, rating: 1, status: "deleted" },
        ]);
        // Summary mirrors published-only aggregate (as DB refresh does).
        setSummary(repo, 100n, 1, 5);
        setSummary(repo, 200n, 0, null);
        setSummary(repo, 300n, 0, null);

        const direct = await repo.getGlobalPublishedRatingStats();
        assert.equal(direct.publishedReviewCount, 1);
        assert.equal(direct.averageRating, 5);

        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
        const page = await service.listRankedPlaces({ mode: "recommended", limit: 20 });
        const top = page.items.find((item) => item.public_id === TOURISM_TEST_PLACE_PUBLIC);
        assert.equal(top?.published_review_count, 1);
        assert.equal(top?.average_rating, 5);
    });
});

describe("tourism place profiles", () => {
    it("returns missing/hidden/deleted place profile errors", async () => {
        const repo = new FakeTourismReviewsRepository();
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);

        await assert.rejects(
            () => service.getPublicPlaceProfile(TOURISM_TEST_PLACE_PUBLIC),
            (error: unknown) =>
                error instanceof TourismReviewsError && error.code === "PROFILE_NOT_FOUND"
        );

        repo.profiles.set(100n, tourismTestProfileRow({ isPublic: false }));
        await assert.rejects(
            () => service.getPublicPlaceProfile(TOURISM_TEST_PLACE_PUBLIC),
            (error: unknown) =>
                error instanceof TourismReviewsError && error.code === "PROFILE_NOT_PUBLIC"
        );

        repo.placeCores.set(
            TOURISM_TEST_PLACE_PUBLIC,
            tourismTestPlaceCore({ placeDeletedAt: new Date("2026-09-01T00:00:00.000Z") })
        );
        await assert.rejects(
            () => service.getPublicPlaceProfile(TOURISM_TEST_PLACE_PUBLIC),
            (error: unknown) =>
                error instanceof TourismReviewsError && error.code === "PLACE_NOT_FOUND"
        );
    });

    it("creates and updates profiles with audit and localized names", async () => {
        const repo = new FakeTourismReviewsRepository();
        repo.summaries.set(100n, {
            placeId: 100n,
            placePublicId: TOURISM_TEST_PLACE_PUBLIC,
            publishedReviewCount: 2,
            averageRating: "4.50",
            updatedAt: new Date("2026-09-04T00:00:00.000Z"),
        });
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);

        const created = await service.createPlaceProfile(
            TOURISM_TEST_ADMIN,
            TOURISM_TEST_PLACE_PUBLIC,
            {
                tourism_type: "attraction",
                short_description: "Must see",
                price_level: 2,
                editor_pick: true,
                is_public: true,
                editorial_score: 80,
                manual_boost: 5,
                manual_boost_reason: "Temporary festival corridor boost",
                season_mode: "best_months",
                season_start_month: 11,
                season_end_month: 2,
            }
        );
        assert.equal(created.tourism_type, "attraction");
        assert.equal(created.editor_pick, true);
        assert.equal(created.average_rating, 4.5);
        assert.equal(created.published_review_count, 2);
        assert.equal(created.address?.full_address, "Pagoda Road, Yangon");
        assert.equal(created.contact?.phone, "+95-1-000000");
        assert.equal(created.tourism_type_name_en, "Attraction");
        assert.equal(created.editorial_score, 80);
        assert.equal(created.manual_boost, 5);
        assert.equal(created.season_mode, "best_months");
        assert.equal(created.season_start_month, 11);
        assert.equal(created.season_end_month, 2);
        assert.equal(created.importance_score, 75);
        assert.equal(repo.auditEvents[0]?.actionType, "tourism_place_profile_manual_boost_set");

        const updated = await service.updatePlaceProfile(
            TOURISM_TEST_ADMIN,
            TOURISM_TEST_PLACE_PUBLIC,
            {
                price_level: 3,
                editor_pick: false,
                manual_boost: -2,
                manual_boost_reason: "Correct over-boost after review",
            }
        );
        assert.equal(updated.price_level, 3);
        assert.equal(updated.editor_pick, false);
        assert.equal(updated.manual_boost, -2);
        assert.equal(repo.auditEvents[1]?.actionType, "tourism_place_profile_manual_boost_updated");

        const my = await service.getPublicPlaceProfile(TOURISM_TEST_PLACE_PUBLIC, "my");
        assert.equal(my.name, "ရွှေတိဂုံ");
        const en = await service.getPublicPlaceProfile(TOURISM_TEST_PLACE_PUBLIC, "en");
        assert.equal(en.name, "Shwedagon Pagoda");
        assert.ok(!("importance_score" in en));
    });

    it("lists tourism taxonomy and rejects missing taxonomy rows", async () => {
        const repo = new FakeTourismReviewsRepository();
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
        const items = await service.listTourismTypes();
        assert.equal(items[0]?.code, "attraction");
        assert.equal(items[0]?.name_en, "Attraction");

        repo.tourismTypes.delete("museum");
        await assert.rejects(
            () =>
                service.createPlaceProfile(TOURISM_TEST_ADMIN, TOURISM_TEST_PLACE_PUBLIC, {
                    tourism_type: "museum",
                    editorial_score: 50,
                    manual_boost: 0,
                    season_mode: "all_year",
                    season_start_month: null,
                    season_end_month: null,
                }),
            (error: unknown) =>
                error instanceof TourismReviewsError &&
                error.statusCode === 400 &&
                error.code === "INVALID_TOURISM_TYPE"
        );
    });

    it("rejects unauthorized-looking create when actor is inactive", async () => {
        const repo = new FakeTourismReviewsRepository();
        const service = new TourismReviewsService(repo as unknown as TourismReviewsRepository);
        await assert.rejects(
            () =>
                service.createPlaceProfile("cccccccc-cccc-4ccc-8ccc-cccccccccccc", TOURISM_TEST_PLACE_PUBLIC, {
                    tourism_type: "museum",
                    editorial_score: 50,
                    manual_boost: 0,
                    season_mode: "all_year",
                    season_start_month: null,
                    season_end_month: null,
                }),
            (error: unknown) =>
                error instanceof TourismReviewsError && error.statusCode === 403
        );
    });
});
