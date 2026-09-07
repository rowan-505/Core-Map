package com.coremapmm.fieldsurveyor.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "local_survey_sessions",
    indices = [
        Index(value = ["startedAtEpochMs"]),
        Index(value = ["syncState"]),
        Index(value = ["serverPublicId"], unique = true),
    ],
)
data class LocalSurveySessionEntity(
    @PrimaryKey val clientSessionId: String,
    val serverPublicId: String?,
    val routePublicId: String,
    val routeCode: String,
    val variantPublicId: String,
    val variantCode: String,
    val originName: String?,
    val destinationName: String?,
    val snapshotRevision: String,
    val startedAtEpochMs: Long,
    val endedAtEpochMs: Long?,
    val status: String,
    val syncState: String,
    val updatedAtEpochMs: Long,
    val lastError: String? = null,
) {
    companion object {
        const val STATUS_ACTIVE = "ACTIVE"
        const val STATUS_COMPLETED = "COMPLETED"
        const val STATUS_ABANDONED = "ABANDONED"
        const val SYNC_LOCAL = "LOCAL"
        const val SYNC_SYNCING = "SYNCING"
        const val SYNC_SYNCED = "SYNCED"
        const val SYNC_RETRY = "RETRY"
        const val SYNC_PERMANENT_ERROR = "PERMANENT_ERROR"
    }
}

data class VariantLastSurveyRow(
    val variantPublicId: String,
    val lastStartedAtEpochMs: Long,
)

data class SurveyHistoryRow(
    val clientSessionId: String,
    val routeCode: String,
    val variantCode: String,
    val originName: String?,
    val destinationName: String?,
    val startedAtEpochMs: Long,
    val endedAtEpochMs: Long?,
    val status: String,
    val syncState: String,
    val reportCount: Int,
)
