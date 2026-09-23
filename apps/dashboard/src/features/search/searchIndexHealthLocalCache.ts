import type { SearchIndexHealthReport } from "./types";

const STORAGE_KEY = "coremap.searchIndexHealth.v1";
const MIN_HEALTH_FAMILIES = 10;

type StoredHealthReport = {
    savedAt: number;
    report: SearchIndexHealthReport;
};

export function isCompleteSearchIndexHealthReport(
    value: unknown,
): value is SearchIndexHealthReport {
    if (!value || typeof value !== "object") {
        return false;
    }
    const report = value as SearchIndexHealthReport;
    return (
        report.health_query_ok === true &&
        Array.isArray(report.families) &&
        report.families.length >= MIN_HEALTH_FAMILIES &&
        typeof report.overall_severity === "string"
    );
}

export function clearCachedSearchIndexHealthReport(): void {
    if (typeof window === "undefined") {
        return;
    }
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Ignore.
    }
}

export function readCachedSearchIndexHealthReport(): StoredHealthReport | null {
    if (typeof window === "undefined") {
        return null;
    }
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw) as StoredHealthReport;
    if (!isCompleteSearchIndexHealthReport(parsed.report) || typeof parsed.savedAt !== "number") {
            window.localStorage.removeItem(STORAGE_KEY);
            return null;
        }
        if (parsed.report.report_mode === "snapshot") {
            window.localStorage.removeItem(STORAGE_KEY);
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function writeCachedSearchIndexHealthReport(report: SearchIndexHealthReport): void {
    if (
        typeof window === "undefined" ||
        !isCompleteSearchIndexHealthReport(report) ||
        report.report_mode === "snapshot"
    ) {
        return;
    }
    try {
        const payload: StoredHealthReport = {
            savedAt: Date.now(),
            report,
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
        // Quota / private mode — ignore.
    }
}
