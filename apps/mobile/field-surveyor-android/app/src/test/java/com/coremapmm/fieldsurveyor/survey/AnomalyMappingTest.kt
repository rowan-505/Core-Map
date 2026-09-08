package com.coremapmm.fieldsurveyor.survey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AnomalyMappingTest {
    @Test
    fun mapsButtonsToExistingReportTypes() {
        assertEquals("wrong_location", AnomalyMapping.reportTypeCode(AnomalyKind.MOVED))
        assertEquals("missing_item", AnomalyMapping.reportTypeCode(AnomalyKind.MISSING))
        assertEquals("wrong_info", AnomalyMapping.reportTypeCode(AnomalyKind.DATA))
        assertEquals("transport_issue", AnomalyMapping.reportTypeCode(AnomalyKind.ROUTE))
        assertEquals("other_map_issue", AnomalyMapping.reportTypeCode(AnomalyKind.OTHER))
        assertEquals("new_stop", AnomalyMapping.reportTypeCode(AnomalyKind.NEW_STOP))
    }

    @Test
    fun otherTargetsStopWhenSelectedElseVariant() {
        assertEquals("stop", AnomalyMapping.targetEntityType(AnomalyKind.OTHER, true))
        assertEquals("variant", AnomalyMapping.targetEntityType(AnomalyKind.OTHER, false))
        assertEquals("route", AnomalyMapping.targetEntityType(AnomalyKind.ROUTE, true))
        assertEquals("stop", AnomalyMapping.targetEntityType(AnomalyKind.MOVED, false))
        assertEquals("variant", AnomalyMapping.targetEntityType(AnomalyKind.NEW_STOP, true))
        assertFalse(AnomalyMapping.reportIssueKinds().contains(AnomalyKind.NEW_STOP))
        assertTrue(AnomalyMapping.reportIssueKinds().contains(AnomalyKind.MISSING))
    }
}
