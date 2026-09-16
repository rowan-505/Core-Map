/**
 * Derived session classification for Work History / Survey History.
 * Short empty completed sessions stay in the database for audit but can be hidden in UI.
 */

export type ShortEmptySessionInput = {
    sessionStatus: string | null | undefined;
    activeDurationSeconds: number;
    checkedStopCount: number;
    reportCount: number;
    finishedAt: Date | string | null | undefined;
    reopenedAt: Date | string | null | undefined;
};

/** Completed + under 60s active + no checks + no reports + no Finish/Reopen. */
export function isShortEmptySession(input: ShortEmptySessionInput): boolean {
    const status = (input.sessionStatus ?? "").toLowerCase();
    if (status !== "completed") return false;
    if (input.activeDurationSeconds >= 60) return false;
    if (input.checkedStopCount > 0) return false;
    if (input.reportCount > 0) return false;
    if (input.finishedAt != null) return false;
    if (input.reopenedAt != null) return false;
    return true;
}

/** Historical rows: use saved total when present; otherwise show not recorded. */
export function formatHistoricalCheckedLabel(
    checkedStopCount: number,
    totalStopCount: number | null | undefined
): string {
    if (totalStopCount == null || totalStopCount <= 0) {
        return checkedStopCount > 0 ? `${checkedStopCount} / —` : "—";
    }
    return `${checkedStopCount} / ${totalStopCount}`;
}

/** Coverage rows: always use canonical ordered-stop total when available. */
export function formatCoverageCheckedLabel(
    checkedStopCount: number,
    canonicalTotalStopCount: number
): string {
    const total = Math.max(0, canonicalTotalStopCount);
    if (total <= 0) {
        return checkedStopCount > 0 ? `${checkedStopCount} / —` : "—";
    }
    return `${checkedStopCount} / ${total}`;
}

export function formatReportCountLabel(reportCount: number): string {
    if (reportCount <= 0) return "No reports";
    if (reportCount === 1) return "1 report";
    return `${reportCount} reports`;
}
