import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import type { ObjectStore } from "../media/object-store.js";
import {
    FIELD_BOOTSTRAP_CURRENT_GZIP_NAME,
    FIELD_BOOTSTRAP_CURRENT_MANIFEST_NAME,
    FIELD_BOOTSTRAP_OBJECT_PREFIX,
    FIELD_BOOTSTRAP_PREVIOUS_GZIP_NAME,
    FIELD_BOOTSTRAP_PREVIOUS_MANIFEST_NAME,
    parseFieldBootstrapManifest,
    type FieldBootstrapManifest,
} from "./field-bootstrap-manifest.js";

export type FieldBootstrapArtifact = {
    slot: "current" | "previous";
    manifest: FieldBootstrapManifest;
    openGzip: () => Promise<Readable>;
};

export type FieldBootstrapArtifactStore = {
    readCurrent(): Promise<FieldBootstrapArtifact | null>;
    readPrevious(): Promise<FieldBootstrapArtifact | null>;
    publish(input: {
        gzipPath: string;
        manifest: FieldBootstrapManifest;
    }): Promise<void>;
};

export class EmptyFieldBootstrapStore implements FieldBootstrapArtifactStore {
    async readCurrent(): Promise<FieldBootstrapArtifact | null> {
        return null;
    }

    async readPrevious(): Promise<FieldBootstrapArtifact | null> {
        return null;
    }

    async publish(): Promise<void> {
        throw new Error("No field bootstrap snapshot store is configured.");
    }
}

export class FilesystemFieldBootstrapStore implements FieldBootstrapArtifactStore {
    constructor(private readonly directory: string) {}

    async readCurrent(): Promise<FieldBootstrapArtifact | null> {
        return this.readSlot("current");
    }

    async readPrevious(): Promise<FieldBootstrapArtifact | null> {
        return this.readSlot("previous");
    }

    async publish(input: { gzipPath: string; manifest: FieldBootstrapManifest }): Promise<void> {
        await mkdir(this.directory, { recursive: true });
        const stagingGzip = path.join(this.directory, "staging.json.gz");
        const stagingManifest = path.join(this.directory, "staging.manifest.json");
        await copyFileAtomic(input.gzipPath, stagingGzip);
        await writeFile(stagingManifest, JSON.stringify(input.manifest), "utf8");

        const currentGzip = this.gzipPath("current");
        const currentManifest = this.manifestPath("current");
        if (await exists(currentGzip) && (await exists(currentManifest))) {
            await copyFileAtomic(currentGzip, this.gzipPath("previous"));
            await copyFileAtomic(currentManifest, this.manifestPath("previous"));
        }

        await rename(stagingGzip, currentGzip);
        await rename(stagingManifest, currentManifest);
    }

    private gzipPath(slot: "current" | "previous"): string {
        return path.join(
            this.directory,
            slot === "current" ? FIELD_BOOTSTRAP_CURRENT_GZIP_NAME : FIELD_BOOTSTRAP_PREVIOUS_GZIP_NAME
        );
    }

    private manifestPath(slot: "current" | "previous"): string {
        return path.join(
            this.directory,
            slot === "current" ? FIELD_BOOTSTRAP_CURRENT_MANIFEST_NAME : FIELD_BOOTSTRAP_PREVIOUS_MANIFEST_NAME
        );
    }

    private async readSlot(slot: "current" | "previous"): Promise<FieldBootstrapArtifact | null> {
        const gzipPath = this.gzipPath(slot);
        const manifestPath = this.manifestPath(slot);
        if (!(await exists(gzipPath)) || !(await exists(manifestPath))) {
            return null;
        }
        const manifest = parseFieldBootstrapManifest(JSON.parse(await readFile(manifestPath, "utf8")));
        if (!manifest) {
            return null;
        }
        const fileStat = await stat(gzipPath);
        if (fileStat.size !== manifest.compressedBytes || fileStat.size === 0) {
            return null;
        }
        return {
            slot,
            manifest,
            openGzip: async () => createReadStream(gzipPath),
        };
    }
}

