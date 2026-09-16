package com.coremapmm.fieldsurveyor.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
interface LocalSurveyVariantCompletionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: LocalSurveyVariantCompletionEntity)

    @Query("SELECT * FROM local_survey_variant_completions WHERE variantPublicId = :variantPublicId LIMIT 1")
    suspend fun findByVariant(variantPublicId: String): LocalSurveyVariantCompletionEntity?

    @Query("SELECT * FROM local_survey_variant_completions")
    suspend fun listAll(): List<LocalSurveyVariantCompletionEntity>

    @Query("SELECT * FROM local_survey_variant_completions WHERE isFinished = 1")
    suspend fun listFinished(): List<LocalSurveyVariantCompletionEntity>

    @Query("SELECT * FROM local_survey_variant_completions")
    fun observeAll(): Flow<List<LocalSurveyVariantCompletionEntity>>

    @Query(
        """
        SELECT * FROM local_survey_variant_completions
        WHERE syncState IN ('LOCAL', 'RETRY', 'SYNCING')
        ORDER BY updatedAtEpochMs ASC
        LIMIT 1
        """,
    )
    suspend fun nextEligible(): LocalSurveyVariantCompletionEntity?

    @Query(
        """
        UPDATE local_survey_variant_completions
        SET syncState = 'SYNCING', lastError = NULL, updatedAtEpochMs = :now
        WHERE variantPublicId = :variantPublicId
          AND syncState IN ('LOCAL', 'RETRY', 'SYNCING')
        """,
    )
    suspend fun markSyncing(variantPublicId: String, now: Long): Int

    @Query(
        """
        UPDATE local_survey_variant_completions
        SET syncState = :syncState, lastError = :lastError, updatedAtEpochMs = :now
        WHERE variantPublicId = :variantPublicId
        """,
    )
    suspend fun updateSync(
        variantPublicId: String,
        syncState: String,
        lastError: String?,
        now: Long,
    )

    @Transaction
    suspend fun claimNext(now: Long): LocalSurveyVariantCompletionEntity? {
        repeat(8) {
            val row = nextEligible() ?: return null
            if (markSyncing(row.variantPublicId, now) == 1) {
                return row.copy(
                    syncState = LocalSurveyVariantCompletionEntity.SYNC_SYNCING,
                    updatedAtEpochMs = now,
                )
            }
        }
        return null
    }
}
