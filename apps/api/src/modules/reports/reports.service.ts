import type { PrismaClient } from "@prisma/client";
import type { MediaRepository, ReportMediaEvidenceRow } from "../media/media.repo.js";
import type { FieldRepository } from "../field/field.repo.js";
import { snapshotRevisionFromParts } from "../field/field-revision.js";
import {
    fieldStopPublicIdOf,
    toFieldContext,
    type FieldReportAdminContext,
} from "./field-report-evidence.js";
import {
    ReportsRepository,
    ReportDeleteNotRejectedError,
    type AuditContext,
    type FollowupRow,
    type PointSummaryRow,
    type ReportAnalyticsAnonymousRow,
    type ReportAnalyticsCodeCountRow,
    type ReportAnalyticsSummaryRow,
    type ReportRow,
    type StatusEventRow,
} from "./reports.repo.js";
import { isAllowedAdminStatusTransition, isFieldSurveySource } from "./report-admin-status.js";
import { toReportReview, labelReviewMapStops, type ReportReview, type ReportReviewActionCode } from "./report-review.js";
import { ReportsApplyError, ReportsApplyRepository } from "./reports-apply.repo.js";
import type { AdminApplyBody, AdminReportsQuery, ReportCreateBody } from "./reports.schema.js";
import type { TransportRepository } from "../transport/transport.repo.js";
import type { ObjectStore } from "../media/object-store.js";

export type ReportRegionCountResponse = {
    region_id: string | null;
    region_name: string | null;
    count: number;
};

export class ReportsError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number
    ) {
        super(message);
        this.name = "ReportsError";
    }
}

/** Shown for both daily-cap and cooldown rejections (kept identical on purpose). */
export const REPORT_RATE_LIMIT_MESSAGE =
    "You have reached the report limit. Please try again later.";

const MINUTE_MS = 60 * 1000;

type RateLimit = { maxPerDay: number; cooldownMs: number };

/**
 * Per-tier report limits. Anonymous and unverified accounts are throttled hardest.
 * Admins/super_admins bypass these entirely (handled by the caller).
 *
 * TODO(trusted_contributor): when a trusted-contributor badge table exists, grant
 * { maxPerDay: 40, cooldownMs: 1 * MINUTE_MS }. Until then such users are treated
 * as verified users (the branch below).
 */
function resolveRateLimit(tier: { isAnonymous: boolean; emailVerified: boolean }): RateLimit {
    if (tier.isAnonymous) {
        return { maxPerDay: 3, cooldownMs: 10 * MINUTE_MS };
    }
    if (tier.emailVerified) {
        return { maxPerDay: 15, cooldownMs: 2 * MINUTE_MS };
    }
    return { maxPerDay: 5, cooldownMs: 5 * MINUTE_MS };
}

/**
 * Status transitions an admin may perform via PATCH /status. Two transitions are
 * intentionally NOT here because they have dedicated channels:
 *   * → needs_more_info  is done via POST /request-info (it attaches a question).
 *   * needs_more_info → submitted  happens only via a user follow-up reply.
 * accepted / rejected / duplicate / resolved are terminal.
 * Field survey uses resolved instead of accepted (see report-admin-status.ts).
 */

/** Statuses from which an admin may request more info (→ needs_more_info). */
const REQUEST_INFO_ALLOWED_FROM = ["submitted", "in_review"] as const;

function assertAdminStatusTransition(
    from: string,
    to: string,
    sourceCode: string | null | undefined
): void {
    if (from === to) {
        throw new ReportsError(`Report is already '${to}'`, 409);
    }
    if (!isAllowedAdminStatusTransition(from, to, sourceCode)) {
        throw new ReportsError(`Cannot change report status from '${from}' to '${to}'`, 409);
    }
}

