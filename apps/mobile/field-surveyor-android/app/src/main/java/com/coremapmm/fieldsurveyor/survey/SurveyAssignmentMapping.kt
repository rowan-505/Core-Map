package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.LocalSurveyVariantAssignmentEntity
import com.coremapmm.fieldsurveyor.data.transport.RouteSelectionRow

/** Pure mapping for surveyor route-variant assignments. */
object SurveyAssignmentMapping {
    fun workStatus(hasSession: Boolean, isFinished: Boolean): String = when {
        isFinished -> LocalSurveyVariantAssignmentEntity.WORK_FINISHED
        hasSession -> LocalSurveyVariantAssignmentEntity.WORK_PARTIAL
        else -> LocalSurveyVariantAssignmentEntity.WORK_NOT_STARTED
    }

    fun remaining(status: String, workStatus: String): Boolean =
        status == LocalSurveyVariantAssignmentEntity.STATUS_ACTIVE &&
            workStatus != LocalSurveyVariantAssignmentEntity.WORK_FINISHED

    fun badge(workStatus: String?): String? = when (workStatus) {
        LocalSurveyVariantAssignmentEntity.WORK_FINISHED -> "Finished"
        LocalSurveyVariantAssignmentEntity.WORK_PARTIAL -> "Partial"
        LocalSurveyVariantAssignmentEntity.WORK_NOT_STARTED -> "Assigned"
        else -> null
    }

    fun sortKey(assigned: Boolean, workStatus: String?): Int = when {
        !assigned -> 100
        workStatus == LocalSurveyVariantAssignmentEntity.WORK_NOT_STARTED -> 0
        workStatus == LocalSurveyVariantAssignmentEntity.WORK_PARTIAL -> 1
        workStatus == LocalSurveyVariantAssignmentEntity.WORK_FINISHED -> 2
        else -> 3
    }

    fun sortRoutes(
        rows: List<RouteSelectionRow>,
        assignmentByVariant: Map<String, String>,
    ): List<RouteSelectionRow> =
        rows.sortedWith(
            compareBy<RouteSelectionRow> {
                sortKey(assignmentByVariant.containsKey(it.variantPublicId), assignmentByVariant[it.variantPublicId])
            }.thenBy { it.routeCode }.thenBy { it.variantCode },
        )

    fun workStatusMap(rows: List<LocalSurveyVariantAssignmentEntity>): Map<String, String> =
        rows.filter { it.status == LocalSurveyVariantAssignmentEntity.STATUS_ACTIVE }
            .associate { it.variantPublicId to it.workStatus }
}
