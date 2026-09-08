import { canonicalYbsVariantIdentity } from "../transport/ybs-direction.js";
import { ReportsRepository } from "../reports/reports.repo.js";
import type { FieldReportCreateBody, FieldReportPatchBody } from "./field-reports.schema.js";
import { fieldReportDescription } from "./field-reports.schema.js";
import {
    FieldReportsRepository,
    toReportData,
    type FieldReportRow,
} from "./field-reports.repo.js";
import { SurveySessionsError, SurveySessionsService } from "./survey-sessions.service.js";

export class FieldReportsError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code: string = "FIELD_REPORT_ERROR"
    ) {
        super(message);
        this.name = "FieldReportsError";
    }
}

export type FieldReportResponse = {
    publicId: string;
    reportTypeCode: string;
    statusCode: string;
    sourceCode: "field_survey";
    observedAt: string;
    location: { lat: number; lng: number; accuracyM: number | null };
    target: { entityType: string | null; publicId: string | null };
    context: Record<string, unknown>;
    description: string;
    adminAreaId: string | null;
    surveySessionPublicId: string | null;
    createdAt: string;
    updatedAt: string;
};

export class FieldReportsService {
    constructor(
        private readonly fieldRepo: FieldReportsRepository,
        private readonly reportsRepo: ReportsRepository,
        private readonly surveySessions?: SurveySessionsService
    ) {}

    async create(jwtSub: string, body: FieldReportCreateBody): Promise<{ created: boolean; report: FieldReportResponse }> {
        const createdBy = await this.requireUserId(jwtSub);
        await this.assertTargets(body);
        let surveySessionId: bigint | null = null;
        if (body.surveySession) {
            if (!this.surveySessions) {
                throw new FieldReportsError("Survey sessions are unavailable", 500, "SESSION_UNAVAILABLE");
            }
            try {
                const session = await this.surveySessions.requireOwnedForReport(
                    createdBy,
                    body.surveySession,
                    body.context.variantPublicId,
                    body.observedAt
                );
                surveySessionId = session.session_id;
            } catch (error) {
                if (error instanceof SurveySessionsError) {
                    throw new FieldReportsError(error.message, error.statusCode, error.code);
                }
                throw error;
            }
        }
        const result = await this.fieldRepo.insertFieldReport({
            clientPublicId: body.clientPublicId,
            createdBy,
            reportTypeCode: body.reportTypeCode,
            description: fieldReportDescription(body),
            latitude: body.location.lat,
            longitude: body.location.lng,
            accuracyM: body.location.accuracyM ?? null,
            observedAt: body.observedAt,
            targetEntityType: body.target.entityType,
            targetPublicId: body.target.publicId ?? null,
            reportData: toReportData(body),
            surveySessionId,
        });
        this.assertOwnedFieldRow(result.row, createdBy);
        if (
            (result.row.survey_session_id === null) !== (surveySessionId === null) ||
            (result.row.survey_session_id !== null &&
                surveySessionId !== null &&
                BigInt(result.row.survey_session_id) !== BigInt(surveySessionId))
        ) {
            throw new FieldReportsError(
                "This report id is already associated with another survey session",
                409,
                "REPORT_SESSION_CONFLICT"
            );
        }
        if (!result.created) {
            this.assertIdempotentReplay(result.row, body);
        }
        return { created: result.created, report: toResponse(result.row) };
    }

    async get(jwtSub: string, publicId: string): Promise<FieldReportResponse> {
        const createdBy = await this.requireUserId(jwtSub);
        const row = await this.requireOwned(publicId, createdBy);
        return toResponse(row);
    }

