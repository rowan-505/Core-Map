import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { createMediaService, handleMediaError } from "../media/media.http.js";
import { postFieldReportMediaSchema } from "../media/media.openapi.js";
import { fieldReportMediaBodySchema } from "../media/media.schema.js";
import { ReportsRepository } from "../reports/reports.repo.js";
import {
    getFieldBootstrapSchema,
    getFieldReportSchema,
    patchFieldReportSchema,
    postFieldReportFollowupSchema,
    postFieldReportSchema,
    getSurveySessionSchema,
    getSurveySessionsSchema,
    getSurveyCompletionsSchema,
    patchSurveyAssignmentSchema,
    patchSurveySessionAbandonSchema,
    patchSurveySessionCompleteSchema,
    patchSurveySessionFinishSchema,
    patchSurveySessionReopenSchema,
    patchSurveySessionSummarySchema,
    postSurveyAssignmentCancelSchema,
    postSurveyAssignmentSchema,
    postSurveySessionSchema,
    putSurveyCompletionSchema,
    getSurveyAssignmentsSchema,
    getSurveyActivitySchema,
    getSurveyRouteCoverageSchema,
    getSurveyWorkHistorySchema,
    getSurveySessionTimelineSchema,
} from "./field.openapi.js";
import { FieldReportsRepository } from "./field-reports.repo.js";
import {
    FIELD_BOOTSTRAP_RATE_LIMIT,
    FIELD_MEDIA_ATTACH_RATE_LIMIT,
    FIELD_REPORT_CREATE_RATE_LIMIT,
    FIELD_REPORT_MUTATE_RATE_LIMIT,
    FIELD_REPORT_READ_RATE_LIMIT,
    FIELD_SESSION_RATE_LIMIT,
    fieldReportCreateBodySchema,
    fieldReportFollowupBodySchema,
    fieldReportPatchBodySchema,
    fieldReportPublicIdParamSchema,
} from "./field-reports.schema.js";
import { FieldReportsError, FieldReportsService } from "./field-reports.service.js";
import { fieldBootstrapQuerySchema } from "./field.schema.js";
import { FieldBootstrapRefresher } from "./field-bootstrap-refresh.js";
import { generateFieldBootstrapGzip } from "./field-bootstrap-generator.js";
import { serveFieldBootstrap } from "./field-bootstrap-serve.js";
import { createFieldBootstrapArtifactStore } from "./field-bootstrap-store-factory.js";
import { FieldRepository } from "./field.repo.js";
import { snapshotRevisionFromParts } from "./field-revision.js";
import { SurveyCompletionsRepository } from "./survey-completions.repo.js";
import {
    surveyCompletionPutBodySchema,
    surveyCompletionVariantParamSchema,
} from "./survey-completions.schema.js";
import { SurveyCompletionsError, SurveyCompletionsService } from "./survey-completions.service.js";
import {
    FIELD_ASSIGNMENT_RATE_LIMIT,
    surveyAssignmentCreateBodySchema,
    surveyAssignmentListQuerySchema,
    surveyAssignmentPublicIdParamSchema,
    surveyAssignmentUpdateBodySchema,
} from "./survey-assignments.schema.js";
import { SurveyAssignmentsRepository } from "./survey-assignments.repo.js";
import {
    SurveyAssignmentsError,
    SurveyAssignmentsService,
} from "./survey-assignments.service.js";
import {
    FIELD_ACTIVITY_RATE_LIMIT,
    surveyActivityListQuerySchema,
} from "./survey-activity.schema.js";
import { SurveyActivityRepository } from "./survey-activity.repo.js";
import { SurveyActivityError, SurveyActivityService } from "./survey-activity.service.js";
import { SurveyCoverageSurveyorRepository } from "./survey-coverage-surveyor.js";
import {
    FIELD_COVERAGE_RATE_LIMIT,
    surveyRouteCoverageQuerySchema,
} from "./survey-route-coverage.schema.js";
import { SurveyRouteCoverageRepository } from "./survey-route-coverage.repo.js";
import {
    SurveyRouteCoverageError,
    SurveyRouteCoverageService,
} from "./survey-route-coverage.service.js";
import {
    FIELD_WORK_HISTORY_RATE_LIMIT,
    surveySessionTimelineParamSchema,
    surveyWorkHistoryQuerySchema,
} from "./survey-work-history.schema.js";
import { SurveyWorkHistoryRepository } from "./survey-work-history.repo.js";
import {
    SurveyWorkHistoryError,
    SurveyWorkHistoryService,
} from "./survey-work-history.service.js";
import { SurveySessionsRepository } from "./survey-sessions.repo.js";
import {
    surveySessionClientIdParamSchema,
    surveySessionCreateBodySchema,
    surveySessionEndBodySchema,
    surveySessionFinishBodySchema,
    surveySessionListQuerySchema,
    surveySessionPublicIdParamSchema,
    surveySessionReopenBodySchema,
    surveySessionSummaryBodySchema,
} from "./survey-sessions.schema.js";
import { SurveySessionsError, SurveySessionsService } from "./survey-sessions.service.js";

