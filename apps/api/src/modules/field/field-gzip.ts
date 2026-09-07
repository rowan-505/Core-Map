import { gzipSync } from "node:zlib";
import type { FastifyReply, FastifyRequest } from "fastify";

export function clientAcceptsGzip(header: string | string[] | undefined): boolean {
    const value = Array.isArray(header) ? header.join(",") : (header ?? "");
    return /\bgzip\b/i.test(value);
}

export function gzipJson(value: unknown): Buffer {
    return gzipSync(Buffer.from(JSON.stringify(value), "utf8"));
}

export function sendMaybeGzipJson(
    request: FastifyRequest,
    reply: FastifyReply,
    statusCode: number,
    value: unknown
): FastifyReply {
    reply.header("Vary", "Accept-Encoding");
    reply.type("application/json; charset=utf-8");
    if (clientAcceptsGzip(request.headers["accept-encoding"])) {
        reply.header("Content-Encoding", "gzip");
        return reply.code(statusCode).send(gzipJson(value));
    }
    return reply.code(statusCode).send(value);
}
