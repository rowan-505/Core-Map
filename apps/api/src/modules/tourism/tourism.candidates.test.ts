import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    resolveTourismCoverageStatus,
    suggestTourismTypeForCandidate,
} from "./tourism.candidates.js";

describe("suggestTourismTypeForCandidate", () => {
    it("maps religious categories", () => {
        assert.equal(
            suggestTourismTypeForCandidate({
                categoryCode: "pagoda",
                osmTourism: null,
                osmHistoric: null,
                osmLeisure: null,
                osmNatural: null,
            }),
            "religious"
        );
        assert.equal(
            suggestTourismTypeForCandidate({
                categoryCode: "monastery",
                osmTourism: null,
                osmHistoric: null,
                osmLeisure: null,
                osmNatural: null,
            }),
            "religious"
        );
    });

    it("prefers OSM tourism tags over category", () => {
        assert.equal(
            suggestTourismTypeForCandidate({
                categoryCode: "entertainment",
                osmTourism: "museum",
                osmHistoric: null,
                osmLeisure: null,
                osmNatural: null,
            }),
            "museum"
        );
    });

    it("maps historic / natural signals", () => {
        assert.equal(
            suggestTourismTypeForCandidate({
                categoryCode: null,
                osmTourism: null,
                osmHistoric: "monument",
                osmLeisure: null,
                osmNatural: null,
            }),
            "historical"
        );
        assert.equal(
            suggestTourismTypeForCandidate({
                categoryCode: null,
                osmTourism: null,
                osmHistoric: null,
                osmLeisure: null,
                osmNatural: "waterfall",
            }),
            "waterfall"
        );
    });
});

describe("resolveTourismCoverageStatus", () => {
    it("labels coverage from approved vs open candidates", () => {
        assert.equal(
            resolveTourismCoverageStatus({ candidateCount: 10, approvedProfileCount: 0 }),
            "none"
        );
        assert.equal(
            resolveTourismCoverageStatus({ candidateCount: 0, approvedProfileCount: 5 }),
            "covered"
        );
        assert.equal(
            resolveTourismCoverageStatus({ candidateCount: 3, approvedProfileCount: 10 }),
            "strong"
        );
        assert.equal(
            resolveTourismCoverageStatus({ candidateCount: 20, approvedProfileCount: 2 }),
            "open"
        );
    });
});
