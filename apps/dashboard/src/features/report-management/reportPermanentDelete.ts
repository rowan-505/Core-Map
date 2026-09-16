import type { AdminReport, AdminReportList, ReportStatusCode } from "./types";

export type ReportPermanentDeleteResult = {
    deleted: true;
    public_id: string;
    media_cleanup_warning: string | null;
};

export type ReportPermanentDeleteErrorKind =
    | "not_found"
    | "forbidden"
    | "conflict"
    | "network"
    | "unknown";

/** Only server status `rejected` may show permanent delete. */
export function canPermanentlyDeleteReport(statusCode: ReportStatusCode | string | undefined): boolean {
    return statusCode === "rejected";
}

export function removeReportFromList(
    list: AdminReportList | null | undefined,
    publicId: string
): AdminReportList | null {
    if (!list) {
        return null;
    }
    const items = list.items.filter((row) => row.public_id !== publicId);
    if (items.length === list.items.length) {
        return list;
    }
    return {
        ...list,
        items,
        total: Math.max(0, list.total - 1),
    };
}

export function reportDeleteDialogSummary(report: AdminReport): {
    reportType: string;
    related: string;
    timestamp: string;
} {
    const reportType = report.report_type?.name || report.report_type?.code || "Report";
    const route = report.field?.route_code?.trim() || null;
    const stop =
        report.field?.stop_name?.trim() ||
        report.field?.stop_public_id?.trim() ||
        report.target_public_id ||
        null;
    let related = "—";
    if (route && stop) {
        related = `Route ${route} · Stop ${stop}`;
    } else if (route) {
        related = `Route ${route}`;
    } else if (stop) {
        related = `Stop ${stop}`;
    } else if (report.target_entity_type) {
        related = report.target_entity_type;
    }
    const timestamp = report.observed_at || report.created_at;
    return { reportType, related, timestamp };
}

export function classifyReportPermanentDeleteError(error: unknown): {
    kind: ReportPermanentDeleteErrorKind;
    message: string;
} {
    if (!(error instanceof Error)) {
        return { kind: "unknown", message: "Could not delete report." };
    }
    const message = error.message.trim() || "Could not delete report.";
    const lower = message.toLowerCase();
    if (
        lower.includes("failed to fetch") ||
        lower.includes("network") ||
        lower.includes("networkerror") ||
        lower.includes("load failed")
    ) {
        return { kind: "network", message: "Network error. Check your connection and try again." };
    }
    if (lower.includes("insufficient role") || lower.includes("forbidden") || /\b403\b/.test(lower)) {
        return { kind: "forbidden", message: "You are not allowed to delete reports." };
    }
    if (lower.includes("not found") || /\b404\b/.test(lower)) {
        return { kind: "not_found", message: "This report was already deleted." };
    }
    if (
        lower.includes("unless its status is rejected") ||
        lower.includes("cannot be permanently deleted") ||
        /\b409\b/.test(lower)
    ) {
        return {
            kind: "conflict",
            message: "This report is no longer rejected, so it cannot be permanently deleted.",
        };
    }
    return { kind: "unknown", message };
}
