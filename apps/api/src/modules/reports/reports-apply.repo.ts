import { Prisma, type PrismaClient } from "@prisma/client";

import { snapshotRevisionFromParts } from "../field/field-revision.js";
import type { FieldRepository } from "../field/field.repo.js";
import type { TransportRepository } from "../transport/transport.repo.js";
import type { TransportAuditContext } from "../transport/transport-audit.js";
import {
    TransportNameRequiredError,
    TransportNotFoundError,
    TransportRouteMetadataError,
} from "../transport/transport.errors.js";
import { toFieldContext } from "./field-report-evidence.js";
import {
    reviewKindForReportType,
    structuredProposedStopDetailsFromField,
    type ReportReviewActionCode,
} from "./report-review.js";
import {
    REPORT_ENTITY_TYPE,
    type AuditContext,
    type ReportRow,
    ReportsRepository,
} from "./reports.repo.js";

const APPLY_OPEN_STATUSES = new Set(["submitted", "in_review"]);

export type ReportApplyComparison = {
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    affected_variant_count: number | null;
    affected_route_count: number | null;
};

export type ReportApplyMutationResult = {
    report: ReportRow;
    applied: boolean;
    idempotent: boolean;
    action: ReportReviewActionCode;
    client_action: "OPEN_ROUTE_EDITOR" | null;
    route_public_id: string | null;
    comparison: ReportApplyComparison;
    message: string | null;
};

export class ReportsApplyError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = "ReportsApplyError";
    }
}

type Tx = Prisma.TransactionClient;

/**
 * Transactional field-report apply. Locks the report row, applies trusted
 * proposal data via transport helpers, audits, and resolves the report.
 */