    async patch(jwtSub: string, publicId: string, body: FieldReportPatchBody): Promise<FieldReportResponse> {
        const createdBy = await this.requireUserId(jwtSub);
        const existing = await this.requireOwned(publicId, createdBy);
        if (existing.status_code !== "submitted") {
            throw new FieldReportsError("This report can no longer be edited", 409, "REPORT_LOCKED");
        }

        const nextTarget = body.target ?? {
            entityType: existing.target_entity_type as FieldReportCreateBody["target"]["entityType"],
            publicId: existing.target_public_id ?? undefined,
        };
        const existingContext = asContext(existing.report_data);
        const nextContext = body.context ?? existingContext;
        if (body.target || body.context) {
            await this.assertTargets({
                ...syntheticCreate(existing, body),
                target: {
                    entityType: nextTarget.entityType,
                    publicId: nextTarget.publicId,
                },
                context: nextContext,
            });
        }

        const updated = await this.fieldRepo.updateFieldReport({
            publicId,
            createdBy,
            description:
                body.description !== undefined || body.note !== undefined
                    ? fieldReportDescription(body)
                    : undefined,
            latitude: body.location?.lat,
            longitude: body.location?.lng,
            accuracyM: body.location ? (body.location.accuracyM ?? null) : undefined,
            observedAt: body.observedAt,
            reportTypeCode: body.reportTypeCode,
            targetEntityType: body.target?.entityType,
            targetPublicId: body.target ? (body.target.publicId ?? null) : undefined,
            reportData: body.context ? toReportData(syntheticCreate(existing, body)) : undefined,
        });
        if (!updated) {
            throw new FieldReportsError("This report can no longer be edited", 409, "REPORT_LOCKED");
        }
        return toResponse(updated);
    }

    async addFollowup(jwtSub: string, publicId: string, message: string): Promise<FieldReportResponse> {
        const createdBy = await this.requireUserId(jwtSub);
        const row = await this.requireOwned(publicId, createdBy);
        if (row.status_code === "resolved" || row.status_code === "rejected") {
            throw new FieldReportsError("Follow-ups are not allowed on a closed report", 409, "REPORT_LOCKED");
        }
        const numericId = await this.fieldRepo.findByPublicId(publicId);
        if (!numericId) {
            throw new FieldReportsError("Report not found", 404, "NOT_FOUND");
        }
        const report = await this.reportsRepo.findByPublicId(publicId);
        if (!report) {
            throw new FieldReportsError("Report not found", 404, "NOT_FOUND");
        }
        await this.reportsRepo.insertFollowup({
            reportId: report.id,
            actorUserId: createdBy,
            actorType: "user",
            message,
        });
        const refreshed = await this.requireOwned(publicId, createdBy);
        return toResponse(refreshed);
    }

    private async requireUserId(jwtSub: string): Promise<bigint> {
        const userId = await this.reportsRepo.findActiveUserIdByPublicId(jwtSub);
        if (userId === null) {
            throw new FieldReportsError("User not found", 401, "UNAUTHORIZED");
        }
        return userId;
    }

    private async requireOwned(publicId: string, createdBy: bigint): Promise<FieldReportRow> {
        const row = await this.fieldRepo.findByPublicId(publicId);
        if (!row || row.source_code !== "field_survey") {
            throw new FieldReportsError("Report not found", 404, "NOT_FOUND");
        }
        this.assertOwnedFieldRow(row, createdBy);
        return row;
    }

    private assertOwnedFieldRow(row: FieldReportRow, createdBy: bigint): void {
        if (row.source_code !== "field_survey") {
            throw new FieldReportsError("Report not found", 404, "NOT_FOUND");
        }
        if (BigInt(row.created_by) !== BigInt(createdBy)) {
            throw new FieldReportsError("This report id is already used", 409, "PUBLIC_ID_CONFLICT");
        }
    }

