import { getOptionalR2MediaEnv } from "../../config/env.js";
import { R2ObjectStore, createR2S3Client } from "../media/r2-s3.adapter.js";
import {
    EmptyFieldBootstrapStore,
    FilesystemFieldBootstrapStore,
    ObjectStoreFieldBootstrapStore,
    type FieldBootstrapArtifactStore,
} from "./field-bootstrap-store.js";

export type FieldBootstrapStoreKind = "dir" | "r2" | "empty";

function logStore(kind: FieldBootstrapStoreKind, extra?: string): void {
    const suffix = extra ? ` ${extra}` : "";
    // eslint-disable-next-line no-console -- startup diagnostic; never logs credentials or bodies
    console.log(`[api] field bootstrap store=${kind}${suffix}`);
}

function optionalR2() {
    try {
        return getOptionalR2MediaEnv();
    } catch {
        return null;
    }
}

function r2Store() {
    const r2 = optionalR2();
    if (!r2) {
        return null;
    }
    return new ObjectStoreFieldBootstrapStore(
        new R2ObjectStore(createR2S3Client(r2)),
        r2.privateBucket
    );
}

/**
 * Serves a published snapshot file. GET /field/bootstrap rebuilds that file
 * from the database when its revision is older than the live transport data.
 * A local dir is used only when it already has a valid artifact (tests).
 * Otherwise private R2. An empty FIELD_BOOTSTRAP_SNAPSHOT_DIR must not hide R2.
 */
export async function createFieldBootstrapArtifactStore(): Promise<FieldBootstrapArtifactStore> {
    const directory = process.env.FIELD_BOOTSTRAP_SNAPSHOT_DIR?.trim();
    if (directory) {
        const fsStore = new FilesystemFieldBootstrapStore(directory);
        const hasArtifact = Boolean((await fsStore.readCurrent()) ?? (await fsStore.readPrevious()));
        if (hasArtifact) {
            logStore("dir");
            return fsStore;
        }
        logStore("dir", "empty_fallback_r2");
    }

    const fromR2 = r2Store();
    if (fromR2) {
        logStore("r2");
        return fromR2;
    }

    logStore("empty");
    return new EmptyFieldBootstrapStore();
}
