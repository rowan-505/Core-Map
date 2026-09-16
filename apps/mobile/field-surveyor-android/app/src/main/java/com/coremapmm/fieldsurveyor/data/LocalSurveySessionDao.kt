package com.coremapmm.fieldsurveyor.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
interface LocalSurveySessionDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(row: LocalSurveySessionEntity)

    @Query("SELECT * FROM local_survey_sessions WHERE clientSessionId = :id LIMIT 1")
    suspend fun findById(id: String): LocalSurveySessionEntity?

    @Query(
        """
        SELECT variantPublicId AS variantPublicId,
               MAX(startedAtEpochMs) AS lastStartedAtEpochMs
        FROM local_survey_sessions
        GROUP BY variantPublicId
        """,
    )
    suspend fun lastSurveyByVariant(): List<VariantLastSurveyRow>

    @Query(
        """
        SELECT variantPublicId AS variantPublicId,
               completionStatus AS completionStatus,
               MAX(finishedAtEpochMs) AS finishedAtEpochMs
        FROM local_survey_sessions
        WHERE completionStatus = 'finished'
        GROUP BY variantPublicId, completionStatus
        """,
    )
    suspend fun finishedVariants(): List<VariantCompletionRow>

    @Query(
        """
        SELECT * FROM local_survey_sessions
        WHERE variantPublicId = :variantPublicId
        ORDER BY startedAtEpochMs DESC
        LIMIT 1
        """,
    )
    suspend fun latestForVariant(variantPublicId: String): LocalSurveySessionEntity?

    @Query("SELECT * FROM local_survey_sessions WHERE status = 'ACTIVE' ORDER BY startedAtEpochMs DESC LIMIT 1")
    suspend fun findActive(): LocalSurveySessionEntity?

    @Query(
        """
        SELECT s.clientSessionId, s.routeCode, s.variantCode, s.variantPublicId, s.originName, s.destinationName,
               s.startedAtEpochMs, s.endedAtEpochMs, s.status, s.syncState,
               (SELECT COUNT(*) FROM local_reports r WHERE r.sessionClientSessionId = s.clientSessionId AND r.status <> 'CANCELLED') AS reportCount,
               s.completionStatus, s.trackingState,
               s.accumulatedActiveSeconds, s.checkedStopCount, s.totalStopCount,
               s.finishedAtEpochMs, s.reopenedAtEpochMs
        FROM local_survey_sessions s
        ORDER BY s.startedAtEpochMs DESC
        """,
    )
    fun observeHistory(): Flow<List<SurveyHistoryRow>>

    @Query(
        """
        SELECT s.clientSessionId, s.routeCode, s.variantCode, s.variantPublicId, s.originName, s.destinationName,
               s.startedAtEpochMs, s.endedAtEpochMs, s.status, s.syncState,
               (SELECT COUNT(*) FROM local_reports r WHERE r.sessionClientSessionId = s.clientSessionId AND r.status <> 'CANCELLED') AS reportCount,
               s.completionStatus, s.trackingState,
               s.accumulatedActiveSeconds, s.checkedStopCount, s.totalStopCount,
               s.finishedAtEpochMs, s.reopenedAtEpochMs
        FROM local_survey_sessions s
        ORDER BY s.startedAtEpochMs DESC
        LIMIT :limit
        """,
    )
    fun observeHistoryPage(limit: Int): Flow<List<SurveyHistoryRow>>

    @Query(
        """
        SELECT s.clientSessionId, s.routeCode, s.variantCode, s.variantPublicId, s.originName, s.destinationName,
               s.startedAtEpochMs, s.endedAtEpochMs, s.status, s.syncState,
               (SELECT COUNT(*) FROM local_reports r WHERE r.sessionClientSessionId = s.clientSessionId AND r.status <> 'CANCELLED') AS reportCount,
               s.completionStatus, s.trackingState,
               s.accumulatedActiveSeconds, s.checkedStopCount, s.totalStopCount,
               s.finishedAtEpochMs, s.reopenedAtEpochMs
        FROM local_survey_sessions s
        WHERE s.clientSessionId = :id
        LIMIT 1
        """,
    )
    fun observeHistoryRow(id: String): Flow<SurveyHistoryRow?>

    @Query(
        """
        SELECT * FROM local_survey_sessions
        WHERE syncState IN ('LOCAL', 'RETRY', 'SYNCING')
        ORDER BY startedAtEpochMs ASC LIMIT 1
        """,
    )
    suspend fun nextEligible(): LocalSurveySessionEntity?

    @Query(
        """
        UPDATE local_survey_sessions SET syncState = 'SYNCING', lastError = NULL,
            updatedAtEpochMs = :now
        WHERE clientSessionId = :id AND syncState IN ('LOCAL', 'RETRY', 'SYNCING')
        """,
    )
    suspend fun markSyncing(id: String, now: Long): Int

    @Query(
        """
        UPDATE local_survey_sessions SET
            status = :status,
            trackingState = 'idle',
            endedAtEpochMs = :endedAt,
            accumulatedActiveSeconds = :accumulatedActiveSeconds,
            activeSegmentStartedAtEpochMs = NULL,
            lastActivityAtEpochMs = :endedAt,
            syncState = 'LOCAL',
            lastError = NULL,
            updatedAtEpochMs = :endedAt
        WHERE clientSessionId = :id AND status = 'ACTIVE'
        """,
    )
    suspend fun markEnded(
        id: String,
        status: String,
        endedAt: Long,
        accumulatedActiveSeconds: Int,
    ): Int

    @Transaction
    suspend fun completeActiveAndStart(
        activeId: String,
        next: LocalSurveySessionEntity,
        now: Long,
        accumulatedActiveSeconds: Int,
    ): LocalSurveySessionEntity? {
        if (markEnded(activeId, LocalSurveySessionEntity.STATUS_COMPLETED, now, accumulatedActiveSeconds) != 1) {
            return null
        }
        insert(next)
        return next
    }

    @Query(
        """
        UPDATE local_survey_sessions SET serverPublicId = COALESCE(serverPublicId, :serverPublicId),
            syncState = :syncState, lastError = :lastError, updatedAtEpochMs = :now,
            pendingFinishSync = CASE WHEN :syncState = 'SYNCED' THEN 0 ELSE pendingFinishSync END,
            pendingReopenSync = CASE WHEN :syncState = 'SYNCED' THEN 0 ELSE pendingReopenSync END
        WHERE clientSessionId = :id
        """,
    )
    suspend fun updateSync(
        id: String,
        serverPublicId: String?,
        syncState: String,
        lastError: String?,
        now: Long,
    )

    @Query(
        """
        UPDATE local_survey_sessions SET
            trackingState = :trackingState,
            completionStatus = :completionStatus,
            accumulatedActiveSeconds = :accumulatedActiveSeconds,
            finishedAtEpochMs = :finishedAtEpochMs,
            reopenedAtEpochMs = :reopenedAtEpochMs,
            lastActivityAtEpochMs = :lastActivityAtEpochMs,
            lastCheckedStopSequence = :lastCheckedStopSequence,
            checkedStopCount = :checkedStopCount,
            totalStopCount = :totalStopCount,
            pendingSyncCount = :pendingSyncCount,
            lastGpsAccuracyM = :lastGpsAccuracyM,
            lastLat = :lastLat,
            lastLng = :lastLng,
            lastGpsAtEpochMs = :lastGpsAtEpochMs,
            activeSegmentStartedAtEpochMs = :activeSegmentStartedAtEpochMs,
            lastHeartbeatAtEpochMs = :lastHeartbeatAtEpochMs,
            pendingFinishSync = :pendingFinishSync,
            pendingReopenSync = :pendingReopenSync,
            status = :status,
            endedAtEpochMs = :endedAtEpochMs,
            syncState = 'LOCAL',
            lastError = NULL,
            updatedAtEpochMs = :now
        WHERE clientSessionId = :id
        """,
    )
    suspend fun upsertOperational(
        id: String,
        trackingState: String,
        completionStatus: String,
        accumulatedActiveSeconds: Int,
        finishedAtEpochMs: Long?,
        reopenedAtEpochMs: Long?,
        lastActivityAtEpochMs: Long?,
        lastCheckedStopSequence: Int?,
        checkedStopCount: Int,
        totalStopCount: Int,
        pendingSyncCount: Int,
        lastGpsAccuracyM: Float?,
        lastLat: Double?,
        lastLng: Double?,
        lastGpsAtEpochMs: Long?,
        activeSegmentStartedAtEpochMs: Long?,
        lastHeartbeatAtEpochMs: Long?,
        pendingFinishSync: Boolean,
        pendingReopenSync: Boolean,
        status: String,
        endedAtEpochMs: Long?,
        now: Long,
    )

    @Transaction
    suspend fun claimNext(now: Long): LocalSurveySessionEntity? {
        repeat(8) {
            val row = nextEligible() ?: return null
            if (markSyncing(row.clientSessionId, now) == 1) {
                return row.copy(syncState = LocalSurveySessionEntity.SYNC_SYNCING, updatedAtEpochMs = now)
            }
        }
        return null
    }
}
