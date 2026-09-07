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

    @Query("SELECT * FROM local_survey_sessions WHERE status = 'ACTIVE' ORDER BY startedAtEpochMs DESC LIMIT 1")
    suspend fun findActive(): LocalSurveySessionEntity?

    @Query(
        """
        SELECT s.clientSessionId, s.routeCode, s.variantCode, s.originName, s.destinationName,
               s.startedAtEpochMs, s.endedAtEpochMs, s.status, s.syncState,
               (SELECT COUNT(*) FROM local_reports r WHERE r.sessionClientSessionId = s.clientSessionId AND r.status <> 'CANCELLED') AS reportCount
        FROM local_survey_sessions s
        ORDER BY s.startedAtEpochMs DESC
        """,
    )
    fun observeHistory(): Flow<List<SurveyHistoryRow>>

    @Query(
        """
        SELECT s.clientSessionId, s.routeCode, s.variantCode, s.originName, s.destinationName,
               s.startedAtEpochMs, s.endedAtEpochMs, s.status, s.syncState,
               (SELECT COUNT(*) FROM local_reports r WHERE r.sessionClientSessionId = s.clientSessionId AND r.status <> 'CANCELLED') AS reportCount
        FROM local_survey_sessions s
        ORDER BY s.startedAtEpochMs DESC
        LIMIT :limit
        """,
    )
    fun observeHistoryPage(limit: Int): Flow<List<SurveyHistoryRow>>

    @Query(
        """
        SELECT s.clientSessionId, s.routeCode, s.variantCode, s.originName, s.destinationName,
               s.startedAtEpochMs, s.endedAtEpochMs, s.status, s.syncState,
               (SELECT COUNT(*) FROM local_reports r WHERE r.sessionClientSessionId = s.clientSessionId AND r.status <> 'CANCELLED') AS reportCount
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
        UPDATE local_survey_sessions SET status = :status, endedAtEpochMs = :endedAt,
            syncState = 'LOCAL', lastError = NULL, updatedAtEpochMs = :endedAt
        WHERE clientSessionId = :id AND status = 'ACTIVE'
        """,
    )
    suspend fun markEnded(id: String, status: String, endedAt: Long): Int

    @Transaction
    suspend fun completeActiveAndStart(
        activeId: String,
        next: LocalSurveySessionEntity,
        now: Long,
    ): LocalSurveySessionEntity? {
        if (markEnded(activeId, LocalSurveySessionEntity.STATUS_COMPLETED, now) != 1) {
            return null
        }
        insert(next)
        return next
    }

    @Query(
        """
        UPDATE local_survey_sessions SET serverPublicId = COALESCE(serverPublicId, :serverPublicId),
            syncState = :syncState, lastError = :lastError, updatedAtEpochMs = :now
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
