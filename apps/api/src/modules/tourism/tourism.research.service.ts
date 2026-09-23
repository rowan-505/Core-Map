/**
 * Admin service for tourism.research_candidates staging.
 * Never exposed on public Tourism endpoints.
 */
import type { Prisma } from "@prisma/client";

import { TourismReviewsError } from "./tourism.errors.js";
import type {
    BulkImportTourismResearchBody,
    ListAdminTourismResearchQuery,
    MarkTourismResearchAddedBody,
    ResearchNormalizedPayload,
    UpdateTourismResearchStatusBody,
} from "./tourism.research.schema.js";
import {
    TourismResearchRepository,
    type ResearchAuditContext,
    type TourismResearchCandidateRow,
} from "./tourism.research.repo.js";

export type TourismResearchCandidateDto = {
    public_id: string;
    admin_area_id: string;
    admin_area_name: string;
    entity_type: string;
    name: string;
    research_status: string;
    evidence_confidence: number | null;
    research_provider: string;
    research_run_id: string | null;
    candidate_key: string | null;
    researched_at: string;
    reviewed_by_public_id: string | null;
    reviewed_at: string | null;
    created_entity_type: string | null;
    created_entity_public_id: string | null;
    source_count: number;
    latest_source_date: string | null;
    created_at: string;
    updated_at: string;
};

export type TourismResearchCandidateDetailDto = TourismResearchCandidateDto & {
    normalized_payload: ResearchNormalizedPayload;
    evidence: {
        description: string | null;
        short_description: string | null;
        reference_scores: ResearchNormalizedPayload["reference_scores"] | null;
        editorial_recommendation: number | null;
        sources: NonNullable<ResearchNormalizedPayload["sources"]>;
        uncertainties: string[];
        conflicts: string[];
        aliases: string[];
        notes: string | null;
    };
};

/** Map a research payload into production form defaults (admin must still edit/save). */
export function mapResearchPayloadToPrefill(
    entityType: string,
    name: string,
    adminAreaId: string,
    payload: ResearchNormalizedPayload
): Record<string, unknown> {
    const base = {
        name: name,
        admin_area_id: adminAreaId,
        short_description: payload.short_description ?? payload.description ?? null,
        source_url: payload.source_url ?? payload.sources?.[0]?.url ?? null,
        is_active: true,
        is_verified: false,
    };

    switch (entityType) {
        case "food":
            return {
                ...base,
                name_en: payload.name_en ?? null,
                name_mm: payload.name_mm ?? null,
                food_type: payload.food_type ?? "other",
                labels: payload.labels ?? [],
                available_at: payload.available_at ?? [],
                editorial_recommendation: payload.editorial_recommendation ?? null,
                reference_scores: payload.reference_scores ?? null,
            };
        case "local_guide":
            return {
                ...base,
                title: payload.title ?? name,
                guide_type: payload.guide_type ?? "other",
                content: payload.content ?? payload.description ?? "",
                short_description: payload.short_description ?? null,
            };
        case "advisory":
            return {
                ...base,
                title: payload.title ?? name,
                description: payload.description ?? payload.short_description ?? "",
                advisory_type: payload.advisory_type ?? "other",
                severity: payload.severity ?? "info",
                effective_from: payload.effective_from ?? null,
                effective_until: payload.effective_until ?? null,
            };
        case "activity":
            return {
                ...base,
                activity_type: payload.activity_type ?? "other",
            };
        case "event":
            return {
                ...base,
                event_type: payload.event_type ?? "other",
            };
        case "attraction":
            return {
                ...base,
                name_en: payload.name_en ?? null,
                name_mm: payload.name_mm ?? null,
                description: payload.description ?? null,
                editorial_recommendation: payload.editorial_recommendation ?? null,
                reference_scores: payload.reference_scores ?? null,
            };
        case "food_place":
            return {
                ...base,
                name_en: payload.name_en ?? null,
                name_mm: payload.name_mm ?? null,
                description: payload.description ?? null,
            };
        default:
            return base;
    }
}

export class TourismResearchService {
    constructor(private readonly repo: TourismResearchRepository) {}

    async list(query: ListAdminTourismResearchQuery) {
        const { rows, total } = await this.repo.listCandidates({
            adminAreaId: query.admin_area_id ? BigInt(query.admin_area_id) : undefined,
            entityType: query.entity_type,
            researchStatus: query.research_status,
            evidenceConfidenceMin: query.evidence_confidence_min,
            evidenceConfidenceMax: query.evidence_confidence_max,
            q: query.q,
            limit: query.limit,
            offset: query.offset,
        });
        return {
            items: rows.map((row) => this.toListDto(row)),
            total,
            limit: query.limit,
            offset: query.offset,
        };
    }

