package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.LocalSurveySessionEntity
import com.coremapmm.fieldsurveyor.data.SurveyHistoryRow

/** Mirrors API survey-session-classify for local Survey History. */
object SurveySessionClassify {
    const val SHORT_EMPTY_ACTIVE_SECONDS = 60

    fun isShortEmptySession(
        status: String,
        activeDurationSeconds: Int,
        checkedStopCount: Int,
        reportCount: Int,
        finishedAtEpochMs: Long?,
        reopenedAtEpochMs: Long?,
    ): Boolean {
        if (!status.equals(LocalSurveySessionEntity.STATUS_COMPLETED, ignoreCase = true)) return false
        if (activeDurationSeconds >= SHORT_EMPTY_ACTIVE_SECONDS) return false
        if (checkedStopCount > 0) return false
        if (reportCount > 0) return false
        if (finishedAtEpochMs != null) return false
        if (reopenedAtEpochMs != null) return false
        return true
    }

    fun isShortEmpty(row: SurveyHistoryRow): Boolean =
        isShortEmptySession(
            status = row.status,
            activeDurationSeconds = row.accumulatedActiveSeconds,
            checkedStopCount = row.checkedStopCount,
            reportCount = row.reportCount,
            finishedAtEpochMs = row.finishedAtEpochMs,
            reopenedAtEpochMs = row.reopenedAtEpochMs,
        )

    fun formatCheckedLabel(checked: Int, total: Int): String {
        if (total <= 0) return if (checked > 0) "$checked / —" else "—"
        return "$checked / $total"
    }

    fun formatReportLabel(reportCount: Int): String =
        when {
            reportCount <= 0 -> "No reports"
            reportCount == 1 -> "1 report"
            else -> "$reportCount reports"
        }

    fun formatActiveDuration(seconds: Int): String {
        val safe = seconds.coerceAtLeast(0)
        val minutes = (safe / 60).coerceAtLeast(if (safe > 0 && safe < 60) 1 else 0)
        val hours = minutes / 60
        val rem = minutes % 60
        return if (hours > 0) "${hours}h ${rem}m" else "${minutes}m"
    }

    fun partitionHistory(rows: List<SurveyHistoryRow>): Pair<List<SurveyHistoryRow>, List<SurveyHistoryRow>> {
        val meaningful = ArrayList<SurveyHistoryRow>()
        val shortEmpty = ArrayList<SurveyHistoryRow>()
        for (row in rows) {
            if (isShortEmpty(row)) shortEmpty.add(row) else meaningful.add(row)
        }
        return meaningful to shortEmpty
    }
}