export class ObjectStoreFieldBootstrapStore implements FieldBootstrapArtifactStore {
    constructor(
        private readonly objectStore: ObjectStore,
        private readonly bucket: string,
        private readonly prefix = FIELD_BOOTSTRAP_OBJECT_PREFIX
    ) {}

    async readCurrent(): Promise<FieldBootstrapArtifact | null> {
        return this.readSlot("current");
    }

    async readPrevious(): Promise<FieldBootstrapArtifact | null> {
        return this.readSlot("previous");
    }

    async publish(input: { gzipPath: string; manifest: FieldBootstrapManifest }): Promise<void> {
        const currentGzipKey = this.key(FIELD_BOOTSTRAP_CURRENT_GZIP_NAME);
        const currentManifestKey = this.key(FIELD_BOOTSTRAP_CURRENT_MANIFEST_NAME);
        const previousGzipKey = this.key(FIELD_BOOTSTRAP_PREVIOUS_GZIP_NAME);
        const previousManifestKey = this.key(FIELD_BOOTSTRAP_PREVIOUS_MANIFEST_NAME);

        const current = await this.objectStore.headObject({ bucket: this.bucket, objectKey: currentGzipKey });
        if (current.exists) {
            await this.objectStore.copyObject({
                bucket: this.bucket,
                sourceObjectKey: currentGzipKey,
                destinationObjectKey: previousGzipKey,
            });
            await this.objectStore.copyObject({
                bucket: this.bucket,
                sourceObjectKey: currentManifestKey,
                destinationObjectKey: previousManifestKey,
            });
        }

        const gzipStat = await stat(input.gzipPath);
        await this.objectStore.putObjectStream({
            bucket: this.bucket,
            objectKey: currentGzipKey,
            body: createReadStream(input.gzipPath),
            contentType: "application/gzip",
            cacheControl: "private, no-store",
            contentLength: gzipStat.size,
        });
        const manifestBytes = Buffer.from(JSON.stringify(input.manifest), "utf8");
        await this.objectStore.putObject({
            bucket: this.bucket,
            objectKey: currentManifestKey,
            body: manifestBytes,
            contentType: "application/json",
            cacheControl: "private, no-store",
        });
    }

    private key(name: string): string {
        return `${this.prefix}/${name}`;
    }

    private async readSlot(slot: "current" | "previous"): Promise<FieldBootstrapArtifact | null> {
        const gzipName = slot === "current" ? FIELD_BOOTSTRAP_CURRENT_GZIP_NAME : FIELD_BOOTSTRAP_PREVIOUS_GZIP_NAME;
        const manifestName =
            slot === "current" ? FIELD_BOOTSTRAP_CURRENT_MANIFEST_NAME : FIELD_BOOTSTRAP_PREVIOUS_MANIFEST_NAME;
        const gzipKey = this.key(gzipName);
        const manifestKey = this.key(manifestName);
        const head = await this.objectStore.headObject({ bucket: this.bucket, objectKey: gzipKey });
        if (!head.exists) {
            return null;
        }
        let manifestBytes: Buffer;
        try {
            manifestBytes = await this.objectStore.getObject({
                bucket: this.bucket,
                objectKey: manifestKey,
            });
        } catch {
            return null;
        }
        const manifest = parseFieldBootstrapManifest(JSON.parse(manifestBytes.toString("utf8")));
        if (!manifest) {
            return null;
        }
        if (
            head.contentLength != null &&
            head.contentLength > 0 &&
            head.contentLength !== manifest.compressedBytes
        ) {
            return null;
        }
        return {
            slot,
            manifest,
            openGzip: () => this.objectStore.getObjectStream({ bucket: this.bucket, objectKey: gzipKey }),
        };
    }
}

async function exists(filePath: string): Promise<boolean> {
    try {
        await stat(filePath);
        return true;
    } catch {
        return false;
    }
}

async function copyFileAtomic(from: string, to: string): Promise<void> {
    const tmp = `${to}.tmp`;
    await rm(tmp, { force: true });
    const { copyFile } = await import("node:fs/promises");
    await copyFile(from, tmp);
    await rename(tmp, to);
}
