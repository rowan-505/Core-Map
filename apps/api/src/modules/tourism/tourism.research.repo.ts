/**
 * Repository for tourism.research_candidates (admin staging only).
 */
import { Prisma, type PrismaClient } from "@prisma/client";

export type ResearchAuditContext = {
    ipAddress?: string | null;
    userAgent?: string | null;
};

export const TOURISM_RESEARCH_AUDIT_ENTITY = "tourism_research_candidate";

export type TourismResearchCandidateRow = {
    id: bigint;
    publicId: string;
    adminAreaId: bigint;
    adminAreaName: string;
    entityType: string;
    name: string;
    researchStatus: string;
    evidenceConfidence: number | null;
    normalizedPayload: unknown;
    researchProvider: string;
    researchRunId: string | null;
    candidateKey: string | null;
    researchedAt: Date;
    reviewedBy: bigint | null;
    reviewedByPublicId: string | null;
    reviewedAt: Date | null;
    createdEntityType: string | null;
    createdEntityPublicId: string | null;
    createdAt: Date;
    updatedAt: Date;
};

type Tx = Prisma.TransactionClient;

export class TourismResearchRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async findUsableUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM app_auth.auth_users
            WHERE public_id::text = ${publicId}
              AND deleted_at IS NULL
              AND is_active = true
              AND account_status = 'active'
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async findActiveAdminAreaId(adminAreaId: bigint): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM core.core_admin_areas
            WHERE id = ${adminAreaId}
              AND is_active = true
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async findActiveAdminAreaIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM core.core_admin_areas
            WHERE public_id::text = ${publicId}
              AND is_active = true
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async listCandidates(input: {
        adminAreaId?: bigint;
        entityType?: string;
        researchStatus?: string;
        evidenceConfidenceMin?: number;
        evidenceConfidenceMax?: number;
        q?: string;
        limit: number;
        offset: number;
    }): Promise<{ rows: TourismResearchCandidateRow[]; total: number }> {
        const filters: Prisma.Sql[] = [];
        if (input.adminAreaId !== undefined) {
            filters.push(Prisma.sql`c.admin_area_id = ${input.adminAreaId}`);
        }
        if (input.entityType) {
            filters.push(Prisma.sql`c.entity_type = ${input.entityType}`);
        }
        if (input.researchStatus) {
            filters.push(Prisma.sql`c.research_status = ${input.researchStatus}`);
        }
        if (input.evidenceConfidenceMin !== undefined) {
            filters.push(
                Prisma.sql`c.evidence_confidence IS NOT NULL AND c.evidence_confidence >= ${input.evidenceConfidenceMin}`
            );
        }
        if (input.evidenceConfidenceMax !== undefined) {
            filters.push(
                Prisma.sql`c.evidence_confidence IS NOT NULL AND c.evidence_confidence <= ${input.evidenceConfidenceMax}`
            );
        }
        if (input.q) {
            const pattern = `%${input.q}%`;
            filters.push(Prisma.sql`c.name ILIKE ${pattern}`);
        }
        const whereSql =
            filters.length > 0
                ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`
                : Prisma.empty;

        const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
            SELECT count(*)::bigint AS count
            FROM tourism.research_candidates AS c
            ${whereSql}
        `);
        const total = Number(countRows[0]?.count ?? 0n);

        const rows = await this.prisma.$queryRaw<TourismResearchCandidateRow[]>(Prisma.sql`
            SELECT
                c.id,
                c.public_id::text AS "publicId",
                c.admin_area_id AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                c.entity_type AS "entityType",
                c.name,
                c.research_status AS "researchStatus",
                c.evidence_confidence AS "evidenceConfidence",
                c.normalized_payload AS "normalizedPayload",
                c.research_provider AS "researchProvider",
                c.research_run_id AS "researchRunId",
                c.candidate_key AS "candidateKey",
                c.researched_at AS "researchedAt",
                c.reviewed_by AS "reviewedBy",
                u.public_id::text AS "reviewedByPublicId",
                c.reviewed_at AS "reviewedAt",
                c.created_entity_type AS "createdEntityType",
                c.created_entity_public_id::text AS "createdEntityPublicId",
                c.created_at AS "createdAt",
                c.updated_at AS "updatedAt"
            FROM tourism.research_candidates AS c
            JOIN core.core_admin_areas AS aa ON aa.id = c.admin_area_id
            LEFT JOIN app_auth.auth_users AS u ON u.id = c.reviewed_by
            ${whereSql}
            ORDER BY c.researched_at DESC, c.id DESC
            LIMIT ${input.limit}
            OFFSET ${input.offset}
        `);
        return { rows, total };
    }

    async findByPublicId(publicId: string): Promise<TourismResearchCandidateRow | null> {
        return this.findByPublicIdInTx(this.prisma, publicId);
    }

    async createMany(
        items: Array<{
            adminAreaId: bigint;
            entityType: string;
            name: string;
            researchStatus: string;
            evidenceConfidence: number | null;
            normalizedPayload: Prisma.InputJsonValue;
            researchProvider: string;
            researchRunId: string | null;
            candidateKey: string | null;
            researchedAt: Date;
        }>,
        actorUserId: bigint,
        audit: ResearchAuditContext
    ): Promise<{
        created: TourismResearchCandidateRow[];
        updated: TourismResearchCandidateRow[];
        skipped: TourismResearchCandidateRow[];
    }> {
        return this.prisma.$transaction(async (tx) => {
            const created: TourismResearchCandidateRow[] = [];
            const updated: TourismResearchCandidateRow[] = [];
            const skipped: TourismResearchCandidateRow[] = [];

            for (const item of items) {
                if (item.researchRunId && item.candidateKey) {
                    const existing = await this.findByRunAndCandidateKeyInTx(
                        tx,
                        item.researchRunId,
                        item.candidateKey
                    );
                    if (existing) {
                        if (existing.researchStatus === "added") {
                            skipped.push(existing);
                            continue;
                        }
                        await tx.tourismResearchCandidate.update({
                            where: { id: existing.id },
                            data: {
                                adminAreaId: item.adminAreaId,
                                entityType: item.entityType,
                                name: item.name,
                                evidenceConfidence: item.evidenceConfidence,
                                normalizedPayload: item.normalizedPayload,
                                researchProvider: item.researchProvider,
                                researchedAt: item.researchedAt,
                                // Keep staging status unless already reviewing/etc. — do not reset added.
                                // Deterministic rule: refresh payload fields only; leave research_status as-is
                                // when already past "new", otherwise keep "new".
                            },
                        });
                        await this.writeAudit(tx, {
                            actorUserId,
                            actionType: "tourism_research_candidate_import_updated",
                            entityId: existing.id,
                            beforeSnapshot: {
                                public_id: existing.publicId,
                                candidate_key: existing.candidateKey,
                                name: existing.name,
                            },
                            afterSnapshot: {
                                public_id: existing.publicId,
                                candidate_key: item.candidateKey,
                                name: item.name,
                                entity_type: item.entityType,
                            },
                            audit,
                        });
                        const full = await this.findByPublicIdInTx(tx, existing.publicId);
                        if (!full) throw new Error("Updated research candidate could not be reloaded");
                        updated.push(full);
                        continue;
                    }
                }

                const row = await tx.tourismResearchCandidate.create({
                    data: {
                        adminAreaId: item.adminAreaId,
                        entityType: item.entityType,
                        name: item.name,
                        researchStatus: item.researchStatus,
                        evidenceConfidence: item.evidenceConfidence,
                        normalizedPayload: item.normalizedPayload,
                        researchProvider: item.researchProvider,
                        researchRunId: item.researchRunId,
                        candidateKey: item.candidateKey,
                        researchedAt: item.researchedAt,
                    },
                    select: { id: true, publicId: true },
                });
                await this.writeAudit(tx, {
                    actorUserId,
                    actionType: "tourism_research_candidate_imported",
                    entityId: row.id,
                    beforeSnapshot: null,
                    afterSnapshot: {
                        public_id: row.publicId,
                        entity_type: item.entityType,
                        name: item.name,
                        research_status: item.researchStatus,
                        candidate_key: item.candidateKey,
                        research_run_id: item.researchRunId,
                    },
                    audit,
                });
                const full = await this.findByPublicIdInTx(tx, row.publicId);
                if (!full) throw new Error("Imported research candidate could not be reloaded");
                created.push(full);
            }
            return { created, updated, skipped };
        });
    }

    private async findByRunAndCandidateKeyInTx(
        tx: Tx | PrismaClient,
        researchRunId: string,
        candidateKey: string
    ): Promise<TourismResearchCandidateRow | null> {
        const rows = await tx.$queryRaw<TourismResearchCandidateRow[]>(Prisma.sql`
            SELECT
                c.id,
                c.public_id::text AS "publicId",
                c.admin_area_id AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                c.entity_type AS "entityType",
                c.name,
                c.research_status AS "researchStatus",
                c.evidence_confidence AS "evidenceConfidence",
                c.normalized_payload AS "normalizedPayload",
                c.research_provider AS "researchProvider",
                c.research_run_id AS "researchRunId",
                c.candidate_key AS "candidateKey",
                c.researched_at AS "researchedAt",
                c.reviewed_by AS "reviewedBy",
                u.public_id::text AS "reviewedByPublicId",
                c.reviewed_at AS "reviewedAt",
                c.created_entity_type AS "createdEntityType",
                c.created_entity_public_id::text AS "createdEntityPublicId",
                c.created_at AS "createdAt",
                c.updated_at AS "updatedAt"
            FROM tourism.research_candidates AS c
            JOIN core.core_admin_areas AS aa ON aa.id = c.admin_area_id
            LEFT JOIN app_auth.auth_users AS u ON u.id = c.reviewed_by
            WHERE c.research_run_id = ${researchRunId}
              AND c.candidate_key = ${candidateKey}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async updateStatus(input: {
        candidateId: bigint;
        publicId: string;
        actorUserId: bigint;
        researchStatus: string;
        createdEntityType: string | null;
        createdEntityPublicId: string | null;
        setReviewed: boolean;
        beforeSnapshot: Record<string, unknown>;
        afterSnapshot: Record<string, unknown>;
        audit: ResearchAuditContext;
        actionType: string;
    }): Promise<TourismResearchCandidateRow> {
        return this.prisma.$transaction(async (tx) => {
            await tx.tourismResearchCandidate.update({
                where: { id: input.candidateId },
                data: {
                    researchStatus: input.researchStatus,
                    createdEntityType: input.createdEntityType,
                    createdEntityPublicId: input.createdEntityPublicId,
                    ...(input.setReviewed
                        ? {
                              reviewedBy: input.actorUserId,
                              reviewedAt: new Date(),
                          }
                        : {}),
                },
            });
            await this.writeAudit(tx, {
                actorUserId: input.actorUserId,
                actionType: input.actionType,
                entityId: input.candidateId,
                beforeSnapshot: input.beforeSnapshot,
                afterSnapshot: input.afterSnapshot,
                audit: input.audit,
            });
            const row = await this.findByPublicIdInTx(tx, input.publicId);
            if (!row) throw new Error("Updated research candidate could not be reloaded");
            return row;
        });
    }

    private async writeAudit(
        tx: Tx,
        input: {
            actorUserId: bigint;
            actionType: string;
            entityId: bigint;
            beforeSnapshot: Record<string, unknown> | null;
            afterSnapshot: Record<string, unknown>;
            audit: ResearchAuditContext;
        }
    ): Promise<void> {
        await tx.auditLog.create({
            data: {
                actorUserId: input.actorUserId,
                actionType: input.actionType,
                entityType: TOURISM_RESEARCH_AUDIT_ENTITY,
                entityId: input.entityId,
                beforeSnapshot:
                    input.beforeSnapshot === null
                        ? Prisma.JsonNull
                        : (input.beforeSnapshot as Prisma.InputJsonValue),
                afterSnapshot: input.afterSnapshot as Prisma.InputJsonValue,
                ipAddress: input.audit.ipAddress ?? null,
                userAgent: input.audit.userAgent ?? null,
            },
        });
    }

    private async findByPublicIdInTx(
        tx: Tx | PrismaClient,
        publicId: string
    ): Promise<TourismResearchCandidateRow | null> {
        const rows = await tx.$queryRaw<TourismResearchCandidateRow[]>(Prisma.sql`
            SELECT
                c.id,
                c.public_id::text AS "publicId",
                c.admin_area_id AS "adminAreaId",
                aa.canonical_name AS "adminAreaName",
                c.entity_type AS "entityType",
                c.name,
                c.research_status AS "researchStatus",
                c.evidence_confidence AS "evidenceConfidence",
                c.normalized_payload AS "normalizedPayload",
                c.research_provider AS "researchProvider",
                c.research_run_id AS "researchRunId",
                c.candidate_key AS "candidateKey",
                c.researched_at AS "researchedAt",
                c.reviewed_by AS "reviewedBy",
                u.public_id::text AS "reviewedByPublicId",
                c.reviewed_at AS "reviewedAt",
                c.created_entity_type AS "createdEntityType",
                c.created_entity_public_id::text AS "createdEntityPublicId",
                c.created_at AS "createdAt",
                c.updated_at AS "updatedAt"
            FROM tourism.research_candidates AS c
            JOIN core.core_admin_areas AS aa ON aa.id = c.admin_area_id
            LEFT JOIN app_auth.auth_users AS u ON u.id = c.reviewed_by
            WHERE c.public_id::text = ${publicId}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }
}
