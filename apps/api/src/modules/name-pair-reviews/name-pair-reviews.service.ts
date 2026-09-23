import {
    NamePairReviewsRepository,
    type GapStatsCache,
    type NamePairGapRow,
    type NamePairReviewRow,
} from "./name-pair-reviews.repo.js";
import type {
    ApproveNamePairReviewBody,
    ListNamePairGapsQuery,
    ListNamePairReviewsQuery,
    RejectOrSkipNamePairReviewBody,
} from "./name-pair-reviews.schema.js";

export class NamePairReviewsError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
    ) {
        super(message);
        this.name = "NamePairReviewsError";
    }
}

export type NamePairReviewItem = {
    public_id: string;
    entity_type: string;
    entity_id: string;
    entity_public_id: string | null;
    direction: string;
    source_name: string;
    proposed_mm: string | null;
    proposed_en: string | null;
    confidence: number;
    reason: string;
    status: string;
    fill_run_id: string | null;
    reviewed_at: string | null;
    review_note: string | null;
    created_at: string;
    updated_at: string;
};

export type NamePairGapItem = {
    entity_type: string;
    entity_id: string;
    entity_public_id: string | null;
    source_name: string;
    name_mm: string | null;
    name_en: string | null;
    gap_reason: string;
};

export type NamePairSummaryPayload = {
    review: {
        total: number;
        by_entity: Record<string, number>;
        auto_applied: { total: number; by_entity: Record<string, number> };
        other: { total: number; by_entity: Record<string, number> };
    };
    remain_non_street: { total: number; by_entity: Record<string, number> };
    remain_minor_streets: { total: number; by_entity: Record<string, number> };
    remain_status: "ready" | "computing" | "missing" | "error";
    remain_computed_at: string | null;
};

function serialize(row: NamePairReviewRow): NamePairReviewItem {
    return {
        public_id: row.public_id,
        entity_type: row.entity_type,
        entity_id: row.entity_id.toString(),
        entity_public_id: row.entity_public_id,
        direction: row.direction,
        source_name: row.source_name,
        proposed_mm: row.proposed_mm,
        proposed_en: row.proposed_en,
        confidence: row.confidence,
        reason: row.reason,
        status: row.status,
        fill_run_id: row.fill_run_id,
        reviewed_at: row.reviewed_at?.toISOString() ?? null,
        review_note: row.review_note,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
    };
}

function serializeGap(row: NamePairGapRow): NamePairGapItem {
    return {
        entity_type: row.entity_type,
        entity_id: row.entity_id.toString(),
        entity_public_id: row.entity_public_id,
        source_name: row.source_name,
        name_mm: row.name_mm,
        name_en: row.name_en,
        gap_reason: row.gap_reason,
    };
}

const REVIEW_CACHE_TTL_MS = 15_000;
const CHEAP_REMAIN_CACHE_TTL_MS = 60_000;
const REMAIN_STATS_MAX_AGE_MS = 60 * 60 * 1000;

function isHeavyReady(cache: GapStatsCache | null): boolean {
    return Boolean(cache?.complete);
}

export class NamePairReviewsService {
    private reviewCache: {
        at: number;
        value: {
            total: number;
            by_entity: Record<string, number>;
            auto_applied: { total: number; by_entity: Record<string, number> };
            other: { total: number; by_entity: Record<string, number> };
        };
    } | null = null;
    private cheapRemainCache: {
        at: number;
        value: Record<string, number>;
    } | null = null;
    private remainRefreshInflight: Promise<GapStatsCache> | null = null;
    private remainRefreshFailed = false;

    constructor(private readonly repo: NamePairReviewsRepository) {}

    async list(filters: ListNamePairReviewsQuery) {
        const { items, total } = await this.repo.list(filters);
        return {
            items: items.map(serialize),
            total,
            limit: filters.limit,
            offset: filters.offset,
        };
    }

