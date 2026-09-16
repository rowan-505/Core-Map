export type SurveyCoverageWorkStatus = "not_started" | "partial" | "finished";
export type SurveySessionStatus = "active" | "completed" | "abandoned" | "none";
export type SurveyPresenceStatus = "live" | "stale" | "offline";
export type SurveyCompletionStatus = "none" | "finished" | "not_finished";

export type SurveyorRef = {
    publicId: string;
    displayName: string;
    email: string;
};

export type SurveyRouteCoverageFilters = {
    surveyorPublicId?: string;
    workStatus?: SurveyCoverageWorkStatus | "";
    routeSearch?: string;
};

export type SurveyWorkHistoryFilters = {
    surveyorPublicId?: string;
    routeSearch?: string;
    sessionStatus?: "active" | "completed" | "abandoned" | "";
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
    includeShortSessions?: boolean;
};

export type SurveyRouteCoverageItem = {
    route: { publicId: string; code: string };
    variantCode: "D0" | "D1";
    routeVariantPublicId: string;
    workStatus: SurveyCoverageWorkStatus;
    remaining: boolean;
    sessionStatus: SurveySessionStatus;
    presenceStatus: SurveyPresenceStatus;
    completionStatus: SurveyCompletionStatus;
    sessionPublicId: string | null;
    startedAt: string | null;
    lastActivityAt: string | null;
    lastSurveyedAt: string | null;
    activeDurationSeconds: number;
    lastCheckedStopSequence: number | null;
    checkedStopCount: number;
    totalStopCount: number;
    checkedLabel: string;
    latestSessionReportCount: number;
    variantReportCount: number;
    pendingSyncCount: number;
    syncState: string | null;
};

export type SurveyRouteCoverageResponse = {
    generatedAt: string;
    heartbeatFreshWithinSeconds: number;
    surveyor: SurveyorRef;
    summary: {
        totalActiveVariants: number;
        notStarted: number;
        partial: number;
        finished: number;
        remaining: number;
        activeNow: number;
    };
    items: SurveyRouteCoverageItem[];
};

export type SurveyWorkHistoryItem = {
    sessionPublicId: string;
    clientSessionId: string;
    route: { publicId: string; code: string };
    variantCode: "D0" | "D1";
    routeVariantPublicId: string;
    sessionStatus: SurveySessionStatus;
    presenceStatus: SurveyPresenceStatus;
    currentCompletionStatus: SurveyCompletionStatus;
    startedAt: string;
    endedAt: string | null;
    lastActivityAt: string | null;
    activeDurationSeconds: number;
    lastCheckedStopSequence: number | null;
    checkedStopCount: number;
    totalStopCount: number;
    checkedLabel: string;
    reportCount: number;
    reportCountLabel: string;
    isShortEmptySession: boolean;
    pendingSyncCount: number;
    syncState: string | null;
    lastPosition: {
        lat: number;
        lng: number;
        accuracyM: number | null;
        at: string | null;
    } | null;
};

export type SurveyWorkHistoryResponse = {
    generatedAt: string;
    heartbeatFreshWithinSeconds: number;
    surveyor: SurveyorRef;
    range: { from: string; to: string };
    page: number;
    pageSize: number;
    total: number;
    shortEmptySessionCount: number;
    includeShortSessions: boolean;
    items: SurveyWorkHistoryItem[];
};

export type SurveySessionTimelineResponse = {
    generatedAt: string;
    heartbeatFreshWithinSeconds: number;
    session: {
        publicId: string;
        clientSessionId: string;
        surveyor: SurveyorRef;
        route: { publicId: string; code: string };
        variantCode: "D0" | "D1";
        routeVariantPublicId: string;
        sessionStatus: SurveySessionStatus;
        presenceStatus: SurveyPresenceStatus;
        currentCompletionStatus: SurveyCompletionStatus;
        startedAt: string;
        endedAt: string | null;
        lastActivityAt: string | null;
        activeDurationSeconds: number;
        checkedStopCount: number;
        totalStopCount: number;
        checkedLabel?: string;
        reportCount: number;
        reportCountLabel?: string;
        pendingSyncCount: number;
        syncState: string | null;
        lastPosition: {
            lat: number;
            lng: number;
            accuracyM: number | null;
            at: string | null;
        } | null;
    };
    events: Array<{
        eventType: string;
        occurredAt: string;
        clientEventId: string | null;
    }>;
};
