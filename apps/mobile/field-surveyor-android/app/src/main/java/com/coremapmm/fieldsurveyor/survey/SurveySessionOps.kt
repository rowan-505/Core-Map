package com.coremapmm.fieldsurveyor.survey

/**
 * Pure helpers for operational survey-session tracking.
 * Tracking (idle/active) is separate from completion (partial/finished).
 */
object SurveySessionOps {
    const val TRACKING_IDLE = "idle"
    const val TRACKING_ACTIVE = "active"
    const val COMPLETION_PARTIAL = "partial"
    const val COMPLETION_FINISHED = "finished"
    const val HEARTBEAT_MIN_INTERVAL_MS = 60_000L
    const val EVENT_START = "START"
    const val EVENT_STOP = "STOP"
    const val EVENT_FINISH = "FINISH"
    const val EVENT_REOPEN = "REOPEN"

    fun trackingForStatus(status: String): String =
        if (status.equals("ACTIVE", ignoreCase = true)) TRACKING_ACTIVE else TRACKING_IDLE

    fun accumulateSeconds(
        previousSeconds: Int,
        segmentStartedAtMs: Long?,
        stoppedAtMs: Long,
    ): Int {
        if (segmentStartedAtMs == null || stoppedAtMs <= segmentStartedAtMs) {
            return previousSeconds.coerceAtLeast(0)
        }
        val added = ((stoppedAtMs - segmentStartedAtMs) / 1_000L).toInt().coerceAtLeast(0)
        return (previousSeconds + added).coerceAtLeast(0)
    }

    fun shouldHeartbeat(lastHeartbeatAtMs: Long?, nowMs: Long): Boolean {
        if (lastHeartbeatAtMs == null) return true
        return nowMs - lastHeartbeatAtMs >= HEARTBEAT_MIN_INTERVAL_MS
    }

    fun finishIdempotent(current: String): String =
        if (current == COMPLETION_FINISHED) COMPLETION_FINISHED else COMPLETION_FINISHED

    fun reopenIdempotent(current: String): String =
        if (current == COMPLETION_PARTIAL) COMPLETION_PARTIAL else COMPLETION_PARTIAL

    fun applyFinish(
        trackingState: String,
        completionStatus: String,
        nowMs: Long,
        accumulatedSeconds: Int,
        segmentStartedAtMs: Long?,
    ): FinishResult {
        val already = completionStatus == COMPLETION_FINISHED
        val seconds = if (trackingState == TRACKING_ACTIVE) {
            accumulateSeconds(accumulatedSeconds, segmentStartedAtMs, nowMs)
        } else {
            accumulatedSeconds
        }
        return FinishResult(
            changed = !already,
            trackingState = TRACKING_IDLE,
            completionStatus = COMPLETION_FINISHED,
            finishedAtEpochMs = nowMs,
            accumulatedActiveSeconds = seconds,
            stopTracking = trackingState == TRACKING_ACTIVE,
        )
    }

    fun applyReopen(completionStatus: String, nowMs: Long): ReopenResult {
        val already = completionStatus == COMPLETION_PARTIAL
        return ReopenResult(
            changed = !already,
            completionStatus = COMPLETION_PARTIAL,
            reopenedAtEpochMs = nowMs,
            trackingState = TRACKING_IDLE,
            restartGps = false,
        )
    }

    data class FinishResult(
        val changed: Boolean,
        val trackingState: String,
        val completionStatus: String,
        val finishedAtEpochMs: Long,
        val accumulatedActiveSeconds: Int,
        val stopTracking: Boolean,
    )

    data class ReopenResult(
        val changed: Boolean,
        val completionStatus: String,
        val reopenedAtEpochMs: Long,
        val trackingState: String,
        val restartGps: Boolean,
    )
}
