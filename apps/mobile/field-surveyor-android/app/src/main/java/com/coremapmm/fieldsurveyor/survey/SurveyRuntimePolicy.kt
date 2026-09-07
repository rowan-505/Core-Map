package com.coremapmm.fieldsurveyor.survey

enum class SurveyStartDecision {
    START,
    ALREADY_ACTIVE,
    NO_SELECTION,
    NO_PERMISSION,
    LOCATION_DISABLED,
    NOT_ACTIVE,
}

/** Deterministic lifecycle decisions shared by the visible action and service restore path. */
object SurveyRuntimePolicy {
    fun visibleStart(
        running: Boolean,
        hasSelection: Boolean,
        hasPermission: Boolean,
        locationEnabled: Boolean,
    ): SurveyStartDecision = when {
        running -> SurveyStartDecision.ALREADY_ACTIVE
        !hasSelection -> SurveyStartDecision.NO_SELECTION
        !hasPermission -> SurveyStartDecision.NO_PERMISSION
        !locationEnabled -> SurveyStartDecision.LOCATION_DISABLED
        else -> SurveyStartDecision.START
    }

    fun restore(
        persistedActive: Boolean,
        hasSelection: Boolean,
        hasPermission: Boolean,
        locationEnabled: Boolean,
    ): SurveyStartDecision = when {
        !persistedActive -> SurveyStartDecision.NOT_ACTIVE
        !hasSelection -> SurveyStartDecision.NO_SELECTION
        !hasPermission -> SurveyStartDecision.NO_PERMISSION
        !locationEnabled -> SurveyStartDecision.LOCATION_DISABLED
        else -> SurveyStartDecision.START
    }

    fun failureStopsSurvey(failure: TrackingFailure): Boolean =
        failure == TrackingFailure.PERMISSION_REVOKED
}

/** Makes foreground start/stop calls idempotent, including a restored active session. */
class SurveyForegroundCoordinator(
    initiallyRequested: Boolean,
    private val startService: () -> Boolean,
    private val stopService: () -> Unit,
) {
    private var requested = initiallyRequested

    fun start(): Boolean {
        if (requested) return true
        if (!startService()) return false
        requested = true
        return true
    }

    fun stop() {
        if (!requested) return
        requested = false
        stopService()
    }
}
