package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.LocalSurveyVariantAssignmentEntity
import com.coremapmm.fieldsurveyor.data.transport.RouteSelectionRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveyAssignmentMappingTest {
    @Test
    fun workStatusRules() {
        assertEquals(
            LocalSurveyVariantAssignmentEntity.WORK_NOT_STARTED,
            SurveyAssignmentMapping.workStatus(hasSession = false, isFinished = false),
        )
        assertEquals(
            LocalSurveyVariantAssignmentEntity.WORK_PARTIAL,
            SurveyAssignmentMapping.workStatus(hasSession = true, isFinished = false),
        )
        assertEquals(
            LocalSurveyVariantAssignmentEntity.WORK_FINISHED,
            SurveyAssignmentMapping.workStatus(hasSession = true, isFinished = true),
        )
        assertTrue(
            SurveyAssignmentMapping.remaining(
                LocalSurveyVariantAssignmentEntity.STATUS_ACTIVE,
                LocalSurveyVariantAssignmentEntity.WORK_PARTIAL,
            ),
        )
        assertFalse(
            SurveyAssignmentMapping.remaining(
                LocalSurveyVariantAssignmentEntity.STATUS_ACTIVE,
                LocalSurveyVariantAssignmentEntity.WORK_FINISHED,
            ),
        )
    }

    @Test
    fun badges() {
        assertEquals("Assigned", SurveyAssignmentMapping.badge(LocalSurveyVariantAssignmentEntity.WORK_NOT_STARTED))
        assertEquals("Partial", SurveyAssignmentMapping.badge(LocalSurveyVariantAssignmentEntity.WORK_PARTIAL))
        assertEquals("Finished", SurveyAssignmentMapping.badge(LocalSurveyVariantAssignmentEntity.WORK_FINISHED))
    }

    @Test
    fun sortAssignedFirstByWorkStatus() {
        val rows = listOf(
            row("YBS-20", "D0", "v-20"),
            row("YBS-13", "D1", "v-13-d1"),
            row("YBS-13", "D0", "v-13-d0"),
            row("YBS-5", "D0", "v-5"),
        )
        val assignments = mapOf(
            "v-13-d1" to LocalSurveyVariantAssignmentEntity.WORK_FINISHED,
            "v-13-d0" to LocalSurveyVariantAssignmentEntity.WORK_PARTIAL,
            "v-5" to LocalSurveyVariantAssignmentEntity.WORK_NOT_STARTED,
        )
        val sorted = SurveyAssignmentMapping.sortRoutes(rows, assignments)
        assertEquals(listOf("v-5", "v-13-d0", "v-13-d1", "v-20"), sorted.map { it.variantPublicId })
    }

    private fun row(routeCode: String, variantCode: String, variantPublicId: String) =
        RouteSelectionRow(
            routePublicId = "route-$routeCode",
            routeCode = routeCode,
            variantPublicId = variantPublicId,
            variantCode = variantCode,
            originName = null,
            destinationName = null,
            stopCount = 0,
        )
}