export type ReportResponse = {
    public_id: string;
    is_anonymous: boolean;
    eligible_for_points: boolean;
    report_type: { code: string; name: string };
    status: { code: string; name: string };
    reason_code: string | null;
    target_entity_type: string | null;
    target_entity_id: string | null;
    target_public_id: string | null;
    title: string | null;
    description: string;
    latitude: number | null;
    longitude: number | null;
    admin_area_id: string | null;
    admin_area_name: string | null;
    priority: string;
    confidence_score: number;
    admin_note: string | null;
    reviewed_at: string | null;
    reward_granted_at: string | null;
    created_at: string;
    updated_at: string;
};

export type { FieldReportAdminContext } from "./field-report-evidence.js";

export type CanonicalTargetPoint = {
    latitude: number;
    longitude: number;
};

export type AdminReportResponse = ReportResponse & {
    author: { public_id: string; display_name: string | null; email: string } | null;
    anonymous_id: string | null;
    source_code: string;
    observed_at: string | null;
    location_accuracy_m: number | null;
    field: FieldReportAdminContext | null;
    canonical_target: CanonicalTargetPoint | null;
    distance_m: number | null;
    media_count: number;
    /** Compact field-review projection; null for public reports. */
    review: ReportReview | null;
};

export type AdminApplyResult = {
    report: AdminReportResponse;
    applied: boolean;
    idempotent: boolean;
    action: ReportReviewActionCode;
    client_action: "OPEN_ROUTE_EDITOR" | null;
    route_public_id: string | null;
    comparison: {
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
        affected_variant_count: number | null;
        affected_route_count: number | null;
    };
    message: string | null;
};

export type ReportMediaEvidenceResponse = {
    publicId: string;
    mimeType: string;
    byteSize: number;
    width: number | null;
    height: number | null;
    note: string | null;
    sortOrder: number;
    published: boolean;
};

export type StatusEventResponse = {
    old_status_code: string | null;
    new_status_code: string;
    actor_display_name: string | null;
    note: string | null;
    created_at: string;
};

export type FollowupResponse = {
    actor_type: string;
    actor_display_name: string | null;
    message: string;
    created_at: string;
};

export type PointSummaryResponse = {
    total_points: number;
    lifetime_points_earned: number;
    lifetime_points_removed: number;
    updated_at: string;
};

export type RewardResult = {
    report: AdminReportResponse;
    summary: PointSummaryResponse;
};

export type AdminPermanentDeleteResult = {
    deleted: true;
    public_id: string;
    media_cleanup_warning: string | null;
};

export type ReportViewer = {
    /** JWT subject (public_id uuid) when authenticated, else null. */
    jwtSub: string | null;
    /** Roles from the verified JWT (used only for admin rate-limit bypass). */
    roles: string[];
    /** x-anonymous-id header (or body) when present. */
    anonymousId: string | null;
};

export type CreateReportResult = {
    /** false when an existing duplicate is returned instead of inserting a new row. */
    created: boolean;
    report: ReportResponse;
    /** Human-facing notice when a duplicate was detected. */
    message: string | null;
};

export class ReportsService {
    private readonly applyRepo: ReportsApplyRepository;

    constructor(
        private readonly reportsRepo: ReportsRepository,
        private readonly mediaRepo: MediaRepository,
        private readonly fieldRepo: Pick<FieldRepository, "loadRevisionParts">,
        prisma: PrismaClient,
        transportRepo: Pick<
            TransportRepository,
            | "applyMoveStopInTx"
            | "applyRemoveStopFromVariantInTx"
            | "applyCreateAndInsertStopInTx"
            | "applyUpdateStopDetailsInTx"
        >,
        private readonly objectStore: Pick<ObjectStore, "deleteObject"> | null = null,
        private readonly mediaBuckets: { privateBucket: string; publicBucket: string } | null = null
    ) {
        this.applyRepo = new ReportsApplyRepository(prisma, reportsRepo, fieldRepo, transportRepo);
    }

