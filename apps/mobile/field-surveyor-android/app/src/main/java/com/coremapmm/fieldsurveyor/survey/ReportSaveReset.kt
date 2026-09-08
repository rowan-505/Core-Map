package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow

data class ReportAfterLocalSave(
    val nextStopPublicId: String?,
    val endOfRoute: Boolean,
)

/**
 * Local save success = Room outbox write succeeded. Network upload is separate.
 * After success the UI must reset to a compact empty form and advance the stop window.
 */
object ReportSaveReset {
    const val REPORT_SAVED = "Report saved"
    const val SAVED_OFFLINE = "Saved offline"
    const val END_OF_ROUTE = "Last stop on this direction."
    const val ROOM_SAVE_FAILED = "Could not save report. Try again."

    fun successBanner(online: Boolean): String =
        if (online) REPORT_SAVED else SAVED_OFFLINE

    fun afterLocalSave(
        stops: List<OrderedStopRow>,
        selectedStopPublicId: String?,
    ): ReportAfterLocalSave {
        val next = CorrectStopAction.nextStopPublicId(stops, selectedStopPublicId)
        return ReportAfterLocalSave(
            nextStopPublicId = next,
            endOfRoute = selectedStopPublicId != null && next == null,
        )
    }

    /** Draft media files stay until Room succeeds. */
    fun shouldClearDraftMedia(roomSucceeded: Boolean): Boolean = roomSucceeded

    fun shouldResetForm(roomSucceeded: Boolean): Boolean = roomSucceeded

    fun roomFailureMessage(error: Throwable?): String {
        val raw = error?.message?.trim().orEmpty()
        return when {
            raw.isBlank() -> ROOM_SAVE_FAILED
            raw.equals("Could not save report", ignoreCase = true) -> ROOM_SAVE_FAILED
            raw.length > 80 -> ROOM_SAVE_FAILED
            else -> raw
        }
    }

    fun allowedSuccessBanners(): Set<String> = setOf(REPORT_SAVED, SAVED_OFFLINE)
}
