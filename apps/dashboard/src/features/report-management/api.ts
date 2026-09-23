import { apiFetch } from "@/src/lib/api";
import { privateMediaAccessPath } from "./fieldEvidenceView";
import { getReportPath, listReportsPath, reportStatusChangeRequest } from "./reportAdminQueries";
import type { ReportPermanentDeleteResult } from "./reportPermanentDelete";
import type {
    AdminReport,
    AdminReportDetail,
    AdminReportList,
    MediaAccess,
    NormalizedAdminReportDetail,
    ReportAnalyticsSummary,
    ReportAnonymousCount,
    ReportApplyRequest,
    ReportApplyResult,
    ReportCodeCount,
    ReportRegionCount,
    ReportsListFilters,
    ReportStatusCode,
    RewardReasonCode,
    RewardResult,
} from "./types";

type Signal = Pick<RequestInit, "signal">;

export function listReports(filters: ReportsListFilters = {}, init?: Signal) {
    return apiFetch<AdminReportList>(listReportsPath(filters), {
        method: "GET",
        ...init,
    });
}

export function getReport(id: string, init?: Signal) {
    return apiFetch<NormalizedAdminReportDetail>(getReportPath(id), {
        method: "GET",
        ...init,
    });
}

export function permanentDeleteRejectedReport(id: string, init?: Signal) {
    return apiFetch<ReportPermanentDeleteResult>(`/admin/reports/${encodeURIComponent(id)}`, {
        method: "DELETE",
        ...init,
    });
}

export function getPrivateMediaAccess(assetPublicId: string, init?: Signal) {
    return apiFetch<MediaAccess>(privateMediaAccessPath(assetPublicId), {
        method: "GET",
        ...init,
    });
}

export type PublishStopPhotoBody = {
    rotateDegrees?: 0 | 90 | 180 | 270;
    crop?: { x: number; y: number; width: number; height: number } | null;
    blurRects?: { x: number; y: number; width: number; height: number }[];
    note?: string | null;
    isPrimary?: boolean;
};

export function publishStopPhoto(assetPublicId: string, body: PublishStopPhotoBody) {
    return apiFetch(`/admin/media/${encodeURIComponent(assetPublicId)}/publish-stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

export function changeReportStatus(id: string, statusCode: ReportStatusCode, note?: string) {
    const request = reportStatusChangeRequest(id, statusCode, note);
    return apiFetch<AdminReport>(request.path, {
        method: request.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
    });
}

/** Typed apply — body is action + revision only; server loads trusted report evidence. */
export function applyReportAction(id: string, body: ReportApplyRequest) {
    return apiFetch<ReportApplyResult>(`/admin/reports/${encodeURIComponent(id)}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

export function requestReportInfo(id: string, message: string) {
    return apiFetch<AdminReportDetail>(`/admin/reports/${encodeURIComponent(id)}/request-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
    });
}

export function updateReportAdminNote(id: string, adminNote: string | null) {
    return apiFetch<AdminReport>(`/admin/reports/${encodeURIComponent(id)}/admin-note`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminNote }),
    });
}

export function rewardReportPoints(
    id: string,
    body: { pointsDelta: number; reasonCode: RewardReasonCode; note?: string }
) {
    return apiFetch<RewardResult>(`/admin/reports/${encodeURIComponent(id)}/reward-points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

export function getReportAnalyticsSummary(init?: Signal) {
    return apiFetch<ReportAnalyticsSummary>("/admin/reports/analytics/summary", {
        method: "GET",
        ...init,
    });
}

export function getReportAnalyticsByType(init?: Signal) {
    return apiFetch<ReportCodeCount[]>("/admin/reports/analytics/by-type", {
        method: "GET",
        ...init,
    });
}

export function getReportAnalyticsByStatus(init?: Signal) {
    return apiFetch<ReportCodeCount[]>("/admin/reports/analytics/by-status", {
        method: "GET",
        ...init,
    });
}

export function getReportAnalyticsByRegion(init?: Signal) {
    return apiFetch<ReportRegionCount[]>("/admin/reports/analytics/by-region", {
        method: "GET",
        ...init,
    });
}

export function getReportAnalyticsAnonymous(init?: Signal) {
    return apiFetch<ReportAnonymousCount>("/admin/reports/analytics/anonymous-vs-logged-in", {
        method: "GET",
        ...init,
    });
}
