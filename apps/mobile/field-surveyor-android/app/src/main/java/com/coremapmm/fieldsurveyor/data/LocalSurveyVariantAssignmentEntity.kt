package com.coremapmm.fieldsurveyor.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "local_survey_variant_assignments",
    indices = [
        Index(value = ["variantPublicId"]),
        Index(value = ["status"]),
    ],
)
data class LocalSurveyVariantAssignmentEntity(
    @PrimaryKey val publicId: String,
    val variantPublicId: String,
    val routePublicId: String?,
    val routeCode: String?,
    val variantCode: String?,
    val assignedDate: String,
    val dueDate: String?,
    val status: String,
    val workStatus: String,
    val remaining: Boolean,
    val updatedAtEpochMs: Long,
) {
    companion object {
        const val STATUS_ACTIVE = "active"
        const val WORK_NOT_STARTED = "not_started"
        const val WORK_PARTIAL = "partial"
        const val WORK_FINISHED = "finished"
    }
}