    private async assertTargets(body: {
        reportTypeCode: FieldReportCreateBody["reportTypeCode"];
        target: FieldReportCreateBody["target"];
        context: FieldReportCreateBody["context"];
    }): Promise<void> {
        const identity = canonicalYbsVariantIdentity("YBS-0", body.context.variantCode === "D0" ? 0 : 1);
        if (!identity || identity.directionName !== body.context.variantCode) {
            throw new FieldReportsError("variantCode must be D0 or D1", 400, "INVALID_VARIANT");
        }

        const isNewStop = body.reportTypeCode === "new_stop";
        const stopPublicId = isNewStop
            ? body.context.previousStopPublicId
            : body.target.entityType === "stop"
              ? body.target.publicId
              : body.context.stopPublicId;
        const stopSequence = isNewStop
            ? body.context.previousStopSequence
            : body.context.stopSequence;
        const routePublicId =
            body.target.entityType === "route" ? body.target.publicId : body.context.routePublicId;
        const variantPublicId =
            body.target.entityType === "variant" || body.target.entityType === "path"
                ? (body.target.publicId ?? body.context.variantPublicId)
                : body.context.variantPublicId;

        const lookup = await this.fieldRepo.lookupTargets({
            stopPublicId,
            routePublicId,
            variantPublicId,
            stopSequence,
            nextStopPublicId: isNewStop ? body.context.nextStopPublicId : undefined,
        });

        if (stopPublicId && !lookup.stopExists) {
            throw new FieldReportsError("Unknown stop public ID", 400, "INVALID_STOP");
        }
        if (routePublicId && !lookup.routeExists) {
            throw new FieldReportsError("Unknown route public ID", 400, "INVALID_ROUTE");
        }
        if (variantPublicId && !lookup.variantExists) {
            throw new FieldReportsError("Unknown variant public ID", 400, "INVALID_VARIANT");
        }
        if (routePublicId && lookup.routeExists && lookup.routeMode && lookup.routeCode) {
            if (lookup.routeMode !== "bus" || !lookup.routeCode.startsWith("YBS-")) {
                throw new FieldReportsError("Route is not a canonical YBS bus route", 400, "INVALID_ROUTE");
            }
        }
        if (variantPublicId && lookup.variantExists) {
            const expected = body.context.variantCode === "D0" ? 0 : 1;
            if (lookup.variantDirectionId !== expected) {
                throw new FieldReportsError("variantCode does not match the variant direction", 400, "INVALID_VARIANT");
            }
            if (
                routePublicId &&
                lookup.variantRoutePublicId &&
                lookup.variantRoutePublicId !== routePublicId
            ) {
                throw new FieldReportsError("Variant does not belong to the given route", 400, "INVALID_VARIANT");
            }
        }
        if (isNewStop) {
            if (!lookup.stopBelongsToVariant) {
                throw new FieldReportsError(
                    "Previous stop does not belong to this variant",
                    400,
                    "INVALID_STOP"
                );
            }
            if (body.context.nextStopPublicId && lookup.nextStopBelongsToVariant === false) {
                throw new FieldReportsError(
                    "Next stop does not belong to this variant",
                    400,
                    "INVALID_STOP"
                );
            }
            return;
        }
        if (lookup.stopOnVariant === false) {
            throw new FieldReportsError("Stop sequence does not match this variant", 400, "INVALID_STOP");
        }
    }

    private assertIdempotentReplay(row: FieldReportRow, body: FieldReportCreateBody): void {
        const stored = asContext(row.report_data);
        const sameType = row.report_type_code === body.reportTypeCode;
        const sameTarget =
            row.target_entity_type === body.target.entityType &&
            (row.target_public_id ?? null) === (body.target.publicId ?? null);
        const sameRoute = (stored.routePublicId ?? null) === (body.context.routePublicId ?? null);
        const sameVariant =
            (stored.variantPublicId ?? null) === (body.context.variantPublicId ?? null) &&
            stored.variantCode === body.context.variantCode;
        const sameSnapshot = stored.snapshotRevision === body.context.snapshotRevision;
        const samePrevious =
            (stored.previousStopPublicId ?? stored.stopPublicId ?? null) ===
                (body.context.previousStopPublicId ?? body.context.stopPublicId ?? null) &&
            (stored.previousStopSequence ?? stored.stopSequence ?? null) ===
                (body.context.previousStopSequence ?? body.context.stopSequence ?? null);
        const sameNext = (stored.nextStopPublicId ?? null) === (body.context.nextStopPublicId ?? null);
        const sameName = (stored.proposedStopName ?? null) === (body.context.proposedStopName ?? null);
        const sameSource = (stored.locationSource ?? null) === (body.context.locationSource ?? null);
        const samePoint =
            Math.abs(row.latitude - body.location.lat) < 1e-7 &&
            Math.abs(row.longitude - body.location.lng) < 1e-7;
        const newStopOk =
            body.reportTypeCode !== "new_stop" || (sameNext && sameName && sameSource && samePoint);
        if (!sameType || !sameTarget || !sameRoute || !sameVariant || !sameSnapshot || !samePrevious || !newStopOk) {
            throw new FieldReportsError(
                "This report id was already used with different evidence",
                409,
                "IDEMPOTENCY_CONFLICT"
            );
        }
    }
}

