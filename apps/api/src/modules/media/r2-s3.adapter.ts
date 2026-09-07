import {
    CopyObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
    type S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";

import type { R2MediaEnvConfig } from "../../config/env.js";
import type {
    HeadObjectResult,
    ObjectStore,
    PresignedGetInput,
    PresignedPutInput,
    PutObjectInput,
    PutObjectStreamInput,
} from "./object-store.js";

function isNotFound(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }
    const err = error as S3ServiceException;
    return err.name === "NotFound" || err.$metadata?.httpStatusCode === 404;
}

/** Path-style URLs are required for loopback MinIO. Production R2 stays virtual-hosted. */
export function shouldForcePathStyle(endpoint: string): boolean {
    try {
        const host = new URL(endpoint).hostname;
        return host === "127.0.0.1" || host === "localhost" || host === "::1";
    } catch {
        return false;
    }
}

export function createR2S3Client(config: R2MediaEnvConfig): S3Client {
    return new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: shouldForcePathStyle(config.endpoint),
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
        // R2 rejects some AWS SDK default checksum headers on presigned PUT.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
    });
}

export class R2ObjectStore implements ObjectStore {
    constructor(
        private readonly client: S3Client,
        private readonly now: () => Date = () => new Date()
    ) {}

    async createPresignedPut(input: PresignedPutInput): Promise<{ url: string; expiresAt: Date }> {
        const url = await getSignedUrl(
            this.client,
            new PutObjectCommand({
                Bucket: input.bucket,
                Key: input.objectKey,
                ContentType: input.contentType,
                ContentLength: input.contentLength,
                Metadata: { sha256: input.checksumSha256 },
            }),
            { expiresIn: input.expiresInSeconds }
        );
        return {
            url,
            expiresAt: new Date(this.now().getTime() + input.expiresInSeconds * 1000),
        };
    }

    async createPresignedGet(input: PresignedGetInput): Promise<{ url: string; expiresAt: Date }> {
        const url = await getSignedUrl(
            this.client,
            new GetObjectCommand({
                Bucket: input.bucket,
                Key: input.objectKey,
            }),
            { expiresIn: input.expiresInSeconds }
        );
        return {
            url,
            expiresAt: new Date(this.now().getTime() + input.expiresInSeconds * 1000),
        };
    }

    async headObject(input: { bucket: string; objectKey: string }): Promise<HeadObjectResult> {
        try {
            const result = await this.client.send(
                new HeadObjectCommand({
                    Bucket: input.bucket,
                    Key: input.objectKey,
                })
            );
            return {
                exists: true,
                contentLength: typeof result.ContentLength === "number" ? result.ContentLength : null,
                contentType: result.ContentType ?? null,
                checksumSha256: result.Metadata?.sha256?.toLowerCase() ?? null,
            };
        } catch (error) {
            if (isNotFound(error)) {
                return { exists: false, contentLength: null, contentType: null, checksumSha256: null };
            }
            throw error;
        }
    }

    async getObject(input: { bucket: string; objectKey: string }): Promise<Buffer> {
        const result = await this.client.send(
            new GetObjectCommand({
                Bucket: input.bucket,
                Key: input.objectKey,
            })
        );
        const bytes = await result.Body?.transformToByteArray();
        if (!bytes) {
            throw new Error("Empty object body");
        }
        return Buffer.from(bytes);
    }

    async getObjectStream(input: { bucket: string; objectKey: string }): Promise<Readable> {
        const result = await this.client.send(
            new GetObjectCommand({
                Bucket: input.bucket,
                Key: input.objectKey,
            })
        );
        const body = result.Body;
        if (!body) {
            throw new Error("Empty object body");
        }
        if (body instanceof Readable) {
            return body;
        }
        return Readable.from(body as AsyncIterable<Uint8Array>);
    }

    async putObject(input: PutObjectInput): Promise<void> {
        await this.client.send(
            new PutObjectCommand({
                Bucket: input.bucket,
                Key: input.objectKey,
                Body: input.body,
                ContentType: input.contentType,
                CacheControl: input.cacheControl,
                ContentLength: input.body.length,
            })
        );
    }

    async putObjectStream(input: PutObjectStreamInput): Promise<void> {
        await this.client.send(
            new PutObjectCommand({
                Bucket: input.bucket,
                Key: input.objectKey,
                Body: input.body,
                ContentType: input.contentType,
                CacheControl: input.cacheControl,
                ContentLength: input.contentLength,
            })
        );
    }

    async copyObject(input: {
        bucket: string;
        sourceObjectKey: string;
        destinationObjectKey: string;
    }): Promise<void> {
        await this.client.send(
            new CopyObjectCommand({
                Bucket: input.bucket,
                Key: input.destinationObjectKey,
                CopySource: `${input.bucket}/${input.sourceObjectKey}`,
            })
        );
    }
}
