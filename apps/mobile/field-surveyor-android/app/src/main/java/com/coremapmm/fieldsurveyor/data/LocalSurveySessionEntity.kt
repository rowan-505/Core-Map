package com.coremapmm.fieldsurveyor.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.coremapmm.fieldsurveyor.survey.SurveySessionOps

@Entity(
    tableName = "local_survey_sessions",
    indices = [
        Index(value = ["startedAtEpochMs"]),
        Index(value = ["syncState"]),
        Index(value = ["serverPublicId"], unique = true),
        Index(value = ["variantPublicId"]),
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
    val trackingState: String = SurveySessionOps.TRACKING_IDLE,
    val completionStatus: String = SurveySessionOps.COMPLETION_PARTIAL,
    val accumulatedActiveSeconds: Int = 0,
    val finishedAtEpochMs: Long? = null,
    val reopenedAtEpochMs: Long? = null,
    val lastActivityAtEpochMs: Long? = null,
    val lastCheckedStopSequence: Int? = null,
    val checkedStopCount: Int = 0,
    val totalStopCount: Int = 0,
    val pendingSyncCount: Int = 0,
    val lastGpsAccuracyM: Float? = null,
    val lastLat: Double? = null,
    val lastLng: Double? = null,
    val lastGpsAtEpochMs: Long? = null,
    val activeSegmentStartedAtEpochMs: Long? = null,
    val lastHeartbeatAtEpochMs: Long? = null,
    val pendingFinishSync: Boolean = false,
    val pendingReopenSync: Boolean = false,
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

data class VariantCompletionRow(
    val variantPublicId: String,
    val completionStatus: String,
    val finishedAtEpochMs: Long?,
)

data class SurveyHistoryRow(
    val clientSessionId: String,
    val routeCode: String,
    val variantCode: String,
    val variantPublicId: String,
    val originName: String?,
    val destinationName: String?,
    val startedAtEpochMs: Long,
    val endedAtEpochMs: Long?,
    val status: String,
    val syncState: String,
    val reportCount: Int,
    val completionStatus: String = SurveySessionOps.COMPLETION_PARTIAL,
    val trackingState: String = SurveySessionOps.TRACKING_IDLE,
    val accumulatedActiveSeconds: Int = 0,
    val checkedStopCount: Int = 0,
    val totalStopCount: Int = 0,
    val finishedAtEpochMs: Long? = null,
    val reopenedAtEpochMs: Long? = null,
)
