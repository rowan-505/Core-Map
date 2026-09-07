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
    patchSurveySessionAbandonSchema,
    patchSurveySessionCompleteSchema,
    postSurveySessionSchema,
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
import { serveFieldBootstrap } from "./field-bootstrap-serve.js";
import { createFieldBootstrapArtifactStore } from "./field-bootstrap-store-factory.js";
import { SurveySessionsRepository } from "./survey-sessions.repo.js";
import {
    surveySessionClientIdParamSchema,
    surveySessionCreateBodySchema,
    surveySessionEndBodySchema,
    surveySessionListQuerySchema,
    surveySessionPublicIdParamSchema,
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

function invalid(reply: FastifyReply, message: string, issues: unknown): FastifyReply {
    return reply.code(400).send({ code: "VALIDATION_ERROR", message, issues });
}

const fieldRoutes: FastifyPluginAsync = async (app) => {
    const bootstrapStore = createFieldBootstrapArtifactStore();
    const reportsRepo = new ReportsRepository(app.prisma);
    const surveySessions = new SurveySessionsService(new SurveySessionsRepository(app.prisma));
    const fieldReports = new FieldReportsService(
        new FieldReportsRepository(app.prisma),
        reportsRepo,
        surveySessions
    );
    const fieldAuth = { preHandler: [app.authenticate, app.requireFieldSurveyor] };
    const withLimit = (rateLimit: { max: number; timeWindow: string }) => ({
        ...fieldAuth,
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
