import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    roundFieldPathCoordinates,
    roundFieldStopCoordinates,
    sortRouteStops,
    toFieldRoute,
    toFieldRoutePath,
    toFieldRouteStop,
    toFieldStop,
    toFieldVariant,
    withOppositeVariantPublicIds,
} from "./field-dto.js";
import { StreamingJsonGzipFile } from "./field-bootstrap-json-gzip.js";
import {
    FIELD_BOOTSTRAP_SCHEMA_VERSION,
    type FieldBootstrapManifest,
} from "./field-bootstrap-manifest.js";
import {
    createPeakTracker,
    emitFieldBootstrapMetric,
    type FieldBootstrapMetricSink,
} from "./field-bootstrap-metrics.js";
import { snapshotRevisionFromParts } from "./field-revision.js";
import type { FieldRepository } from "./field.repo.js";
import type {
    FieldRoute,
    FieldRoutePath,
    FieldRouteStop,
    FieldStop,
    FieldVariant,
} from "./field.schema.js";

export type FieldBootstrapGenerateInput = {
    repo: FieldRepository;
    gzipPath: string;
    simplifyGeometry?: boolean;
    metrics?: FieldBootstrapMetricSink;
};

export type MappedBootstrapSections = {
    snapshotRevision: string;
    routes: FieldRoute[];
    variants: FieldVariant[];
    stops: FieldStop[];
    routeStops: FieldRouteStop[];
    routePaths: FieldRoutePath[];
};

export async function generateFieldBootstrapGzip(
    input: FieldBootstrapGenerateInput
): Promise<FieldBootstrapManifest> {
    const startedAt = Date.now();
    const peak = createPeakTracker(startedAt);
    const simplify = input.simplifyGeometry !== false;
    emitFieldBootstrapMetric(input.metrics, { phase: "generate_start", ...peak.sample("generate_start") });

    const parts = await input.repo.loadRevisionParts();
    const snapshotRevision = snapshotRevisionFromParts(parts);
    emitFieldBootstrapMetric(input.metrics, {
        phase: "after_revision_query",
        routeCount: parts.routeCount,
        variantCount: parts.variantCount,
        stopCount: parts.stopCount,
        routeStopCount: parts.routeStopCount,
        pathCount: parts.pathCount,
        ...peak.sample("after_revision_query"),
    });

    const writer = new StreamingJsonGzipFile(input.gzipPath);
    const generatedAt = new Date().toISOString();
    await writer.writeRaw(`{"snapshotRevision":${JSON.stringify(snapshotRevision)},"unchanged":false`);

    const routes = (await input.repo.loadRoutes()).map(toFieldRoute);
    emitFieldBootstrapMetric(input.metrics, {
        phase: "after_routes_query",
        rowCount: routes.length,
        ...peak.sample("after_routes_query"),
    });
    await writer.writeRaw(',"routes":');
    await writeArray(writer, routes);
    const routeCount = routes.length;
    routes.length = 0;

    const variants = withOppositeVariantPublicIds(
        (await input.repo.loadVariants())
            .map(toFieldVariant)
            .filter((row): row is NonNullable<typeof row> => row !== null)
    );
    emitFieldBootstrapMetric(input.metrics, {
        phase: "after_variants_query",
        rowCount: variants.length,
        ...peak.sample("after_variants_query"),
    });
    await writer.writeRaw(',"variants":');
    await writeArray(writer, variants);
    const variantCount = variants.length;
    variants.length = 0;

    const stops = (await input.repo.loadStops())
        .map(toFieldStop)
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .map(roundFieldStopCoordinates);
    emitFieldBootstrapMetric(input.metrics, {
        phase: "after_stops_query",
        rowCount: stops.length,
        ...peak.sample("after_stops_query"),
    });
    await writer.writeRaw(',"stops":');
    await writeArray(writer, stops);
    const stopCount = stops.length;
    stops.length = 0;

    const routeStops = sortRouteStops(
        (await input.repo.loadRouteStops())
            .map(toFieldRouteStop)
            .filter((row): row is NonNullable<typeof row> => row !== null)
    );
    emitFieldBootstrapMetric(input.metrics, {
        phase: "after_route_stops_query",
        rowCount: routeStops.length,
        ...peak.sample("after_route_stops_query"),
    });
    await writer.writeRaw(',"routeStops":');
    await writeArray(writer, routeStops);
    const routeStopCount = routeStops.length;
    routeStops.length = 0;

    await writer.writeRaw(',"routePaths":');
    await writer.beginArray();
    let pathCount = 0;
    const pathRows = await input.repo.loadRoutePaths({ simplify });
    emitFieldBootstrapMetric(input.metrics, {
        phase: "after_paths_query",
        rowCount: pathRows.length,
        ...peak.sample("after_paths_query"),
    });
    for (const row of pathRows) {
        const mapped = toFieldRoutePath(row);
        if (!mapped) {
            continue;
        }
        await writer.writeArrayItem(roundFieldPathCoordinates(mapped));
        pathCount += 1;
    }
    pathRows.length = 0;
    await writer.endArray();
    await writer.writeRaw("}");
    emitFieldBootstrapMetric(input.metrics, { phase: "after_mapping", ...peak.sample("after_mapping") });

    const written = await writer.close();
    emitFieldBootstrapMetric(input.metrics, {
        phase: "after_gzip_close",
        uncompressedBytes: written.uncompressedBytes,
        compressedBytes: written.compressedBytes,
        ...peak.sample("after_gzip_close"),
        peakRss: peak.summary().peakRss,
        peakLabel: peak.summary().peakLabel,
    });

    return {
        schemaVersion: FIELD_BOOTSTRAP_SCHEMA_VERSION,
        snapshotRevision,
        generatedAt,
        checksumSha256: written.checksumSha256,
        uncompressedBytes: written.uncompressedBytes,
        compressedBytes: written.compressedBytes,
        counts: {
            routes: routeCount,
            variants: variantCount,
            stops: stopCount,
            routeStops: routeStopCount,
            routePaths: pathCount,
        },
    };
}

