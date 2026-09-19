export type ReportStatusCode =
    | "submitted"
    | "in_review"
    | "needs_more_info"
    | "accepted"
    | "rejected"
    | "duplicate"
    | "resolved";

export type ReportSourceCode = "public" | "field_survey";

export type ReportTypeCode =
    | "wrong_info"
    | "wrong_location"
    | "missing_item"
    | "closed_or_removed"
    | "duplicate_item"
    | "transport_issue"
    | "community_info"
    | "other_map_issue"
    | "new_stop"
    | "tourism_incorrect_type"
    | "tourism_incorrect_description"
    | "tourism_incorrect_price"
    | "tourism_incorrect_review"
    | "tourism_other";

export type ReportTargetEntityType =
    | "place"
    | "street"
    | "building"
    | "bus_stop"
    | "bus_route"
    | "map_point"
    | "tourism_review"
    | "stop"
    | "route"
    | "variant"
    | "path";

export type RewardReasonCode =
    | "valid_report"
    | "useful_correction"
    | "useful_photo"
    | "admin_adjustment"
    | "reversal"
    | "spam_penalty"
    | "false_report_penalty";

export type CodeName = { code: string; name: string };

export type AdminReport = {
    public_id: string;
    is_anonymous: boolean;
    eligible_for_points: boolean;
    report_type: CodeName;
    status: CodeName;
    reason_code: string | null;
    target_entity_type: string | null;
    target_entity_id: string | null;
    target_public_id: string | null;
    title: string | null;
    description: string;
    latitude: number | null;
    longitude: number | null;
    admin_area_id: string | null;
    admin_area_name?: string | null;
    priority: string;
    confidence_score: number;
    admin_note: string | null;
    reviewed_at: string | null;
    reward_granted_at: string | null;
    created_at: string;
    updated_at: string;
    anonymous_id: string | null;
    author: { public_id: string; display_name: string | null; email: string } | null;
    source_code: ReportSourceCode;
    observed_at: string | null;
    location_accuracy_m: number | null;
    field: FieldReportContext | null;
    canonical_target: { latitude: number; longitude: number } | null;
    distance_m: number | null;
    media_count: number;
    review: ReportReview | null;
};

export type ReportReviewActionCode =
    | "MOVE_STOP"
    | "REMOVE_FROM_ROUTE"
    | "CREATE_AND_INSERT_STOP"
    | "UPDATE_STOP_DETAILS"
    | "OPEN_ROUTE_EDITOR"
    | "RESOLVE"
    | "REJECT";

export type ReportReviewKind =
    | "STOP_MOVED"
    | "STOP_MISSING"
    | "NEW_STOP"
    | "WRONG_DATA"
    | "ROUTE_ISSUE"
    | "OTHER";

export type ReportReviewStopRef = {
    public_id: string;
    name: string | null;
    sequence: number | null;
};

export type ReportReviewMapStopRole = "previous" | "target" | "next" | "surrounding";

export type ReportReviewMapStop = {
    public_id: string;
    name: string | null;
    sequence: number | null;
    latitude: number;
    longitude: number;
    role: ReportReviewMapStopRole;
};

export type ReportReviewMapContext = {
    stops: ReportReviewMapStop[];
};

export type ReportReviewAllowedAction = {
    action: ReportReviewActionCode;
    enabled: boolean;
    disabledReason: string | null;
};

export type ReportReview = {
    report_id: string;
    report_type: string;
    status: string;
    timestamp: string;
    kind: ReportReviewKind | null;
    route_code: string | null;
    variant_code: string | null;
    target_stop: ReportReviewStopRef | null;
    proposed_change: string | null;
    current_canonical_revision: string | null;
    field_snapshot_revision: string | null;
    coordinates: {
        current: { latitude: number; longitude: number } | null;
        proposed: { latitude: number; longitude: number } | null;
        observed: { latitude: number; longitude: number } | null;
    };
    previous_stop: ReportReviewStopRef | null;
    next_stop: ReportReviewStopRef | null;
    map_context: ReportReviewMapContext | null;
    affected_route_count: number;
    allowedActions: ReportReviewAllowedAction[];
};

export type ReportApplyRequest = {
    action: ReportReviewActionCode;
    expectedCanonicalRevision: string;
};

export type ReportApplyResult = {
    report: AdminReport;
    applied: boolean;
    idempotent: boolean;
    action: ReportReviewActionCode;
    client_action: "OPEN_ROUTE_EDITOR" | null;
    route_public_id: string | null;
    comparison: {
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
        affected_variant_count: number | null;
        affected_route_count: number | null;
    };
    message: string | null;
};

export type ReportMediaEvidence = {
    publicId: string;
    mimeType: string;
    byteSize: number;
    width: number | null;
    height: number | null;
    note: string | null;
    sortOrder: number;
    published: boolean;
};

export type MediaAccess = {
    publicId: string;
    mimeType: string;
    byteSize: number;
    method: "GET";
    url: string;
    expiresAt: string;
};

export type FieldReportContext = {
    route_code: string | null;
    route_public_id: string | null;
    variant_code: string | null;
    variant_public_id: string | null;
    origin_name: string | null;
    destination_name: string | null;
    stop_public_id: string | null;
    stop_name: string | null;
    stop_sequence: number | null;
    previous_stop_public_id: string | null;
    previous_stop_sequence: number | null;
    next_stop_public_id: string | null;
    proposed_stop_name: string | null;
    location_source: string | null;
    snapshot_revision: string | null;
    snapshot_stale: boolean;
    current_snapshot_revision: string | null;
    survey_session_public_id: string | null;
    survey_session_status: string | null;
    canonical_snapshot: unknown | null;
    observed_location: { latitude: number; longitude: number; accuracy_m: number | null } | null;
    proposed_location: { latitude: number; longitude: number } | null;
};

export type ReportStatusEvent = {
    old_status_code: string | null;
    new_status_code: string;
    actor_display_name: string | null;
    note: string | null;
    created_at: string;
};

export type ReportFollowup = {
    actor_type: string;
    actor_display_name: string | null;
    message: string;
    created_at: string;
};

export type AdminReportDetail = AdminReport & {
    status_events: ReportStatusEvent[];
    followups: ReportFollowup[];
    media: ReportMediaEvidence[];
};

export type AdminReportList = {
    items: AdminReport[];
    total: number;
    page: number;
    pageSize: number;
};

export type PointSummary = {
    total_points: number;
    lifetime_points_earned: number;
    lifetime_points_removed: number;
    updated_at: string;
};

export type RewardResult = {
    report: AdminReport;
    summary: PointSummary;
};

export type ReportAnalyticsSummary = {
    total: number;
    submitted: number;
    in_review: number;
    needs_more_info: number;
    accepted: number;
    rejected: number;
    duplicate: number;
    resolved: number;
    anonymous: number;
    logged_in: number;
    this_week: number;
    this_month: number;
};

export type ReportCodeCount = { code: string; name: string; count: number };
export type ReportRegionCount = {
    region_id: string | null;
    region_name: string | null;
    count: number;
};
export type ReportAnonymousCount = { anonymous: number; logged_in: number };

export type ReportsListFilters = {
    status?: ReportStatusCode;
    type?: ReportTypeCode;
    adminAreaId?: number;
    targetEntityType?: ReportTargetEntityType;
    source?: ReportSourceCode;
    routeCode?: string;
    variantCode?: "D0" | "D1";
    anonymous?: boolean;
    createdFrom?: string;
    createdTo?: string;
    page?: number;
    pageSize?: number;
};