    async create(
        viewer: ReportViewer,
        body: ReportCreateBody,
        audit: AuditContext
    ): Promise<CreateReportResult> {
        const authenticated = viewer.jwtSub !== null;
        let createdBy: bigint | null = null;
        let emailVerified = false;
        if (authenticated) {
            const user = await this.reportsRepo.findActiveUserByPublicId(viewer.jwtSub!);
            createdBy = user?.id ?? null;
            emailVerified = user?.emailVerified ?? false;
        }
        const isAnonymous = !authenticated;

        const anonymousId = body.anonymousId?.trim() || viewer.anonymousId?.trim() || null;
        if (isAnonymous && !anonymousId) {
            throw new ReportsError("anonymous_id is required for anonymous reports", 400);
        }

        const isMapPoint = body.targetEntityType === "map_point";
        const isTourismReview = body.targetEntityType === "tourism_review";
        let targetEntityId: bigint | null =
            isMapPoint || body.targetEntityId === undefined ? null : BigInt(body.targetEntityId);

        if (isTourismReview) {
            const reviewPublicId = body.targetPublicId?.trim();
            if (!reviewPublicId) {
                throw new ReportsError(
                    "targetPublicId is required for tourism_review targets",
                    400
                );
            }
            const resolved = await this.reportsRepo.findTourismReviewIdByPublicId(reviewPublicId);
            if (!resolved) {
                throw new ReportsError("Tourism review not found", 404);
            }
            targetEntityId = resolved;
        }

        const latitude = body.latitude ?? null;
        const longitude = body.longitude ?? null;

        // Counting key for limit + duplicate checks: created_by, else anonymous_id.
        const submitterKey =
            createdBy !== null
                ? { createdBy, anonymousId: null }
                : isAnonymous && anonymousId
                  ? { createdBy: null, anonymousId }
                  : null;

        const isAdmin = viewer.roles.includes("admin") || viewer.roles.includes("super_admin");

        // 1. Duplicate protection — only ever matches the SAME submitter's recent
        //    reports; never auto-rejects across different users.
        if (submitterKey) {
            const duplicatePublicId = await this.reportsRepo.findRecentDuplicate({
                ...submitterKey,
                reportTypeCode: body.reportTypeCode,
                targetEntityType: body.targetEntityType,
                targetEntityId,
                latitude,
                longitude,
            });
            if (duplicatePublicId) {
                const existing = await this.reportsRepo.findByPublicId(duplicatePublicId);
                if (existing) {
                    return {
                        created: false,
                        report: toReportResponse(existing),
                        message: "A similar report was submitted recently; showing your existing report.",
                    };
                }
            }
        }

        // 2. DB-based rate limiting (admins bypass; no key ⇒ cannot count, so skip).
        if (submitterKey && !isAdmin) {
            const limit = resolveRateLimit({ isAnonymous, emailVerified });
            const stats = await this.reportsRepo.getSubmissionStats(submitterKey);
            if (stats.count24h >= limit.maxPerDay) {
                throw new ReportsError(REPORT_RATE_LIMIT_MESSAGE, 429);
            }
            if (
                stats.lastCreatedAt &&
                Date.now() - stats.lastCreatedAt.getTime() < limit.cooldownMs
            ) {
                throw new ReportsError(REPORT_RATE_LIMIT_MESSAGE, 429);
            }
        }

        const created = await this.reportsRepo.createReport({
            createdBy,
            anonymousId: isAnonymous ? anonymousId : null,
            isAnonymous,
            // Only signed-in reports that resolve to a real user can earn points.
            eligibleForPoints: createdBy !== null,
            reportTypeCode: body.reportTypeCode,
            reasonCode: body.reasonCode?.trim() || null,
            targetEntityType: body.targetEntityType,
            targetEntityId,
            targetPublicId: body.targetPublicId ?? null,
            title: body.title?.trim() || null,
            description: body.description.trim(),
            latitude,
            longitude,
        });

        return { created: true, report: toReportResponse(created), message: null };
    }

    async listMine(jwtSub: string, limit: number): Promise<ReportResponse[]> {
        const userId = await this.requireUserId(jwtSub, 401, "User not found");
        const rows = await this.reportsRepo.listForUser(userId, limit);
        return rows.map(toReportResponse);
    }

