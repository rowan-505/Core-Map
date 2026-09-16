import assert from "node:assert/strict";
import test from "node:test";

import { ReportDeleteNotRejectedError } from "./reports.repo.js";
import { ReportsError, ReportsService } from "./reports.service.js";

const REPORT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function service(overrides: {
    permanentDeleteRejected?: () => Promise<unknown>;
    deleteObject?: (input: { bucket: string; objectKey: string }) => Promise<void>;
    buckets?: { privateBucket: string; publicBucket: string } | null;
}) {
    const reportsRepo = {
        permanentDeleteRejected:
            overrides.permanentDeleteRejected ??
            (async () => ({
                publicId: REPORT_ID,
                reportTypeCode: "wrong_location",
                storageObjects: [{ objectKey: "private/a.jpg", storageScope: "private" }],
            })),
    };
    const objectStore = {
        deleteObject:
            overrides.deleteObject ??
            (async () => {
                /* ok */
            }),
    };
    return new ReportsService(
        reportsRepo as never,
        { listReadyPrivateForReport: async () => [] } as never,
        { loadRevisionParts: async () => ({}) } as never,
        { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) } as never,
        {} as never,
        objectStore,
        overrides.buckets === undefined
            ? { privateBucket: "priv", publicBucket: "pub" }
            : overrides.buckets
    );
}

test("adminPermanentDelete succeeds for rejected reports and deletes exact storage keys", async () => {
    const deletedKeys: string[] = [];
    const result = await service({
        deleteObject: async (input) => {
            deletedKeys.push(`${input.bucket}:${input.objectKey}`);
        },
    }).adminPermanentDelete(REPORT_ID, {
        actorUserId: 1n,
        ipAddress: null,
        userAgent: null,
    });

    assert.deepEqual(result, {
        deleted: true,
        public_id: REPORT_ID,
        media_cleanup_warning: null,
    });
    assert.deepEqual(deletedKeys, ["priv:private/a.jpg"]);
});

test("adminPermanentDelete returns 409 when status is no longer rejected", async () => {
    await assert.rejects(
        () =>
            service({
                permanentDeleteRejected: async () => {
                    throw new ReportDeleteNotRejectedError("resolved");
                },
            }).adminPermanentDelete(REPORT_ID, {
                actorUserId: 1n,
                ipAddress: null,
                userAgent: null,
            }),
        (error: unknown) =>
            error instanceof ReportsError &&
            error.statusCode === 409 &&
            /rejected/.test(error.message)
    );
});

test("adminPermanentDelete returns 404 when already deleted", async () => {
    await assert.rejects(
        () =>
            service({
                permanentDeleteRejected: async () => null,
            }).adminPermanentDelete(REPORT_ID, {
                actorUserId: 1n,
                ipAddress: null,
                userAgent: null,
            }),
        (error: unknown) => error instanceof ReportsError && error.statusCode === 404
    );
});

test("adminPermanentDelete keeps DB success when storage cleanup fails", async () => {
    const result = await service({
        deleteObject: async () => {
            throw new Error("R2 unavailable");
        },
    }).adminPermanentDelete(REPORT_ID, {
        actorUserId: 1n,
        ipAddress: null,
        userAgent: null,
    });

    assert.equal(result.deleted, true);
    assert.match(result.media_cleanup_warning ?? "", /could not be removed from storage/);
});

test("adminPermanentDelete warns when storage is not configured but assets existed", async () => {
    const result = await service({
        buckets: null,
    }).adminPermanentDelete(REPORT_ID, {
        actorUserId: 1n,
        ipAddress: null,
        userAgent: null,
    });

    assert.equal(result.deleted, true);
    assert.match(result.media_cleanup_warning ?? "", /not configured/);
});
