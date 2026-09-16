import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { FastifyServerOptions } from "fastify";

/** JSON and form bodies. Media bytes go to R2 via presigned PUT, not through Fastify. */
export const API_JSON_BODY_LIMIT_BYTES = 1 * 1024 * 1024;

export const REQUEST_ID_HEADER = "x-request-id";

export function resolveRequestId(headerValue: string | string[] | undefined): string {
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const trimmed = raw?.trim() ?? "";
    if (trimmed.length > 0 && trimmed.length <= 128 && /^[\w.:-]+$/.test(trimmed)) {
        return trimmed;
    }
    return randomUUID();
}

export function apiFastifyOptions(): FastifyServerOptions {
    const production = process.env.NODE_ENV === "production";
    return {
        bodyLimit: API_JSON_BODY_LIMIT_BYTES,
        requestIdHeader: REQUEST_ID_HEADER,
        genReqId: (req: IncomingMessage) => resolveRequestId(req.headers[REQUEST_ID_HEADER]),
        trustProxy: production,
        logger: {
            level: process.env.LOG_LEVEL ?? (production ? "info" : "info"),
            redact: {
                paths: ["req.headers.authorization", "req.headers.cookie"],
                censor: "[redacted]",
            },
        },
    };
}
