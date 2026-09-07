import type { FastifyReply, FastifyRequest } from "fastify";
import type { Readable } from "node:stream";

import { sendMaybeGzipJson } from "./field-gzip.js";
import {
    fieldBootstrapEtag,
    ifNoneMatchHits,
} from "./field-bootstrap-manifest.js";
import {
    createPeakTracker,
    emitFieldBootstrapMetric,
    fieldBootstrapMetricsEnabled,
    stderrMetricSink,
    type FieldBootstrapMetricSink,
} from "./field-bootstrap-metrics.js";
import type { FieldBootstrapArtifactStore } from "./field-bootstrap-store.js";

export async function serveFieldBootstrap(params: {
    request: FastifyRequest;
    reply: FastifyReply;
    store: FieldBootstrapArtifactStore;
    revision?: string;
    metrics?: FieldBootstrapMetricSink;
}): Promise<FastifyReply> {
    const startedAt = Date.now();
    const peak = createPeakTracker(startedAt);
    const metrics =
        params.metrics ?? (fieldBootstrapMetricsEnabled() ? stderrMetricSink : undefined);
    emitFieldBootstrapMetric(metrics, { phase: "request_start", ...peak.sample("request_start") });

    const current = await params.store.readCurrent();
    const artifact = current ?? (await params.store.readPrevious());
    if (!artifact) {
        emitFieldBootstrapMetric(metrics, { phase: "snapshot_missing", ...peak.sample("snapshot_missing") });
        return params.reply.code(503).send({
            code: "SNAPSHOT_UNAVAILABLE",
            message: "Field bootstrap snapshot is not published.",
        });
    }

    const etag = fieldBootstrapEtag(artifact.manifest.checksumSha256);
    params.reply.header("ETag", etag);
    params.reply.header("Cache-Control", "private, no-store");
    params.reply.header("Vary", "Accept-Encoding");

    if (ifNoneMatchHits(params.request.headers["if-none-match"], etag)) {
        emitFieldBootstrapMetric(metrics, {
            phase: "not_modified",
            compressedBytes: artifact.manifest.compressedBytes,
            ...peak.sample("not_modified"),
        });
        return params.reply.code(304).send();
    }

    if (params.revision && params.revision === artifact.manifest.snapshotRevision) {
        emitFieldBootstrapMetric(metrics, {
            phase: "unchanged",
            ...peak.sample("unchanged"),
        });
        return sendMaybeGzipJson(params.request, params.reply, 200, {
            snapshotRevision: artifact.manifest.snapshotRevision,
            unchanged: true,
        });
    }

    const gzipStream = await artifact.openGzip();
    bindBootstrapAbort(params.request, gzipStream);
    emitFieldBootstrapMetric(metrics, {
        phase: "before_stream",
        uncompressedBytes: artifact.manifest.uncompressedBytes,
        compressedBytes: artifact.manifest.compressedBytes,
        routeCount: artifact.manifest.counts.routes,
        variantCount: artifact.manifest.counts.variants,
        stopCount: artifact.manifest.counts.stops,
        routeStopCount: artifact.manifest.counts.routeStops,
        pathCount: artifact.manifest.counts.routePaths,
        ...peak.sample("before_stream"),
    });

    gzipStream.once("end", () => {
        emitFieldBootstrapMetric(metrics, {
            phase: "response_complete",
            ...peak.sample("response_complete"),
            peakRss: peak.summary().peakRss,
            peakLabel: peak.summary().peakLabel,
        });
    });

    params.reply.header("Content-Encoding", "gzip");
    params.reply.header("Content-Length", String(artifact.manifest.compressedBytes));
    params.reply.type("application/json; charset=utf-8");
    return params.reply.code(200).send(gzipStream);
}

export function bindBootstrapAbort(request: FastifyRequest, stream: Readable): void {
    const abort = () => {
        if (typeof stream.destroy === "function") {
            stream.destroy();
        }
    };
    request.raw.once("close", abort);
    request.raw.once("aborted", abort);
    stream.once("close", () => {
        request.raw.off("close", abort);
        request.raw.off("aborted", abort);
    });
}