function asContext(reportData: unknown): FieldReportCreateBody["context"] {
    const data = reportData && typeof reportData === "object" ? (reportData as Record<string, unknown>) : {};
    const variantCode = data.variantCode === "D1" ? "D1" : "D0";
    return {
        snapshotRevision: String(data.snapshotRevision ?? "unknown"),
        routePublicId: typeof data.routePublicId === "string" ? data.routePublicId : undefined,
        variantPublicId: typeof data.variantPublicId === "string" ? data.variantPublicId : undefined,
        variantCode,
        stopPublicId: typeof data.stopPublicId === "string" ? data.stopPublicId : undefined,
        stopSequence: typeof data.stopSequence === "number" ? data.stopSequence : undefined,
        previousStopPublicId: typeof data.previousStopPublicId === "string" ? data.previousStopPublicId : undefined,
        previousStopSequence: typeof data.previousStopSequence === "number" ? data.previousStopSequence : undefined,
        nextStopPublicId: typeof data.nextStopPublicId === "string" ? data.nextStopPublicId : undefined,
        proposedStopName: typeof data.proposedStopName === "string" ? data.proposedStopName : undefined,
        locationSource:
            data.locationSource === "MAP_PICK" || data.locationSource === "GPS"
                ? data.locationSource
                : undefined,
        canonicalSnapshot: data.canonicalSnapshot,
    };
}

function syntheticCreate(existing: FieldReportRow, patch: FieldReportPatchBody): FieldReportCreateBody {
    const context = patch.context ?? asContext(existing.report_data);
    return {
        clientPublicId: existing.public_id,
        reportTypeCode: (patch.reportTypeCode ?? existing.report_type_code) as FieldReportCreateBody["reportTypeCode"],
        observedAt: patch.observedAt ?? existing.observed_at,
        location: patch.location ?? {
            lat: existing.latitude,
            lng: existing.longitude,
            accuracyM: existing.location_accuracy_m,
        },
        target: patch.target ?? {
            entityType: existing.target_entity_type as FieldReportCreateBody["target"]["entityType"],
            publicId: existing.target_public_id ?? undefined,
        },
        context,
        description: patch.description,
        note: patch.note,
    };
}

function toResponse(row: FieldReportRow): FieldReportResponse {
    const context = (row.report_data && typeof row.report_data === "object"
        ? row.report_data
        : {}) as Record<string, unknown>;
    return {
        publicId: row.public_id,
        reportTypeCode: row.report_type_code,
        statusCode: row.status_code,
        sourceCode: "field_survey",
        observedAt: row.observed_at.toISOString(),
        location: {
            lat: row.latitude,
            lng: row.longitude,
            accuracyM: row.location_accuracy_m,
        },
        target: {
            entityType: row.target_entity_type,
            publicId: row.target_public_id,
        },
        context,
        description: row.description,
        adminAreaId: row.admin_area_id !== null ? String(row.admin_area_id) : null,
        surveySessionPublicId: row.survey_session_public_id,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}
