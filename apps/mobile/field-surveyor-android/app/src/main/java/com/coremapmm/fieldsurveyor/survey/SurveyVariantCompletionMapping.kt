package com.coremapmm.fieldsurveyor.survey

/** Pure mapping for personal variant completion marks. */
object SurveyVariantCompletionMapping {
    fun badge(isFinished: Boolean?): String? = when (isFinished) {
        true -> "Finished"
        false -> "Partial"
        null -> null
    }

    fun finishedMap(rows: List<Pair<String, Boolean>>): Map<String, Boolean> =
        rows.associate { it.first to it.second }

    fun applyLocalPut(
        existingFinished: Boolean?,
        finished: Boolean,
        nowMs: Long,
        previousFinishedAt: Long?,
    ): LocalPut {
        val finishedAt = when {
            !finished -> null
            existingFinished == true -> previousFinishedAt ?: nowMs
            else -> nowMs
        }
        return LocalPut(
            isFinished = finished,
            finishedAtEpochMs = finishedAt,
            changed = existingFinished != finished,
        )
    }

    data class LocalPut(
        val isFinished: Boolean,
        val finishedAtEpochMs: Long?,
        val changed: Boolean,
    )

    /** Remote GET may overwrite only settled local rows. */
    fun canApplyRemote(localSyncState: String?): Boolean =
        localSyncState == null ||
            localSyncState == com.coremapmm.fieldsurveyor.data.LocalSurveyVariantCompletionEntity.SYNC_SYNCED ||
            localSyncState == com.coremapmm.fieldsurveyor.data.LocalSurveyVariantCompletionEntity.SYNC_PERMANENT_ERROR
}
