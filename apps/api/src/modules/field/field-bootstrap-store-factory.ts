import { getOptionalR2MediaEnv } from "../../config/env.js";
import { R2ObjectStore, createR2S3Client } from "../media/r2-s3.adapter.js";
import {
    EmptyFieldBootstrapStore,
    FilesystemFieldBootstrapStore,
    ObjectStoreFieldBootstrapStore,
    type FieldBootstrapArtifactStore,
} from "./field-bootstrap-store.js";

/**
 * Request path never builds a snapshot. Local dir wins for tests; else private R2.
 */
export function createFieldBootstrapArtifactStore(): FieldBootstrapArtifactStore {
    const directory = process.env.FIELD_BOOTSTRAP_SNAPSHOT_DIR?.trim();
    if (directory) {
        return new FilesystemFieldBootstrapStore(directory);
    }
    try {
        const r2 = getOptionalR2MediaEnv();
        if (r2) {
            return new ObjectStoreFieldBootstrapStore(
                new R2ObjectStore(createR2S3Client(r2)),
                r2.privateBucket
            );
        }
    } catch {
        return new EmptyFieldBootstrapStore();
    }
    return new EmptyFieldBootstrapStore();
}