export async function writeMappedBootstrapGzip(
    sections: MappedBootstrapSections,
    gzipPath: string
): Promise<FieldBootstrapManifest> {
    const writer = new StreamingJsonGzipFile(gzipPath);
    const generatedAt = new Date().toISOString();
    await writer.writeRaw(
        `{"snapshotRevision":${JSON.stringify(sections.snapshotRevision)},"unchanged":false`
    );
    await writer.writeRaw(',"routes":');
    await writeArray(writer, sections.routes);
    await writer.writeRaw(',"variants":');
    await writeArray(writer, sections.variants);
    await writer.writeRaw(',"stops":');
    await writeArray(writer, sections.stops);
    await writer.writeRaw(',"routeStops":');
    await writeArray(writer, sections.routeStops);
    await writer.writeRaw(',"routePaths":');
    await writeArray(writer, sections.routePaths);
    await writer.writeRaw("}");
    const written = await writer.close();
    return {
        schemaVersion: FIELD_BOOTSTRAP_SCHEMA_VERSION,
        snapshotRevision: sections.snapshotRevision,
        generatedAt,
        checksumSha256: written.checksumSha256,
        uncompressedBytes: written.uncompressedBytes,
        compressedBytes: written.compressedBytes,
        counts: {
            routes: sections.routes.length,
            variants: sections.variants.length,
            stops: sections.stops.length,
            routeStops: sections.routeStops.length,
            routePaths: sections.routePaths.length,
        },
    };
}

async function writeArray(writer: StreamingJsonGzipFile, items: unknown[]): Promise<void> {
    await writer.beginArray();
    for (const item of items) {
        await writer.writeArrayItem(item);
    }
    await writer.endArray();
}

export async function withTempBootstrapDir<T>(run: (directory: string) => Promise<T>): Promise<T> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "field-bootstrap-"));
    try {
        return await run(directory);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
