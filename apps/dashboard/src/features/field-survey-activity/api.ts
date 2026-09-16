import { apiFetch } from "@/src/lib/api";

import {
    listSurveyRouteCoveragePath,
    listSurveyWorkHistoryPath,
    surveySessionTimelinePath,
} from "./fieldSurveyActivityStatus";
import type {
    SurveyRouteCoverageFilters,
    SurveyRouteCoverageResponse,
    SurveySessionTimelineResponse,
    SurveyWorkHistoryFilters,
    SurveyWorkHistoryResponse,
} from "./types";

type Signal = Pick<RequestInit, "signal">;

export function listSurveyRouteCoverage(
    filters: SurveyRouteCoverageFilters = {},
    init?: Signal
) {
    const workStatus =
        filters.workStatus === "" || filters.workStatus === undefined
            ? undefined
            : filters.workStatus;
    return apiFetch<SurveyRouteCoverageResponse>(
        listSurveyRouteCoveragePath({
            surveyorPublicId: filters.surveyorPublicId || undefined,
            workStatus,
            routeSearch: filters.routeSearch || undefined,
        }),
        { method: "GET", ...init }
    );
}

export function listSurveyWorkHistory(
    filters: SurveyWorkHistoryFilters = {},
    init?: Signal
) {
    const sessionStatus =
        filters.sessionStatus === "" || filters.sessionStatus === undefined
            ? undefined
            : filters.sessionStatus;
    return apiFetch<SurveyWorkHistoryResponse>(
        listSurveyWorkHistoryPath({
            surveyorPublicId: filters.surveyorPublicId || undefined,
            routeSearch: filters.routeSearch || undefined,
            sessionStatus,
            from: filters.from || undefined,
            to: filters.to || undefined,
            page: filters.page,
            pageSize: filters.pageSize,
            includeShortSessions: filters.includeShortSessions === true,
        }),
        { method: "GET", ...init }
    );
}

export function getSurveySessionTimeline(publicId: string, init?: Signal) {
    return apiFetch<SurveySessionTimelineResponse>(surveySessionTimelinePath(publicId), {
        method: "GET",
        ...init,
    });
}