    async getForViewer(
        publicId: string,
        viewer: ReportViewer
    ): Promise<ReportResponse & { followups: FollowupResponse[]; status_events: StatusEventResponse[] }> {
        const report = await this.reportsRepo.findByPublicId(publicId);
        if (!report) {
            throw new ReportsError("Report not found", 404);
        }

        await this.assertViewerCanRead(report, viewer);

        const [events, followups] = await Promise.all([
            this.reportsRepo.listStatusEvents(report.id),
            // Anonymous reports never have follow-ups in the MVP.
            report.is_anonymous ? Promise.resolve<FollowupRow[]>([]) : this.reportsRepo.listFollowups(report.id),
        ]);

        return {
            ...toReportResponse(report),
            status_events: events.map(toStatusEventResponse),
            followups: followups.map(toFollowupResponse),
        };
    }

    async addUserFollowup(
        publicId: string,
        viewer: ReportViewer,
        message: string
    ): Promise<ReportResponse & { followups: FollowupResponse[] }> {
        const userId = await this.requireUserId(viewer.jwtSub ?? "", 401, "User not found");
        const report = await this.reportsRepo.findByPublicId(publicId);
        if (!report) {
            throw new ReportsError("Report not found", 404);
        }
        if (report.is_anonymous || report.created_by === null) {
            throw new ReportsError("Anonymous reports do not support follow-ups", 400);
        }
        if (report.created_by !== userId) {
            throw new ReportsError("You can only reply to your own reports", 403);
        }
        if (report.status_code !== "needs_more_info") {
            throw new ReportsError("You can only reply when the report needs more info", 409);
        }

        const updated = await this.reportsRepo.addUserReply({
            reportId: report.id,
            userId,
            fromStatusCode: report.status_code,
            message: message.trim(),
        });
        const followups = await this.reportsRepo.listFollowups(report.id);
        return { ...toReportResponse(updated), followups: followups.map(toFollowupResponse) };
    }

    // --- Admin ---

    async adminList(query: AdminReportsQuery): Promise<{
        items: AdminReportResponse[];
        total: number;
        page: number;
        pageSize: number;
    }> {
        const { items, total } = await this.reportsRepo.listAdmin({
            statusCode: query.status,
            reportTypeCode: query.type,
            adminAreaId: query.adminAreaId !== undefined ? BigInt(query.adminAreaId) : undefined,
            targetEntityType: query.targetEntityType,
            sourceCode: query.source,
            routeCode: query.routeCode,
            variantCode: query.variantCode,
            isAnonymous: query.anonymous,
            createdFrom: query.createdFrom,
            createdTo: query.createdTo,
            page: query.page,
            pageSize: query.pageSize,
        });
        return {
            items: items.map((row) => toAdminReportResponse(row)),
            total,
            page: query.page,
            pageSize: query.pageSize,
        };
    }

    // --- Analytics ---

    analyticsSummary(): Promise<ReportAnalyticsSummaryRow> {
        return this.reportsRepo.analyticsSummary();
    }

    analyticsByType(): Promise<ReportAnalyticsCodeCountRow[]> {
        return this.reportsRepo.analyticsByType();
    }

    analyticsByStatus(): Promise<ReportAnalyticsCodeCountRow[]> {
        return this.reportsRepo.analyticsByStatus();
    }

    async analyticsByRegion(): Promise<ReportRegionCountResponse[]> {
        const rows = await this.reportsRepo.analyticsByRegion();
        return rows.map((row) => ({
            region_id: row.region_id !== null ? row.region_id.toString() : null,
            region_name: row.region_name,
            count: row.count,
        }));
    }

    analyticsAnonymousVsLoggedIn(): Promise<ReportAnalyticsAnonymousRow> {
        return this.reportsRepo.analyticsAnonymousVsLoggedIn();
    }