    async get(publicId: string): Promise<TourismResearchCandidateDetailDto> {
        const row = await this.repo.findByPublicId(publicId);
        if (!row) {
            throw new TourismReviewsError(
                "Research candidate not found",
                404,
                "RESEARCH_CANDIDATE_NOT_FOUND"
            );
        }
        return this.toDetailDto(row);
    }

    async bulkImport(
        actorPublicId: string,
        body: BulkImportTourismResearchBody,
        audit: ResearchAuditContext
    ) {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const prepared = [];
        for (const item of body.candidates) {
            const adminAreaId = item.admin_area_public_id
                ? await this.requireAdminAreaByPublicId(item.admin_area_public_id)
                : await this.requireAdminArea(item.admin_area_id!);
            const payload = {
                ...item.normalized_payload,
                candidate_key: item.candidate_key,
            };
            prepared.push({
                adminAreaId,
                entityType: item.entity_type,
                name: item.name,
                researchStatus: item.research_status ?? "new",
                evidenceConfidence: item.evidence_confidence ?? null,
                normalizedPayload: payload as Prisma.InputJsonValue,
                researchProvider: item.research_provider,
                researchRunId: item.research_run_id,
                candidateKey: item.candidate_key,
                researchedAt: new Date(item.researched_at),
            });
        }
        const result = await this.repo.createMany(prepared, actorUserId, audit);
        return {
            imported: result.created.length,
            updated: result.updated.length,
            skipped: result.skipped.length,
            items: [
                ...result.created.map((row) => this.toListDto(row)),
                ...result.updated.map((row) => this.toListDto(row)),
                ...result.skipped.map((row) => this.toListDto(row)),
            ],
        };
    }

    async updateStatus(
        actorPublicId: string,
        publicId: string,
        body: UpdateTourismResearchStatusBody,
        audit: ResearchAuditContext
    ): Promise<TourismResearchCandidateDetailDto> {
        const actorUserId = await this.requireUsableUser(actorPublicId);
        const existing = await this.repo.findByPublicId(publicId);
        if (!existing) {
            throw new TourismReviewsError(
                "Research candidate not found",
                404,
                "RESEARCH_CANDIDATE_NOT_FOUND"
            );
        }
        if (existing.researchStatus === "added" && body.research_status !== "added") {
            throw new TourismReviewsError(
                "Added research candidates cannot change status",
                409,
                "RESEARCH_ALREADY_ADDED"
            );
        }

        const setReviewed = body.research_status !== "new";
        const row = await this.repo.updateStatus({
            candidateId: existing.id,
            publicId,
            actorUserId,
            researchStatus: body.research_status,
            createdEntityType: body.created_entity_type ?? null,
            createdEntityPublicId: body.created_entity_public_id ?? null,
            setReviewed,
            beforeSnapshot: this.snapshot(existing),
            afterSnapshot: {
                ...this.snapshot(existing),
                research_status: body.research_status,
                created_entity_type: body.created_entity_type ?? null,
                created_entity_public_id: body.created_entity_public_id ?? null,
            },
            audit,
            actionType: `tourism_research_candidate_${body.research_status}`,
        });
        return this.toDetailDto(row);
    }

    async markReviewing(
        actorPublicId: string,
        publicId: string,
        audit: ResearchAuditContext
    ) {
        return this.updateStatus(
            actorPublicId,
            publicId,
            { research_status: "reviewing" },
            audit
        );
    }

    async markRejected(
        actorPublicId: string,
        publicId: string,
        audit: ResearchAuditContext
    ) {
        return this.updateStatus(
            actorPublicId,
            publicId,
            { research_status: "rejected" },
            audit
        );
    }

    async markNeedsResearch(
        actorPublicId: string,
        publicId: string,
        audit: ResearchAuditContext
    ) {
        return this.updateStatus(
            actorPublicId,
            publicId,
            { research_status: "needs_research" },
            audit
        );
    }

    /**
     * Mark ADDED only after production entity was successfully saved.
     * Call this after the production create/update succeeds — never before.
     */
    async markAdded(
        actorPublicId: string,
        publicId: string,
        body: MarkTourismResearchAddedBody,
        audit: ResearchAuditContext
    ): Promise<TourismResearchCandidateDetailDto> {
        return this.updateStatus(
            actorPublicId,
            publicId,
            {
                research_status: "added",
                created_entity_type: body.created_entity_type,
                created_entity_public_id: body.created_entity_public_id,
            },
            audit
        );
    }

