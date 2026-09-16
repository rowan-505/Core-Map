package com.coremapmm.fieldsurveyor.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "local_survey_variant_completions",
    indices = [
        Index(value = ["syncState"]),
        Index(value = ["isFinished"]),
    ],
)
data class LocalSurveyVariantCompletionEntity(
    @PrimaryKey val variantPublicId: String,
    val routePublicId: String?,
    val routeCode: String?,
    val variantCode: String?,
    val isFinished: Boolean,
    val finishedAtEpochMs: Long?,
    val updatedAtEpochMs: Long,
    val syncState: String,
    val lastError: String? = null,
) {
    companion object {
        const val SYNC_LOCAL = "LOCAL"
        const val SYNC_SYNCING = "SYNCING"
        const val SYNC_SYNCED = "SYNCED"
        const val SYNC_RETRY = "RETRY"
        const val SYNC_PERMANENT_ERROR = "PERMANENT_ERROR"
    }
}