    async adminGet(
        publicId: string
    ): Promise<
        AdminReportResponse & {
            followups: FollowupResponse[];
            status_events: StatusEventResponse[];
            media: ReportMediaEvidenceResponse[];
        }
    > {
        const report = await this.requireReport(publicId);
        const [events, followups, canonical, media, currentRevision] = await Promise.all([
            this.reportsRepo.listStatusEvents(report.id),
            this.reportsRepo.listFollowups(report.id),
            this.loadCanonicalTarget(report),
            this.mediaRepo.listReadyPrivateForReport(report.id),
            this.loadCurrentSnapshotRevision(report.source_code),
        ]);
        const base = toAdminReportResponse(report, canonical, currentRevision);
        const review = await this.buildReview(report, base.field, canonical.canonical_target);
        return {
            ...base,
            review,
            status_events: events.map(toStatusEventResponse),
            followups: followups.map(toFollowupResponse),
            media: media.map(toMediaEvidenceResponse),
        };
    }

    /**
     * Typed apply: locks the report, loads trusted proposal data, applies
     * canonical transport mutations in one transaction, audits, and resolves.
     */
    async adminApply(
        publicId: string,
        body: AdminApplyBody,
        audit: AuditContext
    ): Promise<AdminApplyResult> {
        try {
            const result = await this.applyRepo.apply({
                reportPublicId: publicId,
                action: body.action,
                expectedCanonicalRevision: body.expectedCanonicalRevision,
                audit,
            });
            const currentRevision = await this.loadCurrentSnapshotRevision(result.report.source_code);
            const canonical = await this.loadCanonicalTarget(result.report);
            const field = toFieldContext(result.report, currentRevision);
            const review = await this.buildReview(result.report, field, canonical.canonical_target);
            return {
                report: {
                    ...toAdminReportResponse(result.report, canonical, currentRevision),
                    review,
                },
                applied: result.applied,
                idempotent: result.idempotent,
                action: result.action,
                client_action: result.client_action,
                route_public_id: result.route_public_id,
                comparison: result.comparison,
                message: result.message,
            };
        } catch (error) {
            if (error instanceof ReportsApplyError) {
                throw new ReportsError(error.message, error.statusCode);
            }
            throw error;
        }
    }

    private async buildReview(
        report: ReportRow,
        field: FieldReportAdminContext | null,
        currentCanonical: CanonicalTargetPoint | null
    ): Promise<ReportReview | null> {
        if (!isFieldSurveySource(report.source_code) || !field) {
            return toReportReview({
                reportId: report.public_id,
                reportTypeCode: report.report_type_code,
                statusCode: report.status_code,
                sourceCode: report.source_code,
                timestamp: (report.observed_at ?? report.created_at).toISOString(),
                field,
                currentCanonical,
                affectedRouteCount: 0,
                previousStop: null,
                nextStop: null,
            });
        }

        const stopPublicId =
            field.stop_public_id ??
            (report.report_type_code === "new_stop" ? field.previous_stop_public_id : null);
        const focusSequence =
            report.report_type_code === "new_stop"
                ? field.previous_stop_sequence
                : field.stop_sequence;
        const [affectedRouteCount, neighbors, mapWindow] = await Promise.all([
            stopPublicId ? this.reportsRepo.countAffectedRoutesForStop(stopPublicId) : Promise.resolve(0),
            this.reportsRepo.findReviewNeighborStops({
                variantPublicId: field.variant_public_id,
                stopSequence:
                    report.report_type_code === "new_stop"
                        ? field.previous_stop_sequence
                        : field.stop_sequence,
                previousStopPublicId:
                    report.report_type_code === "new_stop" ? field.previous_stop_public_id : null,
                nextStopPublicId: field.next_stop_public_id,
            }),
            this.reportsRepo.findReviewMapWindow({
                variantPublicId: field.variant_public_id,
                focusSequence,
                focusStopPublicId: stopPublicId,
            }),
        ]);

        let previousStop = neighbors.previous;
        let nextStop = neighbors.next;
        // For ordinary stop reports, neighbors come from live sequence lookup.
        // For new_stop, previous is the anchor; prefer report sequence on previous when known.
        if (report.report_type_code === "new_stop" && previousStop) {
            previousStop = {
                ...previousStop,
                sequence: field.previous_stop_sequence ?? previousStop.sequence,
                name: previousStop.name ?? field.stop_name,
            };
        }

        const targetStopPublicId =
            report.report_type_code === "new_stop" ? null : field.stop_public_id;
        const mapContext = {
            stops: labelReviewMapStops({
                stops: mapWindow,
                previousStopPublicId: previousStop?.public_id ?? field.previous_stop_public_id,
                targetStopPublicId,
                nextStopPublicId: nextStop?.public_id ?? field.next_stop_public_id,
            }),
        };

        return toReportReview({
            reportId: report.public_id,
            reportTypeCode: report.report_type_code,
            statusCode: report.status_code,
            sourceCode: report.source_code,
            timestamp: (report.observed_at ?? report.created_at).toISOString(),
            field,
            currentCanonical,
            affectedRouteCount,
            previousStop,
            nextStop,
            mapContext: mapContext.stops.length > 0 ? mapContext : null,
        });
    }

