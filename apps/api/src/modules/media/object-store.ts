import type { Readable } from "node:stream";

export type PresignedPutInput = {
    bucket: string;
    objectKey: string;
    contentType: string;
    contentLength: number;
    checksumSha256: string;
    expiresInSeconds: number;
};

export type PresignedGetInput = {
    bucket: string;
    objectKey: string;
    expiresInSeconds: number;
};

export type HeadObjectResult = {
    exists: boolean;
    contentLength: number | null;
    contentType: string | null;
    checksumSha256: string | null;
};

export type PutObjectInput = {
    bucket: string;
    objectKey: string;
    body: Buffer;
    contentType: string;
    cacheControl: string;
};

export type PutObjectStreamInput = {
    bucket: string;
    objectKey: string;
    body: Readable;
    contentType: string;
    cacheControl: string;
    contentLength: number;
};

/** Small object-store port. R2/S3 is the only production adapter. */
export type ObjectStore = {
    createPresignedPut(input: PresignedPutInput): Promise<{ url: string; expiresAt: Date }>;
    createPresignedGet(input: PresignedGetInput): Promise<{ url: string; expiresAt: Date }>;
    headObject(input: { bucket: string; objectKey: string }): Promise<HeadObjectResult>;
    getObject(input: { bucket: string; objectKey: string }): Promise<Buffer>;
    getObjectStream(input: { bucket: string; objectKey: string }): Promise<Readable>;
    putObject(input: PutObjectInput): Promise<void>;
    putObjectStream(input: PutObjectStreamInput): Promise<void>;
    copyObject(input: {
        bucket: string;
        sourceObjectKey: string;
        destinationObjectKey: string;
    }): Promise<void>;
};
