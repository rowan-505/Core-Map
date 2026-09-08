package com.coremapmm.fieldsurveyor.survey

/** One fused callback at a time. Restart replaces that callback; it does not stack. */
object GpsSubscriptionPolicy {
    fun shouldRegisterCallback(hasActiveCallback: Boolean): Boolean = !hasActiveCallback

    fun shouldRestart(hasActiveCallback: Boolean, restartRequested: Boolean): Boolean =
        restartRequested && hasActiveCallback
}

enum class TrackingWatchdogAction {
    NONE,
    REQUEST_FRESH,
    RESTART_ONCE,
}

data class TrackingWatchdogState(
    val lastCallbackAtMs: Long = 0L,
    val lastFreshAtMs: Long = 0L,
    val lastRestartAtMs: Long = 0L,
    val freshRequestedSinceCallback: Boolean = false,
    val restartedSinceCallback: Boolean = false,
    val tracking: Boolean = false,
)

/**
 * Bounded recovery while a survey is active. Silence of ~9s marks the last
 * coordinate stale, asks for one current location, then restarts the single
 * subscription once. A cooldown blocks restart loops.
 */
object TrackingWatchdog {
    const val SILENCE_MS = 9_000L
    const val FRESH_WAIT_MS = 2_000L
    const val RESTART_COOLDOWN_MS = 20_000L

    fun started(nowMs: Long): TrackingWatchdogState = TrackingWatchdogState(
        lastCallbackAtMs = nowMs,
        tracking = true,
    )

    fun stopped(): TrackingWatchdogState = TrackingWatchdogState()

    fun onCallback(state: TrackingWatchdogState, nowMs: Long): TrackingWatchdogState {
        if (!state.tracking) return state
        return state.copy(
            lastCallbackAtMs = nowMs,
            freshRequestedSinceCallback = false,
            restartedSinceCallback = false,
        )
    }

    fun onTick(state: TrackingWatchdogState, nowMs: Long): Pair<TrackingWatchdogState, TrackingWatchdogAction> {
        if (!state.tracking) {
            return state to TrackingWatchdogAction.NONE
        }
        val silence = nowMs - state.lastCallbackAtMs
        if (silence < SILENCE_MS) {
            return state to TrackingWatchdogAction.NONE
        }
        if (!state.freshRequestedSinceCallback) {
            return state.copy(
                freshRequestedSinceCallback = true,
                lastFreshAtMs = nowMs,
            ) to TrackingWatchdogAction.REQUEST_FRESH
        }
        val waitedForFresh = nowMs - state.lastFreshAtMs >= FRESH_WAIT_MS
        val cooldownElapsed = state.lastRestartAtMs == 0L ||
            nowMs - state.lastRestartAtMs >= RESTART_COOLDOWN_MS
        if (!state.restartedSinceCallback && waitedForFresh && cooldownElapsed) {
            return state.copy(
                restartedSinceCallback = true,
                lastRestartAtMs = nowMs,
            ) to TrackingWatchdogAction.RESTART_ONCE
        }
        return state to TrackingWatchdogAction.NONE
    }
}

/** Host activity/service events must not stack fused subscriptions. */
object SurveyTrackingResumePolicy {
    fun keepSubscriptionWhenActivityStops(surveyRunning: Boolean): Boolean = surveyRunning

    fun abandonSurveyWhenServiceDestroyed(): Boolean = false

    fun restoreStartsTracking(alreadyTracking: Boolean): Boolean = !alreadyTracking

    fun resumeAfterSettingsOrPermission(
        surveyRunning: Boolean,
        hasPermission: Boolean,
        alreadyTracking: Boolean,
    ): SurveyStartDecision = when {
        !surveyRunning -> SurveyStartDecision.NOT_ACTIVE
        !hasPermission -> SurveyStartDecision.NO_PERMISSION
        alreadyTracking -> SurveyStartDecision.ALREADY_ACTIVE
        else -> SurveyStartDecision.START
    }
}
