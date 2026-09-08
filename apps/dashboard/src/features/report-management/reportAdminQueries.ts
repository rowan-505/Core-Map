import type { ReportsListFilters, ReportStatusCode } from "./types";

export function listReportsPath(filters: ReportsListFilters = {}): string {
    const sp = new URLSearchParams();
    if (filters.status) sp.set("status", filters.status);
    if (filters.type) sp.set("type", filters.type);
    if (filters.adminAreaId !== undefined) sp.set("adminAreaId", String(filters.adminAreaId));
    if (filters.targetEntityType) sp.set("targetEntityType", filters.targetEntityType);
    if (filters.source) sp.set("source", filters.source);
    if (filters.routeCode) sp.set("routeCode", filters.routeCode);
    if (filters.variantCode) sp.set("variantCode", filters.variantCode);
    if (filters.anonymous !== undefined) sp.set("anonymous", String(filters.anonymous));
    if (filters.createdFrom) sp.set("createdFrom", filters.createdFrom);
    if (filters.createdTo) sp.set("createdTo", filters.createdTo);
    if (filters.page !== undefined) sp.set("page", String(filters.page));
    if (filters.pageSize !== undefined) sp.set("pageSize", String(filters.pageSize));
    const qs = sp.toString();
    return `/admin/reports${qs ? `?${qs}` : ""}`;
}

export function reportStatusChangeRequest(id: string, statusCode: ReportStatusCode, note?: string) {
    return {
        path: `/admin/reports/${encodeURIComponent(id)}/status`,
        method: "PATCH" as const,
        body: { statusCode, ...(note ? { note } : {}) },
    };
}

export function getReportPath(id: string): string {
    return `/admin/reports/${encodeURIComponent(id)}`;
}
