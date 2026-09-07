import { z } from "zod";

export const FIELD_BOOTSTRAP_SCHEMA_VERSION = 1;

export const fieldBootstrapManifestSchema = z.object({
    schemaVersion: z.literal(FIELD_BOOTSTRAP_SCHEMA_VERSION),
    snapshotRevision: z.string().min(1).max(80),
    generatedAt: z.string().datetime(),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    uncompressedBytes: z.number().int().nonnegative(),
    compressedBytes: z.number().int().positive(),
    counts: z.object({
        routes: z.number().int().nonnegative(),
        variants: z.number().int().nonnegative(),
        stops: z.number().int().nonnegative(),
        routeStops: z.number().int().nonnegative(),
        routePaths: z.number().int().nonnegative(),
    }),
});

export type FieldBootstrapManifest = z.infer<typeof fieldBootstrapManifestSchema>;

export function parseFieldBootstrapManifest(value: unknown): FieldBootstrapManifest | null {
    const parsed = fieldBootstrapManifestSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

export function fieldBootstrapEtag(checksumSha256: string): string {
    return `"${checksumSha256}"`;
}

export function ifNoneMatchHits(header: string | string[] | undefined, etag: string): boolean {
    const raw = Array.isArray(header) ? header.join(",") : (header ?? "");
    if (!raw.trim()) {
        return false;
    }
    const needle = etag.replaceAll('"', "").toLowerCase();
    return raw
        .split(",")
        .map((part) => part.trim().replaceAll('"', "").replace(/^W\//i, "").toLowerCase())
        .some((part) => part === needle || part === "*");
}

export const FIELD_BOOTSTRAP_OBJECT_PREFIX = "field/bootstrap";
export const FIELD_BOOTSTRAP_CURRENT_GZIP_NAME = "current.json.gz";
export const FIELD_BOOTSTRAP_CURRENT_MANIFEST_NAME = "current.manifest.json";
export const FIELD_BOOTSTRAP_PREVIOUS_GZIP_NAME = "previous.json.gz";
export const FIELD_BOOTSTRAP_PREVIOUS_MANIFEST_NAME = "previous.manifest.json";
