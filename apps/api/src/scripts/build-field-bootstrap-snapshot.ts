/**
 * Build a field bootstrap gzip + sidecar outside request handling.
 *
 * Never run from API startup or GET /field/bootstrap.
 * Does not write canonical transport rows.
 *
 * Usage (from apps/api):
 *   npm run field:build-bootstrap-snapshot -- --out-dir /tmp/field-bootstrap
 *   npm run field:build-bootstrap-snapshot -- --out-dir /tmp/field-bootstrap --upload-r2 --allow-remote-database
 */

import { config } from "dotenv";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(apiRoot, "../..");
config({ path: resolve(repoRoot, ".env") });
config({ path: resolve(apiRoot, ".env"), override: true });

import { assertSnapshotGeneratorDatabaseUrl } from "../modules/field/field-bootstrap-db-guard.js";
import { generateFieldBootstrapGzip } from "../modules/field/field-bootstrap-generator.js";
import { stderrMetricSink } from "../modules/field/field-bootstrap-metrics.js";
import {
    FilesystemFieldBootstrapStore,
    ObjectStoreFieldBootstrapStore,
} from "../modules/field/field-bootstrap-store.js";
import { FieldRepository } from "../modules/field/field.repo.js";
import { getOptionalR2MediaEnv } from "../config/env.js";
import { R2ObjectStore, createR2S3Client } from "../modules/media/r2-s3.adapter.js";

function parseArgs(argv: string[]) {
    const outIndex = argv.indexOf("--out-dir");
    const outDir = outIndex >= 0 ? argv[outIndex + 1] : process.env.FIELD_BOOTSTRAP_SNAPSHOT_DIR;
    return {
        outDir,
        uploadR2: argv.includes("--upload-r2"),
        allowRemoteDatabase: argv.includes("--allow-remote-database"),
        fullGeometry: argv.includes("--full-geometry"),
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.outDir) {
        throw new Error("Pass --out-dir or set FIELD_BOOTSTRAP_SNAPSHOT_DIR.");
    }

    assertSnapshotGeneratorDatabaseUrl(process.env.DATABASE_URL, args.allowRemoteDatabase);

    const { prisma } = await import("../db/prisma.js");
    await mkdir(args.outDir, { recursive: true });
    const gzipPath = resolve(args.outDir, "staging-build.json.gz");
    const manifest = await generateFieldBootstrapGzip({
        repo: new FieldRepository(prisma),
        gzipPath,
        simplifyGeometry: !args.fullGeometry,
        metrics: stderrMetricSink,
    });

    const fsStore = new FilesystemFieldBootstrapStore(args.outDir);
    await fsStore.publish({ gzipPath, manifest });

    process.stderr.write(
        `${JSON.stringify({
            kind: "field_bootstrap_publish",
            snapshotRevision: manifest.snapshotRevision,
            uncompressedBytes: manifest.uncompressedBytes,
            compressedBytes: manifest.compressedBytes,
            counts: manifest.counts,
            uploadedR2: false,
        })}\n`
    );

    if (args.uploadR2) {
        const r2 = getOptionalR2MediaEnv();
        if (!r2) {
            throw new Error("R2 is not configured; cannot --upload-r2.");
        }
        const r2Store = new ObjectStoreFieldBootstrapStore(
            new R2ObjectStore(createR2S3Client(r2)),
            r2.privateBucket
        );
        await r2Store.publish({ gzipPath, manifest });
        process.stderr.write(
            `${JSON.stringify({
                kind: "field_bootstrap_publish",
                snapshotRevision: manifest.snapshotRevision,
                uploadedR2: true,
            })}\n`
        );
    }

    await prisma.$disconnect();
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    process.stderr.write(`${message}\n`);
    process.exit(1);
});
