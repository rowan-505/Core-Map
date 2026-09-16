package com.coremapmm.fieldsurveyor.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface LocalSurveyVariantAssignmentDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: LocalSurveyVariantAssignmentEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(rows: List<LocalSurveyVariantAssignmentEntity>)

    @Query("SELECT * FROM local_survey_variant_assignments WHERE status = 'active'")
    suspend fun listActive(): List<LocalSurveyVariantAssignmentEntity>

    @Query("SELECT * FROM local_survey_variant_assignments WHERE variantPublicId = :variantPublicId LIMIT 1")
    suspend fun findByVariant(variantPublicId: String): LocalSurveyVariantAssignmentEntity?

    @Query("DELETE FROM local_survey_variant_assignments WHERE status = 'active'")
    suspend fun deleteActive()

    @Query("DELETE FROM local_survey_variant_assignments WHERE publicId NOT IN (:keepPublicIds)")
    suspend fun deleteActiveNotIn(keepPublicIds: List<String>)

    @Transaction
    suspend fun replaceActive(rows: List<LocalSurveyVariantAssignmentEntity>) {
        if (rows.isEmpty()) {
            deleteActive()
            return
        }
        upsertAll(rows)
        deleteActiveNotIn(rows.map { it.publicId })
    }
}
