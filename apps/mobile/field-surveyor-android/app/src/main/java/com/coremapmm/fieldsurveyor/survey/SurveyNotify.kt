package com.coremapmm.fieldsurveyor.survey

/**
 * In-app survey notifications. Local Room/outbox success is not a sync failure.
 * Durations are milliseconds for SnackbarHost.
 */
enum class SurveyNotifyTone {
    SUCCESS,
    WARNING,
    FAILURE,
    OFFLINE,
    INFO,
}

data class SurveyNotifyEvent(
    val id: Long,
    val message: String,
    val tone: SurveyNotifyTone,
    val durationMs: Long,
    val actionLabel: String? = null,
    val actionKey: String? = null,
)

object SurveyNotifyCopy {
    const val REPORT_SAVED = "Report saved"
    const val SAVED_OFFLINE = "Saved offline — sync pending"
    const val SAVE_FAILED = "Could not save"
    const val SURVEY_STARTED = "Survey started"
    const val SURVEY_STOPPED = "Survey stopped"
    const val RETRY = "Retry"
    const val ACTION_RETRY_SAVE = "retry_save"

    const val SUCCESS_MS = 1_500L
    const val WARNING_MS = 2_000L
    const val FAILURE_MS = 3_000L
    const val OFFLINE_MS = 2_000L
    const val INFO_MS = 1_500L
}

object SurveyNotify {
    fun success(message: String, id: Long = 0L): SurveyNotifyEvent =
        SurveyNotifyEvent(id, message, SurveyNotifyTone.SUCCESS, SurveyNotifyCopy.SUCCESS_MS)

    fun warning(message: String, id: Long = 0L): SurveyNotifyEvent =
        SurveyNotifyEvent(id, message, SurveyNotifyTone.WARNING, SurveyNotifyCopy.WARNING_MS)

    fun offline(message: String = SurveyNotifyCopy.SAVED_OFFLINE, id: Long = 0L): SurveyNotifyEvent =
        SurveyNotifyEvent(id, message, SurveyNotifyTone.OFFLINE, SurveyNotifyCopy.OFFLINE_MS)

    fun failure(
        message: String,
        id: Long = 0L,
        retryActionKey: String? = null,
    ): SurveyNotifyEvent = SurveyNotifyEvent(
        id = id,
        message = message,
        tone = SurveyNotifyTone.FAILURE,
        durationMs = SurveyNotifyCopy.FAILURE_MS,
        actionLabel = retryActionKey?.let { SurveyNotifyCopy.RETRY },
        actionKey = retryActionKey,
    )

    fun info(message: String, id: Long = 0L): SurveyNotifyEvent =
        SurveyNotifyEvent(id, message, SurveyNotifyTone.INFO, SurveyNotifyCopy.INFO_MS)

    fun afterLocalSave(online: Boolean, id: Long = 0L): SurveyNotifyEvent =
        if (online) success(SurveyNotifyCopy.REPORT_SAVED, id) else offline(id = id)

    fun afterRoomFailure(id: Long = 0L): SurveyNotifyEvent =
        failure(SurveyNotifyCopy.SAVE_FAILED, id = id, retryActionKey = SurveyNotifyCopy.ACTION_RETRY_SAVE)

    fun surveyStarted(id: Long = 0L): SurveyNotifyEvent =
        success(SurveyNotifyCopy.SURVEY_STARTED, id)

    fun surveyStopped(id: Long = 0L): SurveyNotifyEvent =
        success(SurveyNotifyCopy.SURVEY_STOPPED, id)

    /** Soft prompts that should not look like hard failures. */
    fun isWarningMessage(message: String): Boolean {
        val normalized = message.trim().lowercase()
        return normalized == "start the survey first." ||
            normalized == "select a stop first." ||
            normalized == "hold longer to record." ||
            normalized.startsWith("turn on gps") ||
            normalized.startsWith("location permission is required")
    }

    fun fromMessage(message: String, id: Long = 0L): SurveyNotifyEvent = when {
        message == ReportSaveReset.REPORT_SAVED ||
            message.equals(SurveyNotifyCopy.REPORT_SAVED, ignoreCase = true) -> success(message, id)
        message == ReportSaveReset.SAVED_OFFLINE ||
            message.contains("sync pending", ignoreCase = true) -> offline(message, id)
        isWarningMessage(message) -> warning(message, id)
        else -> failure(message, id)
    }

    /**
     * Replace-on-new: a newer event becomes current immediately; pending is cleared.
     * Returns (visibleEvent, emptyPending).
     */
    fun replaceCurrent(event: SurveyNotifyEvent): Pair<SurveyNotifyEvent, List<SurveyNotifyEvent>> =
        event to emptyList()

    /** @deprecated Prefer [replaceCurrent]; kept for older call sites. */
    fun nextQueued(current: SurveyNotifyEvent?, pending: List<SurveyNotifyEvent>): Pair<SurveyNotifyEvent?, List<SurveyNotifyEvent>> {
        if (current != null) return current to pending
        if (pending.isEmpty()) return null to emptyList()
        return pending.first() to pending.drop(1)
    }

    fun enqueue(pending: List<SurveyNotifyEvent>, event: SurveyNotifyEvent): List<SurveyNotifyEvent> =
        listOf(event)
}