    async summary(): Promise<NamePairSummaryPayload> {
        const now = Date.now();

        let review = this.reviewCache?.value;
        if (!review || now - (this.reviewCache?.at ?? 0) >= REVIEW_CACHE_TTL_MS) {
            review = await this.repo.summarizeReview();
            this.reviewCache = { at: now, value: review };
        }

        let cheap = this.cheapRemainCache?.value;
        if (!cheap || now - (this.cheapRemainCache?.at ?? 0) >= CHEAP_REMAIN_CACHE_TTL_MS) {
            cheap = await this.repo.countCheapRemainNonStreet();
            this.cheapRemainCache = { at: now, value: cheap };
        }

        const cached = await this.repo.readGapStatsCache();
        const byEntity: Record<string, number> = {
            ...cheap,
            ...(cached?.remain_non_street.by_entity ?? {}),
            ...cheap,
        };
        // Prefer live cheap values; keep cached place when present.
        if (typeof cached?.remain_non_street.by_entity.place === "number") {
            byEntity.place = cached.remain_non_street.by_entity.place;
        }

        const remainNonStreet = {
            total: Object.values(byEntity).reduce((a, b) => a + b, 0),
            by_entity: byEntity,
        };
        const remainStreets = cached?.remain_minor_streets ?? {
            total: 0,
            by_entity: { street: 0 },
        };

        const cacheAgeMs = cached ? now - Date.parse(cached.computed_at) : Number.POSITIVE_INFINITY;
        const heavyReady =
            isHeavyReady(cached) &&
            Number.isFinite(cacheAgeMs) &&
            cacheAgeMs < REMAIN_STATS_MAX_AGE_MS;

        if (!heavyReady && !this.remainRefreshFailed) {
            this.ensureRemainStatsRefresh();
        }

        const remainStatus: NamePairSummaryPayload["remain_status"] = this.remainRefreshFailed
            ? "error"
            : heavyReady
              ? "ready"
              : "computing";

        return {
            review,
            remain_non_street: remainNonStreet,
            remain_minor_streets: remainStreets,
            remain_status: remainStatus,
            remain_computed_at: cached?.computed_at ?? null,
        };
    }

    private ensureRemainStatsRefresh(): void {
        if (this.remainRefreshInflight) return;
        this.remainRefreshFailed = false;
        this.remainRefreshInflight = this.repo
            .computeAndStoreGapStats()
            .then((stats) => {
                this.remainRefreshFailed = false;
                return stats;
            })
            .catch((error) => {
                this.remainRefreshFailed = true;
                console.error("[name-pair-reviews] remain gap stats refresh failed", error);
                throw error;
            })
            .finally(() => {
                this.remainRefreshInflight = null;
            });
        void this.remainRefreshInflight;
    }

    invalidateSummaryCache() {
        this.reviewCache = null;
        this.cheapRemainCache = null;
    }

    async listGaps(filters: ListNamePairGapsQuery) {
        const { items, total } = await this.repo.listGaps(filters);
        return {
            items: items.map(serializeGap),
            total,
            limit: filters.limit,
            offset: filters.offset,
            bucket: filters.bucket,
        };
    }

    async getByPublicId(publicId: string): Promise<NamePairReviewItem> {
        const row = await this.repo.getByPublicId(publicId);
        if (!row) {
            throw new NamePairReviewsError("Name pair review not found", 404);
        }
        return serialize(row);
    }

    async approve(
        publicId: string,
        body: ApproveNamePairReviewBody,
        actorUserId: bigint,
    ): Promise<NamePairReviewItem> {
        const existing = await this.repo.getByPublicId(publicId);
        if (!existing) {
            throw new NamePairReviewsError("Name pair review not found", 404);
        }
        if (existing.status !== "pending") {
            throw new NamePairReviewsError("Review is not pending", 409);
        }

        const proposedMm =
            body.proposed_mm !== undefined ? body.proposed_mm : existing.proposed_mm;
        const proposedEn =
            body.proposed_en !== undefined ? body.proposed_en : existing.proposed_en;

        if (!proposedMm && !proposedEn) {
            throw new NamePairReviewsError(
                "Approve requires at least one of proposed_mm or proposed_en",
                400,
            );
        }

        const updated = await this.repo.approveAndApply({
            publicId,
            actorUserId,
            reviewNote: body.review_note ?? null,
            proposedMm,
            proposedEn,
        });
        if (!updated) {
            throw new NamePairReviewsError("Review is not pending", 409);
        }

        this.invalidateSummaryCache();
        return serialize(updated);
    }

    async reject(
        publicId: string,
        body: RejectOrSkipNamePairReviewBody,
        actorUserId: bigint,
    ): Promise<NamePairReviewItem> {
        const existing = await this.repo.getByPublicId(publicId);
        if (!existing) {
            throw new NamePairReviewsError("Review not found or not pending", 404);
        }
        if (existing.status !== "pending") {
            throw new NamePairReviewsError("Review is not pending", 409);
        }

        const updated = await this.repo.markStatus({
            publicId,
            status: "rejected",
            actorUserId,
            reviewNote: body.review_note ?? null,
        });
        if (!updated) {
            throw new NamePairReviewsError("Review not found or not pending", 404);
        }

        if (
            updated.reason === "auto_applied_needs_review" ||
            updated.direction === "review_auto_applied"
        ) {
            await this.repo.deleteTransliterationNames(updated);
        }

        this.invalidateSummaryCache();
        return serialize(updated);
    }

    async skip(
        publicId: string,
        body: RejectOrSkipNamePairReviewBody,
        actorUserId: bigint,
    ): Promise<NamePairReviewItem> {
        const updated = await this.repo.markStatus({
            publicId,
            status: "skipped",
            actorUserId,
            reviewNote: body.review_note ?? null,
        });
        if (!updated) {
            throw new NamePairReviewsError("Review not found or not pending", 404);
        }
        this.invalidateSummaryCache();
        return serialize(updated);
    }
}
