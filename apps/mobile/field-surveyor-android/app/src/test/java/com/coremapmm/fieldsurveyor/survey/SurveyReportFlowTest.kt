package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveyReportFlowTest {
    private val pick = GpsFix(16.8, 96.15, 5f, 1L)

    @Test
    fun saveRequiresActiveSurvey() {
        assertNotNull(
            SurveyReportFlow.saveError(false, AnomalyKind.MISSING, true, null, "", null),
        )
    }

    @Test
    fun movedNeedsStopAndMapPick() {
        assertNotNull(SurveyReportFlow.saveError(true, AnomalyKind.MOVED, false, pick, "", null))
        assertNotNull(SurveyReportFlow.saveError(true, AnomalyKind.MOVED, true, null, "", null))
        assertNull(SurveyReportFlow.saveError(true, AnomalyKind.MOVED, true, pick, "", null))
    }

    @Test
    fun missingAndDataRequireStopAndAllowEmptyText() {
        assertNotNull(SurveyReportFlow.saveError(true, AnomalyKind.MISSING, false, null, "", null))
        assertNull(SurveyReportFlow.saveError(true, AnomalyKind.MISSING, true, null, "", null))
        assertNotNull(SurveyReportFlow.saveError(true, AnomalyKind.DATA, false, null, "note", null))
        assertNull(SurveyReportFlow.saveError(true, AnomalyKind.DATA, true, null, "", null))
    }

    @Test
    fun routeWorksWithoutStop() {
        assertTrue(!SurveyReportFlow.requiresStop(AnomalyKind.ROUTE))
        assertNotNull(SurveyReportFlow.saveError(true, AnomalyKind.ROUTE, false, null, "", null))
        assertNull(
            SurveyReportFlow.saveError(true, AnomalyKind.ROUTE, false, null, "", RouteIssueKind.PATH_WRONG),
        )
    }

    @Test
    fun otherMayBeStopOrRouteLevelWithoutText() {
        assertTrue(!SurveyReportFlow.requiresStop(AnomalyKind.OTHER))
        assertNull(SurveyReportFlow.saveError(true, AnomalyKind.OTHER, false, null, "", null))
        assertNull(SurveyReportFlow.saveError(true, AnomalyKind.OTHER, true, null, "", null))
        assertEquals("variant", AnomalyMapping.targetEntityType(AnomalyKind.OTHER, false))
        assertEquals("stop", AnomalyMapping.targetEntityType(AnomalyKind.OTHER, true))
        assertEquals("route", AnomalyMapping.targetEntityType(AnomalyKind.ROUTE, false))
    }

    @Test
    fun composedNotePrefixesRouteIssue() {
        assertEquals("path wrong · fence", SurveyReportFlow.composedNote("fence", RouteIssueKind.PATH_WRONG))
        assertEquals("missing segment", SurveyReportFlow.composedNote("", RouteIssueKind.MISSING_SEGMENT))
    }

    @Test
    fun duplicateWarningMatchesSessionTargetAndType() {
        val existing = listOf(ReportFingerprint("session-1", "wrong_location", "stop-1"))
        assertEquals(
            SurveyReportFlow.DUPLICATE_WARNING,
            SurveyReportFlow.duplicateWarning(existing, "session-1", AnomalyKind.MOVED, "stop-1", "route", "var"),
        )
        assertNull(
            SurveyReportFlow.duplicateWarning(existing, "session-1", AnomalyKind.MISSING, "stop-1", "route", "var"),
        )
        assertNull(
            SurveyReportFlow.duplicateWarning(existing, "session-2", AnomalyKind.MOVED, "stop-1", "route", "var"),
        )
        assertNull(
            SurveyReportFlow.duplicateWarning(existing, "session-1", AnomalyKind.MOVED, "stop-2", "route", "var"),
        )
    }

    @Test
    fun correctStopAdvancesLocallyAndWritesNoRecord() {
        val stops = listOf(
            OrderedStopRow(1, "a", null, null, null, 16.8, 96.15),
            OrderedStopRow(2, "b", null, null, null, 16.81, 96.16),
        )
        assertEquals("b", CorrectStopAction.nextStopPublicId(stops, "a"))
        assertNull(CorrectStopAction.nextStopPublicId(stops, "b"))
        assertFalse(AnomalyKind.entries.any { it.name == "CORRECT" })
    }

    @Test
    fun stopProgressAndCaptureFactsAreLocalOnly() {
        val stops = List(66) { i ->
            OrderedStopRow(i + 1, "s$i", null, null, null, 16.8, 96.15)
        }
        assertEquals("#2 of 66", StopProgress.label(stops, "s1"))
        val lines = SurveyCaptureFacts.lines(
            epochMs = 1_725_451_800_000L,
            gps = GpsFix(16.80012, 96.15034, 5.4f, 1L),
            routeCode = "YBS-13",
            variantCode = "D0",
            snapshotRevision = "v1-abc",
        )
        assertTrue(lines[0].startsWith("Captured "))
        assertTrue(lines[1].contains("16.80012"))
        assertTrue(lines[1].contains("±5 m"))
        assertTrue(lines[2].contains("YBS-13 · D0"))
        assertTrue(lines[2].contains("v1-abc"))
    }
}