    async adminChangeStatus(
        publicId: string,
        statusCode: string,
        note: string | undefined,
        audit: AuditContext
    ): Promise<AdminReportResponse> {
        // Status changes never publish media. Public stop photos require an explicit admin publish.
        const report = await this.requireReport(publicId);
        assertAdminStatusTransition(report.status_code, statusCode, report.source_code);
        const updated = await this.reportsRepo.changeStatus({
            reportId: report.id,
            fromStatusCode: report.status_code,
            toStatusCode: statusCode,
            note: note?.trim() || null,
            audit,
        });
        return toAdminReportResponse(updated);
    }

    async adminRequestInfo(
        publicId: string,
        message: string,
        audit: AuditContext
    ): Promise<AdminReportResponse & { followups: FollowupResponse[] }> {
        const report = await this.requireReport(publicId);
        if (isFieldSurveySource(report.source_code)) {
            throw new ReportsError(
                "Field survey reports do not use request-info. Review in the transport editor, then resolve or reject.",
                409
            );
        }
        if (report.is_anonymous || report.created_by === null) {
            throw new ReportsError("Anonymous reports do not support follow-ups", 400);
        }
        if (!REQUEST_INFO_ALLOWED_FROM.includes(report.status_code as (typeof REQUEST_INFO_ALLOWED_FROM)[number])) {
            throw new ReportsError(
                `Cannot request more info while the report is '${report.status_code}'`,
                409
            );
        }
        const updated = await this.reportsRepo.requestInfo({
            reportId: report.id,
            fromStatusCode: report.status_code,
            message: message.trim(),
            audit,
        });
        const followups = await this.reportsRepo.listFollowups(report.id);
        return { ...toAdminReportResponse(updated), followups: followups.map(toFollowupResponse) };
    }

    async adminUpdateNote(
        publicId: string,
        adminNote: string | null,
        audit: AuditContext
    ): Promise<AdminReportResponse> {
        const report = await this.requireReport(publicId);
        const updated = await this.reportsRepo.updateAdminNote({
            reportId: report.id,
            adminNote: adminNote?.trim() || null,
            audit,
        });
        return toAdminReportResponse(updated);
    }

    async adminRewardPoints(
        publicId: string,
        input: { pointsDelta: number; reasonCode: string; note?: string },
        audit: AuditContext
    ): Promise<RewardResult> {
        const report = await this.requireReport(publicId);

        // Eligibility — points are never granted automatically; admin must act and
        // all of these must hold (see endpoint contract).
        if (isFieldSurveySource(report.source_code)) {
            throw new ReportsError("Field survey reports cannot receive points", 409);
        }
        if (report.is_anonymous || report.created_by === null) {
            throw new ReportsError("Anonymous reports cannot receive points", 400);
        }
        if (report.status_code !== "accepted") {
            throw new ReportsError("Points can only be rewarded for accepted reports", 409);
        }
        if (!report.eligible_for_points) {
            throw new ReportsError("Report is not eligible for points", 400);
        }
        if (report.reward_ledger_id !== null) {
            throw new ReportsError("A reward has already been granted for this report", 409);
        }

        const { report: updated, summary } = await this.reportsRepo.grantReward({
            reportId: report.id,
            targetUserId: report.created_by,
            pointsDelta: input.pointsDelta,
            reasonCode: input.reasonCode,
            note: input.note?.trim() || null,
            audit,
        });
        return { report: toAdminReportResponse(updated), summary: toPointSummaryResponse(summary) };
    }