function handleFieldReportsError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof FieldReportsError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    throw error;
}

function handleSurveySessionsError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof SurveySessionsError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    throw error;
}

function handleSurveyCompletionsError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof SurveyCompletionsError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    throw error;
}

function handleSurveyAssignmentsError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof SurveyAssignmentsError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    throw error;
}

function handleSurveyActivityError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof SurveyActivityError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    throw error;
}

function handleSurveyRouteCoverageError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof SurveyRouteCoverageError) {
        return reply.code(error.statusCode).send({
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
        });
    }
    throw error;
}

function handleSurveyWorkHistoryError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof SurveyWorkHistoryError) {
        return reply.code(error.statusCode).send({
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
        });
    }
    throw error;
}

function invalid(reply: FastifyReply, message: string, issues: unknown): FastifyReply {
    return reply.code(400).send({ code: "VALIDATION_ERROR", message, issues });
}

const fieldRoutes: FastifyPluginAsync = async (app) => {
    const bootstrapStore = await createFieldBootstrapArtifactStore();
    const bootstrapRefresher = new FieldBootstrapRefresher();
    const fieldRepo = new FieldRepository(app.prisma);
    const reportsRepo = new ReportsRepository(app.prisma);
    const surveySessions = new SurveySessionsService(new SurveySessionsRepository(app.prisma));
    const surveyCompletions = new SurveyCompletionsService(new SurveyCompletionsRepository(app.prisma));
    const surveyAssignments = new SurveyAssignmentsService(
        new SurveyAssignmentsRepository(app.prisma)
    );
    const surveyActivity = new SurveyActivityService(new SurveyActivityRepository(app.prisma));
    const coverageSurveyorRepo = new SurveyCoverageSurveyorRepository(app.prisma);
    const surveyRouteCoverage = new SurveyRouteCoverageService(
        new SurveyRouteCoverageRepository(app.prisma),
        coverageSurveyorRepo
    );
    const surveyWorkHistory = new SurveyWorkHistoryService(
        new SurveyWorkHistoryRepository(app.prisma),
        coverageSurveyorRepo
    );
    const fieldReports = new FieldReportsService(
        new FieldReportsRepository(app.prisma),
        reportsRepo,
        surveySessions
    );
    const fieldAuth = { preHandler: [app.authenticate, app.requireFieldSurveyor] };
    const assignmentReadAuth = {
        preHandler: [app.authenticate, app.requireSurveyAssignmentAccess],
    };
    const assignmentManageAuth = {
        preHandler: [app.authenticate, app.requireSurveyAssignmentManage],
    };
    const withLimit = (rateLimit: { max: number; timeWindow: string }) => ({
        ...fieldAuth,
        config: { rateLimit },
    });
    const withAssignmentReadLimit = (rateLimit: { max: number; timeWindow: string }) => ({
        ...assignmentReadAuth,
        config: { rateLimit },
    });
    const withAssignmentManageLimit = (rateLimit: { max: number; timeWindow: string }) => ({
        ...assignmentManageAuth,
        config: { rateLimit },
    });

    app.get(
        "/bootstrap",
        { schema: getFieldBootstrapSchema, ...withLimit(FIELD_BOOTSTRAP_RATE_LIMIT) },
        async (request, reply) => {
        const parsed = fieldBootstrapQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return invalid(reply, "Invalid field bootstrap query", parsed.error.flatten());
        }

        try {
            const outcome = await bootstrapRefresher.refresh({
                store: bootstrapStore,
                loadLiveRevision: async () =>
                    snapshotRevisionFromParts(await fieldRepo.loadRevisionParts()),
                writeSnapshot: (gzipPath) =>
                    generateFieldBootstrapGzip({
                        repo: fieldRepo,
                        gzipPath,
                        simplifyGeometry: true,
                    }),
            });
            if (outcome === "rebuilt") {
                request.log.info("field bootstrap snapshot refreshed from live transport data");
            }
        } catch (error) {
            request.log.error({ err: error }, "field bootstrap snapshot refresh failed");
        }

        return serveFieldBootstrap({
            request,
            reply,
            store: bootstrapStore,
            revision: parsed.data.revision,
        });
    });

    app.post(
        "/survey-sessions",
        { schema: postSurveySessionSchema, ...withLimit(FIELD_SESSION_RATE_LIMIT) },
        async (request, reply) => {
            const parsed = surveySessionCreateBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return invalid(reply, "Invalid survey session payload", parsed.error.flatten());
            }
            try {
                const result = await surveySessions.create(request.user.sub, parsed.data);
                return reply.code(result.created ? 201 : 200).send(result.session);
            } catch (error) {
                return handleSurveySessionsError(error, reply);
            }
        }
    );

    app.get(
        "/survey-sessions",
        { schema: getSurveySessionsSchema, ...withLimit(FIELD_SESSION_RATE_LIMIT) },
        async (request, reply) => {
            const parsed = surveySessionListQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return invalid(reply, "Invalid survey session query", parsed.error.flatten());
            }
            try {
                return reply.send(await surveySessions.list(request.user.sub, parsed.data));
            } catch (error) {
                return handleSurveySessionsError(error, reply);
            }
        }
    );

    app.get(
        "/survey-sessions/:publicId",
        { schema: getSurveySessionSchema, ...withLimit(FIELD_SESSION_RATE_LIMIT) },
        async (request, reply) => {
            const parsed = surveySessionPublicIdParamSchema.safeParse(request.params);
            if (!parsed.success) {
                return invalid(reply, "Invalid survey session id", parsed.error.flatten());
            }
            try {
                return reply.send(await surveySessions.get(request.user.sub, parsed.data.publicId));
            } catch (error) {
                return handleSurveySessionsError(error, reply);
            }
        }
    );

    async function endSurveySession(
        request: FastifyRequest,
        reply: FastifyReply,
        status: "completed" | "abandoned"
    ) {
        const params = surveySessionClientIdParamSchema.safeParse(request.params);
        const body = surveySessionEndBodySchema.safeParse(request.body);
        if (!params.success || !body.success) {
            return invalid(reply, "Invalid survey session completion", {
                params: params.success ? undefined : params.error.flatten(),
                body: body.success ? undefined : body.error.flatten(),
            });
        }
        try {
            const method =
                status === "completed"
                    ? surveySessions.complete.bind(surveySessions)
                    : surveySessions.abandon.bind(surveySessions);
            return reply.send(await method(request.user.sub, params.data.clientSessionId, body.data));
        } catch (error) {
            return handleSurveySessionsError(error, reply);
        }
    }

    app.patch(
        "/survey-sessions/:clientSessionId/complete",
        { schema: patchSurveySessionCompleteSchema, ...withLimit(FIELD_SESSION_RATE_LIMIT) },
        async (request, reply) => endSurveySession(request, reply, "completed")
    );

    app.patch(
        "/survey-sessions/:clientSessionId/abandon",
        { schema: patchSurveySessionAbandonSchema, ...withLimit(FIELD_SESSION_RATE_LIMIT) },
        async (request, reply) => endSurveySession(request, reply, "abandoned")
    );

    app.patch(
        "/survey-sessions/:clientSessionId/summary",
        { schema: patchSurveySessionSummarySchema, ...withLimit(FIELD_SESSION_RATE_LIMIT) },
        async (request, reply) => {
            const params = surveySessionClientIdParamSchema.safeParse(request.params);
            const body = surveySessionSummaryBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return invalid(reply, "Invalid survey session summary", {
                    params: params.success ? undefined : params.error.flatten(),
                    body: body.success ? undefined : body.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await surveySessions.syncSummary(
                        request.user.sub,
                        params.data.clientSessionId,
                        body.data
                    )
                );
            } catch (error) {
                return handleSurveySessionsError(error, reply);
            }
        }
    );

    app.patch(
        "/survey-sessions/:clientSessionId/finish",
        { schema: patchSurveySessionFinishSchema, ...withLimit(FIELD_SESSION_RATE_LIMIT) },
        async (request, reply) => {
            const params = surveySessionClientIdParamSchema.safeParse(request.params);
            const body = surveySessionFinishBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return invalid(reply, "Invalid survey session finish", {
                    params: params.success ? undefined : params.error.flatten(),
                    body: body.success ? undefined : body.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await surveySessions.finish(request.user.sub, params.data.clientSessionId, body.data)
                );
            } catch (error) {
                return handleSurveySessionsError(error, reply);
            }
        }
    );

    app.patch(
        "/survey-sessions/:clientSessionId/reopen",
        { schema: patchSurveySessionReopenSchema, ...withLimit(FIELD_SESSION_RATE_LIMIT) },
        async (request, reply) => {
            const params = surveySessionClientIdParamSchema.safeParse(request.params);
            const body = surveySessionReopenBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return invalid(reply, "Invalid survey session reopen", {
                    params: params.success ? undefined : params.error.flatten(),
                    body: body.success ? undefined : body.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await surveySessions.reopen(request.user.sub, params.data.clientSessionId, body.data)
                );
            } catch (error) {
                return handleSurveySessionsError(error, reply);
            }
        }
    );

    app.get(
        "/survey-completions",
        { schema: getSurveyCompletionsSchema, ...withLimit(FIELD_SESSION_RATE_LIMIT) },
        async (request, reply) => {
            try {
                return reply.send(await surveyCompletions.list(request.user.sub));
            } catch (error) {
                return handleSurveyCompletionsError(error, reply);
            }
        }
    );

    app.put(
        "/survey-completions/:routeVariantPublicId",
        { schema: putSurveyCompletionSchema, ...withLimit(FIELD_SESSION_RATE_LIMIT) },
        async (request, reply) => {
            const params = surveyCompletionVariantParamSchema.safeParse(request.params);
            const body = surveyCompletionPutBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return invalid(reply, "Invalid survey completion payload", {
                    params: params.success ? undefined : params.error.flatten(),
                    body: body.success ? undefined : body.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await surveyCompletions.put(
                        request.user.sub,
                        params.data.routeVariantPublicId,
                        body.data
                    )
                );
            } catch (error) {
                return handleSurveyCompletionsError(error, reply);
            }
        }
    );

    app.get(
        "/survey-assignments",
        {
            schema: getSurveyAssignmentsSchema,
            ...withAssignmentReadLimit(FIELD_ASSIGNMENT_RATE_LIMIT),
        },
        async (request, reply) => {
            const parsed = surveyAssignmentListQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return invalid(reply, "Invalid survey assignment query", parsed.error.flatten());
            }
            try {
                return reply.send(
                    await surveyAssignments.list(
                        request.user.sub,
                        request.user.roles ?? [],
                        parsed.data
                    )
                );
            } catch (error) {
                return handleSurveyAssignmentsError(error, reply);
            }
        }
    );

    app.post(
        "/survey-assignments",
        {
            schema: postSurveyAssignmentSchema,
            ...withAssignmentManageLimit(FIELD_ASSIGNMENT_RATE_LIMIT),
        },
        async (request, reply) => {
            const parsed = surveyAssignmentCreateBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return invalid(reply, "Invalid survey assignment payload", parsed.error.flatten());
            }
            try {
                return reply
                    .code(201)
                    .send(await surveyAssignments.create(request.user.sub, parsed.data));
            } catch (error) {
                return handleSurveyAssignmentsError(error, reply);
            }
        }
    );

    app.patch(
        "/survey-assignments/:publicId",
        {
            schema: patchSurveyAssignmentSchema,
            ...withAssignmentManageLimit(FIELD_ASSIGNMENT_RATE_LIMIT),
        },
        async (request, reply) => {
            const params = surveyAssignmentPublicIdParamSchema.safeParse(request.params);
            const body = surveyAssignmentUpdateBodySchema.safeParse(request.body);
            if (!params.success || !body.success) {
                return invalid(reply, "Invalid survey assignment update", {
                    params: params.success ? undefined : params.error.flatten(),
                    body: body.success ? undefined : body.error.flatten(),
                });
            }
            try {
                return reply.send(
                    await surveyAssignments.update(params.data.publicId, body.data)
                );
            } catch (error) {
                return handleSurveyAssignmentsError(error, reply);
            }
        }
    );

    app.post(
        "/survey-assignments/:publicId/cancel",
        {
            schema: postSurveyAssignmentCancelSchema,
            ...withAssignmentManageLimit(FIELD_ASSIGNMENT_RATE_LIMIT),
        },
        async (request, reply) => {
            const params = surveyAssignmentPublicIdParamSchema.safeParse(request.params);
            if (!params.success) {
                return invalid(reply, "Invalid survey assignment id", params.error.flatten());
            }
            try {
                return reply.send(await surveyAssignments.cancel(params.data.publicId));
            } catch (error) {
                return handleSurveyAssignmentsError(error, reply);
            }
        }
    );

    app.get(
        "/survey-activity",
        {
            schema: getSurveyActivitySchema,
            ...withAssignmentManageLimit(FIELD_ACTIVITY_RATE_LIMIT),
        },
        async (request, reply) => {
            const parsed = surveyActivityListQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return invalid(reply, "Invalid survey activity query", parsed.error.flatten());
            }
            try {
                return reply.send(await surveyActivity.list(parsed.data));
            } catch (error) {
                return handleSurveyActivityError(error, reply);
            }
        }
    );

    app.get(
        "/survey-route-coverage",
        {
            schema: getSurveyRouteCoverageSchema,
            ...withAssignmentManageLimit(FIELD_COVERAGE_RATE_LIMIT),
        },
        async (request, reply) => {
            const parsed = surveyRouteCoverageQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return invalid(reply, "Invalid survey route coverage query", parsed.error.flatten());
            }
            try {
                return reply.send(await surveyRouteCoverage.list(parsed.data));
            } catch (error) {
                return handleSurveyRouteCoverageError(error, reply);
            }
        }
    );

    app.get(
        "/survey-work-history",
        {
            schema: getSurveyWorkHistorySchema,
            ...withAssignmentManageLimit(FIELD_WORK_HISTORY_RATE_LIMIT),
        },
        async (request, reply) => {
            const parsed = surveyWorkHistoryQuerySchema.safeParse(request.query);
            if (!parsed.success) {
                return invalid(reply, "Invalid survey work history query", parsed.error.flatten());
            }
            try {
                return reply.send(await surveyWorkHistory.list(parsed.data));
            } catch (error) {
                return handleSurveyWorkHistoryError(error, reply);
            }
        }
    );

    app.get(
        "/survey-sessions/:publicId/timeline",
        {
            schema: getSurveySessionTimelineSchema,
            ...withAssignmentManageLimit(FIELD_WORK_HISTORY_RATE_LIMIT),
        },
        async (request, reply) => {
            const parsed = surveySessionTimelineParamSchema.safeParse(request.params);
            if (!parsed.success) {
                return invalid(reply, "Invalid survey session id", parsed.error.flatten());
            }
            try {
                return reply.send(await surveyWorkHistory.timeline(parsed.data.publicId));
            } catch (error) {
                return handleSurveyWorkHistoryError(error, reply);
            }
        }
    );

    app.post(
        "/reports",
        {
            schema: postFieldReportSchema,
            ...withLimit(FIELD_REPORT_CREATE_RATE_LIMIT),
        },
        async (request, reply) => {
            const parsed = fieldReportCreateBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return invalid(reply, "Invalid field report payload", parsed.error.flatten());
            }
            try {
                const result = await fieldReports.create(request.user.sub, parsed.data);
                return reply.code(result.created ? 201 : 200).send(result.report);
            } catch (error) {
                return handleFieldReportsError(error, reply);
            }
        }
    );

    app.get(
        "/reports/:publicId",
        { schema: getFieldReportSchema, ...withLimit(FIELD_REPORT_READ_RATE_LIMIT) },
        async (request, reply) => {
        const params = fieldReportPublicIdParamSchema.safeParse(request.params);
        if (!params.success) {
            return invalid(reply, "Invalid report id", params.error.flatten());
        }
        try {
            return reply.send(await fieldReports.get(request.user.sub, params.data.publicId));
        } catch (error) {
            return handleFieldReportsError(error, reply);
        }
    });

    app.patch(
        "/reports/:publicId",
        { schema: patchFieldReportSchema, ...withLimit(FIELD_REPORT_MUTATE_RATE_LIMIT) },
        async (request, reply) => {
        const params = fieldReportPublicIdParamSchema.safeParse(request.params);
        const body = fieldReportPatchBodySchema.safeParse(request.body);
        if (!params.success) {
            return invalid(reply, "Invalid field report patch", params.error.flatten());
        }
        if (!body.success) {
            return invalid(reply, "Invalid field report patch", body.error.flatten());
        }
        try {
            return reply.send(await fieldReports.patch(request.user.sub, params.data.publicId, body.data));
        } catch (error) {
            return handleFieldReportsError(error, reply);
        }
    });

    app.post(
        "/reports/:publicId/followups",
        { schema: postFieldReportFollowupSchema, ...withLimit(FIELD_REPORT_MUTATE_RATE_LIMIT) },
        async (request, reply) => {
            const params = fieldReportPublicIdParamSchema.safeParse(request.params);
            const body = fieldReportFollowupBodySchema.safeParse(request.body);
            if (!params.success) {
                return invalid(reply, "Invalid field follow-up", params.error.flatten());
            }
            if (!body.success) {
                return invalid(reply, "Invalid field follow-up", body.error.flatten());
            }
            try {
                const report = await fieldReports.addFollowup(
                    request.user.sub,
                    params.data.publicId,
                    body.data.message
                );
                return reply.code(201).send(report);
            } catch (error) {
                return handleFieldReportsError(error, reply);
            }
        }
    );

    app.post(
        "/reports/:publicId/media",
        { schema: postFieldReportMediaSchema, ...withLimit(FIELD_MEDIA_ATTACH_RATE_LIMIT) },
        async (request, reply) => {
            const params = fieldReportPublicIdParamSchema.safeParse(request.params);
            const body = fieldReportMediaBodySchema.safeParse(request.body);
            if (!params.success) {
                return invalid(reply, "Invalid field report media payload", params.error.flatten());
            }
            if (!body.success) {
                return invalid(reply, "Invalid field report media payload", body.error.flatten());
            }
            try {
                const result = await createMediaService(app.prisma).attachToFieldReport(
                    request.user.sub,
                    params.data.publicId,
                    body.data
                );
                return reply.code(201).send(result);
            } catch (error) {
                return handleMediaError(error, reply);
            }
        }
    );
};

export default fieldRoutes;
