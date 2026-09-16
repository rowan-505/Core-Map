import { canonicalYbsVariantIdentity } from "../transport/ybs-direction.js";
import {
    deriveSurveyAssignmentWorkStatus,
    isSurveyAssignmentRemaining,
} from "./survey-assignment-status.js";
import type {
    SurveyAssignmentCreateBody,
    SurveyAssignmentListQuery,
    SurveyAssignmentUpdateBody,
    SurveyAssignmentWorkStatus,
} from "./survey-assignments.schema.js";
import {
    SurveyAssignmentsRepository,
    type SurveyAssignmentRow,
} from "./survey-assignments.repo.js";

export class SurveyAssignmentsError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code: string
    ) {
        super(message);
        this.name = "SurveyAssignmentsError";
    }
}

export type SurveyAssignmentResponse = {
    publicId: string;
    surveyorPublicId: string;
    assignedByPublicId: string;
    routeVariantPublicId: string;
    route: { publicId: string; code: string };
    variantCode: "D0" | "D1";
    assignedDate: string;
    dueDate: string | null;
    status: "active" | "cancelled";
    cancelledAt: string | null;
    workStatus: SurveyAssignmentWorkStatus;
    remaining: boolean;
    createdAt: string;
    updatedAt: string;
};

export class SurveyAssignmentsService {
    constructor(private readonly repo: SurveyAssignmentsRepository) {}

    async list(
        jwtSub: string,
        roles: readonly string[],
        query: SurveyAssignmentListQuery
    ): Promise<{ items: SurveyAssignmentResponse[] }> {
        const isManager = roles.some((role) => role === "admin" || role === "super_admin");
        const isSurveyor = roles.includes("surveyor");

        let surveyorUserId: bigint | undefined;
        if (isManager) {
            if (query.surveyorPublicId) {
                const id = await this.repo.findActiveSurveyorUserIdByPublicId(query.surveyorPublicId);
                if (id === null) {
                    throw new SurveyAssignmentsError("Surveyor not found", 404, "SURVEYOR_NOT_FOUND");
                }
                surveyorUserId = id;
            }
        } else if (isSurveyor) {
            const selfId = await this.repo.findActiveUserIdByPublicId(jwtSub);
            if (selfId === null) {
                throw new SurveyAssignmentsError("User not found", 401, "UNAUTHORIZED");
            }
            surveyorUserId = selfId;
            if (query.status === "all" || query.status === "cancelled") {
                // Mobile must not download cancelled history by default; surveyors only see active.
                throw new SurveyAssignmentsError(
                    "Surveyors may only list active assignments",
                    403,
                    "FORBIDDEN"
                );
            }
        } else {
            throw new SurveyAssignmentsError("Forbidden", 403, "FORBIDDEN");
        }

        const rows = await this.repo.list({
            surveyorUserId,
            status: isSurveyor ? "active" : query.status,
        });
        return { items: rows.map(toResponse) };
    }

    async create(
        actorJwtSub: string,
        body: SurveyAssignmentCreateBody
    ): Promise<SurveyAssignmentResponse> {
        const assignedByUserId = await this.repo.findActiveUserIdByPublicId(actorJwtSub);
        if (assignedByUserId === null) {
            throw new SurveyAssignmentsError("User not found", 401, "UNAUTHORIZED");
        }
        const surveyorUserId = await this.repo.findActiveSurveyorUserIdByPublicId(
            body.surveyorPublicId
        );
        if (surveyorUserId === null) {
            throw new SurveyAssignmentsError("Surveyor not found", 404, "SURVEYOR_NOT_FOUND");
        }
        const routeVariantId = await this.repo.findActiveFieldVariantId(body.routeVariantPublicId);
        if (routeVariantId === null) {
            throw new SurveyAssignmentsError(
                "Route variant is not active",
                400,
                "INVALID_ROUTE_VARIANT"
            );
        }
        if (body.dueDate && body.dueDate < body.assignedDate) {
            throw new SurveyAssignmentsError(
                "dueDate must be on or after assignedDate",
                400,
                "INVALID_DUE_DATE"
            );
        }
        try {
            const row = await this.repo.create({
                surveyorUserId,
                assignedByUserId,
                routeVariantId,
                assignedDate: body.assignedDate,
                dueDate: body.dueDate ?? null,
            });
            return toResponse(row);
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new SurveyAssignmentsError(
                    "Active assignment already exists for this surveyor and variant",
                    409,
                    "ASSIGNMENT_EXISTS"
                );
            }
            throw error;
        }
    }

    async update(
        publicId: string,
        body: SurveyAssignmentUpdateBody
    ): Promise<SurveyAssignmentResponse> {
        const existing = await this.repo.findByPublicId(publicId);
        if (existing === null) {
            throw new SurveyAssignmentsError("Assignment not found", 404, "NOT_FOUND");
        }
        if (existing.status !== "active") {
            throw new SurveyAssignmentsError(
                "Cancelled assignments cannot be updated",
                409,
                "ASSIGNMENT_CANCELLED"
            );
        }
        const assignedDate =
            body.assignedDate ?? formatDate(existing.assigned_date);
        const dueDate =
            body.dueDate !== undefined
                ? body.dueDate
                : existing.due_date
                  ? formatDate(existing.due_date)
                  : null;
        if (dueDate && dueDate < assignedDate) {
            throw new SurveyAssignmentsError(
                "dueDate must be on or after assignedDate",
                400,
                "INVALID_DUE_DATE"
            );
        }
        const row = await this.repo.update({
            publicId,
            assignedDate: body.assignedDate,
            dueDate: body.dueDate,
        });
        if (row === null || row.status !== "active") {
            throw new SurveyAssignmentsError("Assignment not found", 404, "NOT_FOUND");
        }
        return toResponse(row);
    }

    async cancel(publicId: string): Promise<SurveyAssignmentResponse> {
        const existing = await this.repo.findByPublicId(publicId);
        if (existing === null) {
            throw new SurveyAssignmentsError("Assignment not found", 404, "NOT_FOUND");
        }
        if (existing.status === "cancelled") {
            return toResponse(existing);
        }
        const row = await this.repo.cancel(publicId, new Date());
        if (row === null) {
            throw new SurveyAssignmentsError("Assignment not found", 404, "NOT_FOUND");
        }
        return toResponse(row);
    }
}

function toResponse(row: SurveyAssignmentRow): SurveyAssignmentResponse {
    const identity = canonicalYbsVariantIdentity(row.route_code, row.direction_id);
    if (!identity) {
        throw new SurveyAssignmentsError("Survey assignment route is invalid", 500, "INVALID_ROUTE");
    }
    const workStatus = deriveSurveyAssignmentWorkStatus({
        hasSession: row.has_session,
        isFinished: row.is_finished,
    });
    return {
        publicId: row.public_id,
        surveyorPublicId: row.surveyor_public_id,
        assignedByPublicId: row.assigned_by_public_id,
        routeVariantPublicId: row.route_variant_public_id,
        route: { publicId: row.route_public_id, code: row.route_code },
        variantCode: identity.directionName,
        assignedDate: formatDate(row.assigned_date),
        dueDate: row.due_date ? formatDate(row.due_date) : null,
        status: row.status,
        cancelledAt: row.cancelled_at?.toISOString() ?? null,
        workStatus,
        remaining: isSurveyAssignmentRemaining({ status: row.status, workStatus }),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}

function formatDate(value: Date): string {
    return value.toISOString().slice(0, 10);
}

function isUniqueViolation(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
    );
}