    /**
     * Permanently delete a rejected report. DB commit first; exact storage keys cleaned after.
     * Storage failures return a warning without rolling back the report delete.
     */
    async adminPermanentDelete(
        publicId: string,
        audit: AuditContext
    ): Promise<AdminPermanentDeleteResult> {
        let deleted;
        try {
            deleted = await this.reportsRepo.permanentDeleteRejected(publicId, audit);
        } catch (error) {
            if (error instanceof ReportDeleteNotRejectedError) {
                throw new ReportsError(error.message, 409);
            }
            throw error;
        }
        if (!deleted) {
            throw new ReportsError("Report not found", 404);
        }

        const media_cleanup_warning = await this.cleanupDeletedReportStorage(deleted.storageObjects);
        return {
            deleted: true,
            public_id: deleted.publicId,
            media_cleanup_warning,
        };
    }

    private async cleanupDeletedReportStorage(
        storageObjects: Array<{ objectKey: string; storageScope: string }>
    ): Promise<string | null> {
        if (storageObjects.length === 0) {
            return null;
        }
        if (!this.objectStore || !this.mediaBuckets) {
            const message = `Report deleted, but media storage is not configured; ${storageObjects.length} object(s) were not removed from storage.`;
            console.error(`[reports] ${message}`);
            return message;
        }

        const failures: string[] = [];
        for (const object of storageObjects) {
            const bucket =
                object.storageScope === "public"
                    ? this.mediaBuckets.publicBucket
                    : this.mediaBuckets.privateBucket;
            try {
                await this.objectStore.deleteObject({
                    bucket,
                    objectKey: object.objectKey,
                });
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                failures.push(object.objectKey);
                console.error(
                    `[reports] media cleanup failed for exact key ${object.objectKey} in ${bucket}: ${detail}`
                );
            }
        }

        if (failures.length === 0) {
            return null;
        }
        return `Report deleted, but ${failures.length} media object(s) could not be removed from storage. Database rows were cleaned; retry storage cleanup for the exact keys only.`;
    }

    private async assertViewerCanRead(report: ReportRow, viewer: ReportViewer): Promise<void> {
        if (report.created_by !== null) {
            // Authored report: only the owner may read it via the public endpoint.
            const userId = viewer.jwtSub ? await this.reportsRepo.findActiveUserIdByPublicId(viewer.jwtSub) : null;
            if (userId === null || userId !== report.created_by) {
                throw new ReportsError("Report not found", 404);
            }
            return;
        }
        // Anonymous report: a matching anonymous_id acts as the access token.
        const anon = viewer.anonymousId?.trim() || null;
        if (!report.anonymous_id || !anon || anon !== report.anonymous_id) {
            throw new ReportsError("Report not found", 404);
        }
    }

    private async requireReport(publicId: string): Promise<ReportRow> {
        const report = await this.reportsRepo.findByPublicId(publicId);
        if (!report) {
            throw new ReportsError("Report not found", 404);
        }
        return report;
    }

    private async requireUserId(jwtSub: string, status: number, message: string): Promise<bigint> {
        const userId = jwtSub ? await this.reportsRepo.findActiveUserIdByPublicId(jwtSub) : null;
        if (userId === null) {
            throw new ReportsError(message, status);
        }
        return userId;
    }

    private async loadCanonicalTarget(
        report: ReportRow
    ): Promise<{ canonical_target: CanonicalTargetPoint | null; distance_m: number | null }> {
        const stopPublicId = fieldStopPublicIdOf(report);
        if (!stopPublicId || !isFieldSurveySource(report.source_code)) {
            return { canonical_target: null, distance_m: null };
        }
        const lat = report.latitude !== null ? Number(report.latitude) : null;
        const lng = report.longitude !== null ? Number(report.longitude) : null;
        const point = await this.reportsRepo.findCanonicalStopPoint({
            stopPublicId,
            reportLatitude: lat,
            reportLongitude: lng,
        });
        if (!point) {
            return { canonical_target: null, distance_m: null };
        }
        return {
            canonical_target: { latitude: point.latitude, longitude: point.longitude },
            distance_m: point.distance_m,
        };
    }

