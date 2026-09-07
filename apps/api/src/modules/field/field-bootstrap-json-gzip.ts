import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { createGzip, type Gzip } from "node:zlib";

/**
 * Writes JSON through gzip without holding a complete JSON string or Buffer.
 * Callers must drop mapped records after each writeArrayItem.
 */
export class StreamingJsonGzipFile {
    private readonly gzip: Gzip;
    private readonly file: ReturnType<typeof createWriteStream>;
    private readonly sha256 = createHash("sha256");
    private uncompressedBytes = 0;
    private compressedBytes = 0;
    private firstInArray = true;
    private closed = false;

    constructor(filePath: string) {
        this.gzip = createGzip({ level: 6 });
        this.file = createWriteStream(filePath);
        this.gzip.on("data", (chunk: Buffer) => {
            this.compressedBytes += chunk.length;
            this.sha256.update(chunk);
        });
        this.gzip.pipe(this.file);
    }

    async writeRaw(text: string): Promise<void> {
        if (this.closed) {
            throw new Error("StreamingJsonGzipFile is closed");
        }
        this.uncompressedBytes += Buffer.byteLength(text, "utf8");
        if (!this.gzip.write(text, "utf8")) {
            await once(this.gzip, "drain");
        }
    }

    async writeJson(value: unknown): Promise<void> {
        await this.writeRaw(JSON.stringify(value));
    }

    async beginArray(): Promise<void> {
        this.firstInArray = true;
        await this.writeRaw("[");
    }

    async writeArrayItem(value: unknown): Promise<void> {
        if (!this.firstInArray) {
            await this.writeRaw(",");
        }
        this.firstInArray = false;
        await this.writeJson(value);
    }

    async endArray(): Promise<void> {
        await this.writeRaw("]");
    }

    async close(): Promise<{
        checksumSha256: string;
        uncompressedBytes: number;
        compressedBytes: number;
    }> {
        if (this.closed) {
            throw new Error("StreamingJsonGzipFile is closed");
        }
        this.closed = true;
        this.gzip.end();
        await finished(this.file);
        return {
            checksumSha256: this.sha256.digest("hex"),
            uncompressedBytes: this.uncompressedBytes,
            compressedBytes: this.compressedBytes,
        };
    }
}
