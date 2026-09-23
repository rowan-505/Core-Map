import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import {
    NormalizedReportComparisonCard,
    ReportObserverCard,
    ReportReviewGuidanceCard,
    ReportRouteContextCard,
} from "./ReportDetailPanels.js";
import { toLegacyReportDetailView } from "./reportDetailView.js";
import type { NormalizedAdminReportDetail } from "./types.js";

function detail(): NormalizedAdminReportDetail {
    return {
        report: {
            publicId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            sourceCode: "field_survey",
            reportTypeCode: "wrong_location",
            statusCode: "in_review",
            description: "Move",
            observedAt: "2026-09-04T01:00:00.000Z",
            reporterName: "Surveyor",
            reporterPublicId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            reporterEmail: "s@example.com",
            isAnonymous: false,
            anonymousId: null,
            eligibleForPoints: false,
            rewardGrantedAt: null,
            title: null,
            reasonCode: null,
            targetEntityType: "stop",
            targetEntityId: null,
            targetPublicId: null,
            reportedCoordinates: { latitude: 16.801, longitude: 96.151 },
            adminAreaId: null,
            adminAreaName: null,
            priority: "normal",
            confidenceScore: 50,
            createdAt: "2026-09-04T00:00:00.000Z",
            updatedAt: "2026-09-04T00:00:00.000Z",
        },
        resolvedTarget: {
            entityType: "stop",
            stopId: "1",
            stopPublicId: "33333333-3333-4333-8333-333333333333",
            routeId: "2",
            routePublicId: "11111111-1111-4111-8111-111111111111",
            routeVariantId: "3",
            routeVariantPublicId: "22222222-2222-4222-8222-222222222222",
            stopSequence: 3,
        },
        comparison: {
            snapshotRevision: "v1-old",
            currentRevision: "v1-live",
            isStale: true,
            original: {
                name: "Old",
                coordinates: { latitude: 16.79, longitude: 96.14 },
                sequence: 3,
            },
            current: {
                name: "Current",
                coordinates: { latitude: 16.8, longitude: 96.15 },
                sequence: 3,
            },
            proposed: {
                name: null,
                coordinates: { latitude: 16.9, longitude: 96.2 },
                sequence: null,
            },
            proposedLocationSource: "MAP_PICK",
        },
        observer: {
            coordinates: { latitude: 16.801, longitude: 96.151 },
            accuracyMetres: 5,
            distanceToCurrentStopMetres: 120,
            distanceToProposedPositionMetres: 15,
        },
        routeContext: {
            route: {
                id: "2",
                publicId: "11111111-1111-4111-8111-111111111111",
                code: "YBS-13",
                name: "YBS 13",
            },
            variant: {
                id: "3",
                publicId: "22222222-2222-4222-8222-222222222222",
                code: "D0",
                direction: "outbound",
                originName: "A",
                destinationName: "B",
            },
            previousStop: null,
            currentStop: {
                id: "1",
                publicId: "33333333-3333-4333-8333-333333333333",
                name: "Current",
                coordinates: { latitude: 16.8, longitude: 96.15 },
                sequence: 3,
            },
            nextStop: null,
            insertion: null,
        },
        affectedRoutes: [
            {
                routeId: "2",
                routePublicId: "11111111-1111-4111-8111-111111111111",
                routeCode: "YBS-13",
                routeName: "YBS 13",
                routeVariantId: "3",
                routeVariantPublicId: "22222222-2222-4222-8222-222222222222",
                variantCode: "D0",
                direction: "outbound",
                sequence: 3,
            },
        ],
        evidence: { media: [] },
        review: {
            allowedActions: ["VERIFY_STOP", "REJECT_NO_CHANGE"],
            suggestedAction: null,
            blockedReasons: ["Snapshot revision is stale"],
        },
        workflow: {
            adminNote: null,
            reviewedAt: null,
            statusEvents: [],
            followups: [],
        },
    };
}

test("normalized detail cards show comparison, server distances, routes, and guidance", () => {
    const value = detail();
    const markup = [
        renderToStaticMarkup(createElement(NormalizedReportComparisonCard, { comparison: value.comparison })),
        renderToStaticMarkup(createElement(ReportObserverCard, { observer: value.observer })),
        renderToStaticMarkup(createElement(ReportRouteContextCard, { detail: value })),
        renderToStaticMarkup(createElement(ReportReviewGuidanceCard, { review: value.review })),
    ].join("");

    assert.match(markup, /Original at survey time/);
    assert.match(markup, /120\.0 m/);
    assert.match(markup, /YBS-13 · D0 · outbound · #3/);
    assert.match(markup, /Snapshot revision is stale/);
    assert.doesNotMatch(markup, /<button/);
});

test("normalized view adapter preserves public workflow fields and empty collections", () => {
    const value = detail();
    value.report.sourceCode = "public";
    value.routeContext = null;
    value.affectedRoutes = [];
    value.review = { allowedActions: [], suggestedAction: null, blockedReasons: [] };
    const adapted = toLegacyReportDetailView(value);

    assert.equal(adapted.public_id, value.report.publicId);
    assert.equal(adapted.author?.email, "s@example.com");
    assert.deepEqual(adapted.media, []);
    assert.deepEqual(adapted.followups, []);
    assert.equal(adapted.field, null);
});
