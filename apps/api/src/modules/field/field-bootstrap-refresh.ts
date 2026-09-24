import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { FieldBootstrapManifest } from "./field-bootstrap-manifest.js";
import type { FieldBootstrapArtifactStore } from "./field-bootstrap-store.js";

export type FieldBootstrapRefreshInput = {
    store: FieldBootstrapArtifactStore;
    loadLiveRevision: () => Promise<string>;
    writeSnapshot: (gzipPath: string) => Promise<FieldBootstrapManifest>;
};

/**
 * Rebuilds the published field snapshot when database transport data changed.
 * Calls are serialized so two online phones do not build the same snapshot twice.
 */
export class FieldBootstrapRefresher {
    private tail: Promise<void> = Promise.resolve();

    refresh(input: FieldBootstrapRefreshInput): Promise<"fresh" | "rebuilt"> {
        const job = this.tail.then(() => this.refreshOnce(input));
        this.tail = job.then(
            () => undefined,
            () => undefined
        );
        return job;
    }

    private async refreshOnce(input: FieldBootstrapRefreshInput): Promise<"fresh" | "rebuilt"> {
        const liveRevision = await input.loadLiveRevision();
        const current = await input.store.readCurrent();
        if (current?.manifest.snapshotRevision === liveRevision) {
            return "fresh";
        }

        const directory = await mkdtemp(path.join(os.tmpdir(), "field-bootstrap-refresh-"));
        try {
            const gzipPath = path.join(directory, "snapshot.json.gz");
            const manifest = await input.writeSnapshot(gzipPath);
            await input.store.publish({ gzipPath, manifest });
            return "rebuilt";
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
}