    private async loadCurrentSnapshotRevision(sourceCode: string | null | undefined): Promise<string | null> {
        if (!isFieldSurveySource(sourceCode)) {
            return null;
        }
        const parts = await this.fieldRepo.loadRevisionParts();
        return snapshotRevisionFromParts(parts);
    }
}

function toReportResponse(row: ReportRow): ReportResponse {
    return {
        public_id: row.public_id,
        is_anonymous: row.is_anonymous,
        eligible_for_points: row.eligible_for_points,
        report_type: { code: row.report_type_code, name: row.report_type_name },
        status: { code: row.status_code, name: row.status_name },
        reason_code: row.reason_code,
        target_entity_type: row.target_entity_type,
        target_entity_id: row.target_entity_id !== null ? row.target_entity_id.toString() : null,
        target_public_id: row.target_public_id,
        title: row.title,
        description: row.description,
        latitude: row.latitude !== null ? Number(row.latitude) : null,
        longitude: row.longitude !== null ? Number(row.longitude) : null,
        admin_area_id: row.admin_area_id !== null ? row.admin_area_id.toString() : null,
        admin_area_name: row.admin_area_name ?? null,
        priority: row.priority,
        confidence_score: row.confidence_score,
        admin_note: row.admin_note,
        reviewed_at: row.reviewed_at ? row.reviewed_at.toISOString() : null,
        reward_granted_at: row.reward_granted_at ? row.reward_granted_at.toISOString() : null,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
    };
}

function toAdminReportResponse(
    row: ReportRow,
    canonical?: { canonical_target: CanonicalTargetPoint | null; distance_m: number | null },
    currentSnapshotRevision: string | null = null
): AdminReportResponse {
    return {
        ...toReportResponse(row),
        anonymous_id: row.anonymous_id,
        author:
            row.author_public_id && row.author_email
                ? {
                      public_id: row.author_public_id,
                      display_name: row.author_display_name,
                      email: row.author_email,
                  }
                : null,
        source_code: row.source_code ?? "public",
        observed_at: row.observed_at ? row.observed_at.toISOString() : null,
        location_accuracy_m:
            row.location_accuracy_m === null || row.location_accuracy_m === undefined
                ? null
                : Number(row.location_accuracy_m),
        field: toFieldContext(row, currentSnapshotRevision),
        canonical_target: canonical?.canonical_target ?? null,
        distance_m: canonical?.distance_m ?? null,
        media_count: Number(row.media_count ?? 0),
        review: null,
    };
}

function toMediaEvidenceResponse(row: ReportMediaEvidenceRow): ReportMediaEvidenceResponse {
    return {
        publicId: row.public_id,
        mimeType: row.mime_type,
        byteSize: Number(row.byte_size),
        width: row.width,
        height: row.height,
        note: row.note,
        sortOrder: row.sort_order,
        published: row.published === true,
    };
}

function toStatusEventResponse(row: StatusEventRow): StatusEventResponse {
    return {
        old_status_code: row.old_status_code,
        new_status_code: row.new_status_code,
        actor_display_name: row.actor_display_name,
        note: row.note,
        created_at: row.created_at.toISOString(),
    };
}

function toPointSummaryResponse(row: PointSummaryRow): PointSummaryResponse {
    return {
        total_points: row.total_points,
        lifetime_points_earned: row.lifetime_points_earned,
        lifetime_points_removed: row.lifetime_points_removed,
        updated_at: row.updated_at.toISOString(),
    };
}

function toFollowupResponse(row: FollowupRow): FollowupResponse {
    return {
        actor_type: row.actor_type,
        actor_display_name: row.actor_display_name,
        message: row.message,
        created_at: row.created_at.toISOString(),
    };
}