    async getPrefill(publicId: string) {
        const detail = await this.get(publicId);
        return {
            candidate: detail,
            prefill: mapResearchPayloadToPrefill(
                detail.entity_type,
                detail.name,
                detail.admin_area_id,
                detail.normalized_payload
            ),
            target_form: this.resolveTargetForm(detail.entity_type),
        };
    }

    private resolveTargetForm(entityType: string): string {
        switch (entityType) {
            case "attraction":
                return "tourism_attraction";
            case "activity":
                return "tourism_activity";
            case "event":
                return "tourism_event";
            case "food":
                return "tourism_food";
            case "food_place":
                return "core_place";
            case "local_guide":
                return "tourism_local_guide";
            case "advisory":
                return "tourism_advisory";
            default:
                return "other";
        }
    }

    private async requireUsableUser(publicId: string): Promise<bigint> {
        const userId = await this.repo.findUsableUserIdByPublicId(publicId);
        if (!userId) {
            throw new TourismReviewsError("User account is inactive", 403, "INACTIVE_USER");
        }
        return userId;
    }

    private async requireAdminArea(adminAreaId: string): Promise<bigint> {
        const id = await this.repo.findActiveAdminAreaId(BigInt(adminAreaId));
        if (!id) {
            throw new TourismReviewsError(
                "Invalid or inactive admin area",
                400,
                "INVALID_ADMIN_AREA"
            );
        }
        return id;
    }

    private async requireAdminAreaByPublicId(publicId: string): Promise<bigint> {
        const id = await this.repo.findActiveAdminAreaIdByPublicId(publicId);
        if (!id) {
            throw new TourismReviewsError(
                "Invalid or inactive admin area public_id",
                400,
                "INVALID_ADMIN_AREA"
            );
        }
        return id;
    }

    private parsePayload(raw: unknown): ResearchNormalizedPayload {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return {};
        }
        return raw as ResearchNormalizedPayload;
    }

    private sourceMeta(payload: ResearchNormalizedPayload): {
        source_count: number;
        latest_source_date: string | null;
    } {
        const sources = payload.sources ?? [];
        let latest: string | null = null;
        for (const source of sources) {
            const date = source.published_at ?? source.accessed_at ?? null;
            if (date && (!latest || date > latest)) latest = date;
        }
        return { source_count: sources.length, latest_source_date: latest };
    }

    private toListDto(row: TourismResearchCandidateRow): TourismResearchCandidateDto {
        const payload = this.parsePayload(row.normalizedPayload);
        const sources = this.sourceMeta(payload);
        return {
            public_id: row.publicId,
            admin_area_id: String(row.adminAreaId),
            admin_area_name: row.adminAreaName,
            entity_type: row.entityType,
            name: row.name,
            research_status: row.researchStatus,
            evidence_confidence: row.evidenceConfidence,
            research_provider: row.researchProvider,
            research_run_id: row.researchRunId,
            candidate_key: row.candidateKey,
            researched_at: row.researchedAt.toISOString(),
            reviewed_by_public_id: row.reviewedByPublicId,
            reviewed_at: row.reviewedAt?.toISOString() ?? null,
            created_entity_type: row.createdEntityType,
            created_entity_public_id: row.createdEntityPublicId,
            source_count: sources.source_count,
            latest_source_date: sources.latest_source_date,
            created_at: row.createdAt.toISOString(),
            updated_at: row.updatedAt.toISOString(),
        };
    }

    private toDetailDto(row: TourismResearchCandidateRow): TourismResearchCandidateDetailDto {
        const payload = this.parsePayload(row.normalizedPayload);
        const list = this.toListDto(row);
        return {
            ...list,
            normalized_payload: payload,
            evidence: {
                description: payload.description ?? null,
                short_description: payload.short_description ?? null,
                reference_scores: payload.reference_scores ?? null,
                editorial_recommendation: payload.editorial_recommendation ?? null,
                sources: payload.sources ?? [],
                uncertainties: payload.uncertainties ?? [],
                conflicts: payload.conflicts ?? [],
                aliases: payload.aliases ?? [],
                notes: payload.notes ?? null,
            },
        };
    }

    private snapshot(row: TourismResearchCandidateRow): Record<string, unknown> {
        return {
            research_status: row.researchStatus,
            entity_type: row.entityType,
            name: row.name,
            created_entity_type: row.createdEntityType,
            created_entity_public_id: row.createdEntityPublicId,
        };
    }
}