export class ReportsApplyRepository {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly reportsRepo: ReportsRepository,
        private readonly fieldRepo: Pick<FieldRepository, "loadRevisionParts">,
        private readonly transportRepo: Pick<
            TransportRepository,
            | "applyMoveStopInTx"
            | "applyRemoveStopFromVariantInTx"
            | "applyCreateAndInsertStopInTx"
            | "applyUpdateStopDetailsInTx"
        >
    ) {}

    async apply(input: {
        reportPublicId: string;
        action: ReportReviewActionCode;
        expectedCanonicalRevision: string;
        audit: AuditContext;
    }): Promise<ReportApplyMutationResult> {
        if (input.action === "OPEN_ROUTE_EDITOR") {
            return this.openRouteEditor(input.reportPublicId, input.expectedCanonicalRevision);
        }

        try {
            return await this.prisma.$transaction(
                async (tx) => this.applyInsideTx(tx, input),
                { maxWait: 10_000, timeout: 30_000 }
            );
        } catch (error) {
            if (error instanceof ReportsApplyError) {
                throw error;
            }
            if (
                error instanceof TransportNotFoundError ||
                error instanceof TransportRouteMetadataError ||
                error instanceof TransportNameRequiredError
            ) {
                throw new ReportsApplyError(error.message, 409);
            }
            throw error;
        }
    }

    private async openRouteEditor(
        reportPublicId: string,
        expectedCanonicalRevision: string
    ): Promise<ReportApplyMutationResult> {
        const report = await this.reportsRepo.findByPublicId(reportPublicId);
        if (!report) {
            throw new ReportsApplyError("Report not found", 404);
        }
        this.assertFieldSurvey(report);
        this.assertOpenOrInReview(report);
        await this.assertRevision(expectedCanonicalRevision);
        const field = toFieldContext(report, expectedCanonicalRevision);
        if (reviewKindForReportType(report.report_type_code) !== "ROUTE_ISSUE") {
            throw new ReportsApplyError("OPEN_ROUTE_EDITOR is not permitted for this report type", 409);
        }
        if (!field?.route_public_id) {
            throw new ReportsApplyError("Route public ID is missing from report evidence", 409);
        }
        return {
            report,
            applied: false,
            idempotent: false,
            action: "OPEN_ROUTE_EDITOR",
            client_action: "OPEN_ROUTE_EDITOR",
            route_public_id: field.route_public_id,
            comparison: emptyComparison(),
            message: null,
        };
    }

    private async applyInsideTx(
        tx: Tx,
        input: {
            reportPublicId: string;
            action: ReportReviewActionCode;
            expectedCanonicalRevision: string;
            audit: AuditContext;
        }
    ): Promise<ReportApplyMutationResult> {
        const locked = await this.lockReport(tx, input.reportPublicId);
        this.assertFieldSurvey(locked);

        const existingApply = asApplyRecord(locked.report_data);
        const terminalStatuses = new Set(["resolved", "rejected"]);
        if (terminalStatuses.has(locked.status_code) && existingApply?.action === input.action) {
            return {
                report: locked,
                applied: true,
                idempotent: true,
                action: input.action,
                client_action: null,
                route_public_id: null,
                comparison: (existingApply.comparison as ReportApplyComparison) ?? emptyComparison(),
                message: "Apply already completed for this report",
            };
        }
        if (!APPLY_OPEN_STATUSES.has(locked.status_code)) {
            throw new ReportsApplyError(
                `Cannot apply while the report is '${locked.status_code}'`,
                409
            );
        }

        await this.assertRevision(input.expectedCanonicalRevision);
        const field = toFieldContext(locked, input.expectedCanonicalRevision);
        if (!field) {
            throw new ReportsApplyError("Field evidence is missing", 409);
        }

        const kind = reviewKindForReportType(locked.report_type_code);
        this.assertActionPermitted(kind, input.action);

        const transportAudit: TransportAuditContext = {
            actorUserId: input.audit.actorUserId,
            requestId: null,
        };

        let comparison: ReportApplyComparison = emptyComparison();
        let applyPayload: Record<string, unknown> = {
            action: input.action,
            expectedCanonicalRevision: input.expectedCanonicalRevision,
            appliedAt: new Date().toISOString(),
        };

        if (input.action === "RESOLVE" || input.action === "REJECT") {
            comparison = {
                before: { status_code: locked.status_code },
                after: { status_code: input.action === "RESOLVE" ? "resolved" : "rejected" },
                affected_variant_count: null,
                affected_route_count: null,
            };
        } else if (input.action === "MOVE_STOP") {
            if (!field.stop_public_id || !field.proposed_location) {
                throw new ReportsApplyError("MOVE_STOP requires stop and proposed geometry", 409);
            }
            const moved = await this.transportRepo.applyMoveStopInTx(tx, {
                stopPublicId: field.stop_public_id,
                latitude: field.proposed_location.latitude,
                longitude: field.proposed_location.longitude,
                audit: transportAudit,
            });
            const routeCount = await this.countRoutesForStopTx(tx, field.stop_public_id);
            comparison = {
                before: moved.before,
                after: moved.after,
                affected_variant_count: moved.affectedVariantCount,
                affected_route_count: routeCount,
            };
            applyPayload = { ...applyPayload, stopPublicId: field.stop_public_id, comparison };
        } else if (input.action === "REMOVE_FROM_ROUTE") {
            if (!field.stop_public_id || !field.variant_public_id) {
                throw new ReportsApplyError("REMOVE_FROM_ROUTE requires stop and variant", 409);
            }
            const removed = await this.transportRepo.applyRemoveStopFromVariantInTx(tx, {
                variantPublicId: field.variant_public_id,
                stopPublicId: field.stop_public_id,
                stopSequence: field.stop_sequence,
                audit: transportAudit,
                reason: "field_report_missing_item",
            });
            comparison = {
                before: {
                    route_stop_id: removed.removedRouteStopId,
                    stop_sequence: removed.removedSequence,
                },
                after: { removed: true, sequence_valid: removed.sequenceValid },
                affected_variant_count: 1,
                affected_route_count: 1,
            };
            applyPayload = { ...applyPayload, comparison };
        } else if (input.action === "CREATE_AND_INSERT_STOP") {
            const name = field.proposed_stop_name?.trim();
            if (
                !name ||
                !field.proposed_location ||
                !field.variant_public_id ||
                !field.previous_stop_public_id
            ) {
                throw new ReportsApplyError(
                    "CREATE_AND_INSERT_STOP requires name, geometry, variant, and previous stop",
                    409
                );
            }
            const created = await this.transportRepo.applyCreateAndInsertStopInTx(tx, {
                variantPublicId: field.variant_public_id,
                previousStopPublicId: field.previous_stop_public_id,
                name,
                latitude: field.proposed_location.latitude,
                longitude: field.proposed_location.longitude,
                mode: "bus",
                stopType: "bus_stop",
                audit: transportAudit,
            });
            comparison = {
                before: {
                    previous_stop_public_id: field.previous_stop_public_id,
                    previous_stop_sequence: field.previous_stop_sequence,
                },
                after: {
                    stop_public_id: created.stopPublicId,
                    route_stop_id: created.routeStopId,
                    name: created.name,
                    latitude: created.latitude,
                    longitude: created.longitude,
                },
                affected_variant_count: 1,
                affected_route_count: 1,
            };
            applyPayload = {
                ...applyPayload,
                createdStopPublicId: created.stopPublicId,
                comparison,
            };
        } else if (input.action === "UPDATE_STOP_DETAILS") {
            const details = structuredProposedStopDetailsFromField(field);
            if (!field.stop_public_id || !details?.proposed_stop_name) {
                throw new ReportsApplyError(
                    "UPDATE_STOP_DETAILS requires structured proposed stop details",
                    409
                );
            }
            const updated = await this.transportRepo.applyUpdateStopDetailsInTx(tx, {
                stopPublicId: field.stop_public_id,
                proposedStopName: details.proposed_stop_name,
                audit: transportAudit,
            });
            comparison = {
                before: updated.before,
                after: updated.after,
                affected_variant_count: null,
                affected_route_count: await this.countRoutesForStopTx(tx, field.stop_public_id),
            };
            applyPayload = { ...applyPayload, comparison };
        } else {
            throw new ReportsApplyError(`Unsupported apply action '${input.action}'`, 400);
        }

        const toStatus = input.action === "REJECT" ? "rejected" : "resolved";
        const nextData = {
            ...(asRecord(locked.report_data) ?? {}),
            apply: applyPayload,
        };

        await tx.$executeRaw(Prisma.sql`
            UPDATE feedback.user_reports
            SET status_code = ${toStatus},
                reviewed_by = ${input.audit.actorUserId},
                reviewed_at = now(),
                report_data = ${JSON.stringify(nextData)}::jsonb,
                updated_at = now()
            WHERE id = ${locked.id}
              AND status_code IN ('submitted', 'in_review')
        `);

        const updatedRows = await tx.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM feedback.user_reports
            WHERE id = ${locked.id} AND status_code = ${toStatus}
            LIMIT 1
        `;
        if (!updatedRows[0]) {
            throw new ReportsApplyError(
                "Report was changed by another admin. Refresh and try again.",
                409
            );
        }

        await tx.$executeRaw(Prisma.sql`
            INSERT INTO feedback.report_status_events
                (report_id, old_status_code, new_status_code, actor_user_id, note)
            VALUES (
                ${locked.id},
                ${locked.status_code},
                ${toStatus},
                ${input.audit.actorUserId},
                ${`apply:${input.action}`}
            )
        `);

        await tx.$executeRaw(Prisma.sql`
            INSERT INTO system.audit_logs
                (actor_user_id, action_type, entity_type, entity_id, before_snapshot, after_snapshot, ip_address, user_agent)
            VALUES (
                ${input.audit.actorUserId},
                ${`report_apply_${input.action.toLowerCase()}`},
                ${REPORT_ENTITY_TYPE},
                ${locked.id},
                ${JSON.stringify({
                    status_code: locked.status_code,
                    comparison_before: comparison.before,
                })}::jsonb,
                ${JSON.stringify({
                    status_code: toStatus,
                    action: input.action,
                    target: applyPayload,
                    comparison_after: comparison.after,
                })}::jsonb,
                ${input.audit.ipAddress},
                ${input.audit.userAgent}
            )
        `);

        const report = await this.selectById(tx, locked.id);
        return {
            report,
            applied: true,
            idempotent: false,
            action: input.action,
            client_action: null,
            route_public_id: null,
            comparison,
            message: null,
        };
    }

    private async lockReport(tx: Tx, publicId: string): Promise<ReportRow> {
        const locked = await this.reportsRepo.lockByPublicIdForUpdate(tx, publicId);
        if (!locked) {
            throw new ReportsApplyError("Report not found", 404);
        }
        return locked;
    }

    private async selectById(tx: Tx, id: bigint): Promise<ReportRow> {
        const row = await this.reportsRepo.findByIdInTx(tx, id);
        if (!row) {
            throw new ReportsApplyError("Report not found", 404);
        }
        return row;
    }

    private async assertRevision(expected: string): Promise<void> {
        const parts = await this.fieldRepo.loadRevisionParts();
        const current = snapshotRevisionFromParts(parts);
        if (expected !== current) {
            throw new ReportsApplyError(
                "Canonical revision mismatch. Refresh the report and try again.",
                409
            );
        }
    }

    private assertFieldSurvey(report: ReportRow): void {
        if (report.source_code !== "field_survey") {
            throw new ReportsApplyError("Apply is only available for field survey reports", 409);
        }
    }

    private assertOpenOrInReview(report: ReportRow): void {
        if (!APPLY_OPEN_STATUSES.has(report.status_code)) {
            throw new ReportsApplyError(
                `Cannot apply while the report is '${report.status_code}'`,
                409
            );
        }
    }

    private assertActionPermitted(
        kind: ReturnType<typeof reviewKindForReportType>,
        action: ReportReviewActionCode
    ): void {
        const map: Record<string, ReportReviewActionCode[]> = {
            STOP_MOVED: ["MOVE_STOP", "RESOLVE", "REJECT"],
            STOP_MISSING: ["REMOVE_FROM_ROUTE", "RESOLVE", "REJECT"],
            NEW_STOP: ["CREATE_AND_INSERT_STOP", "RESOLVE", "REJECT"],
            WRONG_DATA: ["UPDATE_STOP_DETAILS", "RESOLVE", "REJECT"],
            ROUTE_ISSUE: ["OPEN_ROUTE_EDITOR", "RESOLVE", "REJECT"],
            OTHER: ["RESOLVE", "REJECT"],
        };
        const allowed = kind ? map[kind] ?? ["RESOLVE", "REJECT"] : ["RESOLVE", "REJECT"];
        if (!allowed.includes(action)) {
            throw new ReportsApplyError(
                `Action '${action}' is not permitted for this report type`,
                409
            );
        }
    }

    private async countRoutesForStopTx(tx: Tx, stopPublicId: string): Promise<number> {
        const rows = await tx.$queryRaw<{ count: bigint | number }[]>`
            SELECT count(DISTINCT r.id) AS count
            FROM transport.stops s
            JOIN transport.route_stops rs ON rs.stop_id = s.id
            JOIN transport.route_variants v ON v.id = rs.route_variant_id AND v.deleted_at IS NULL
            JOIN transport.routes r ON r.id = v.route_id AND r.deleted_at IS NULL
            WHERE s.public_id = ${stopPublicId}::uuid AND s.deleted_at IS NULL
        `;
        return Number(rows[0]?.count ?? 0);
    }
}

function emptyComparison(): ReportApplyComparison {
    return {
        before: null,
        after: null,
        affected_variant_count: null,
        affected_route_count: null,
    };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

function asApplyRecord(value: unknown): Record<string, unknown> | null {
    const data = asRecord(value);
    if (!data) {
        return null;
    }
    return asRecord(data.apply);
}
