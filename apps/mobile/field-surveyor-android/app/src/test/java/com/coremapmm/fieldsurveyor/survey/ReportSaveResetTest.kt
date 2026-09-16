package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReportSaveResetTest {
    private val stops = listOf(
        OrderedStopRow(1, "stop-1", "S1", null, "A", 16.8, 96.15),
        OrderedStopRow(2, "stop-2", "S2", null, "B", 16.81, 96.16),
        OrderedStopRow(3, "stop-3", "S3", null, "C", 16.82, 96.17),
    )

    @Test
    fun onlineAndOfflineLocalSuccessBannersOnly() {
        assertEquals(ReportSaveReset.REPORT_SAVED, ReportSaveReset.successBanner(true))
        assertEquals(ReportSaveReset.SAVED_OFFLINE, ReportSaveReset.successBanner(false))
        assertEquals(
            setOf("Report saved", "Saved offline — sync pending"),
            ReportSaveReset.allowedSuccessBanners(),
        )
        assertFalse(ReportSaveReset.allowedSuccessBanners().contains("✓ Captured"))
    }

    @Test
    fun nextStopSelectionAdvancesWithinVariant() {
        val after = ReportSaveReset.afterLocalSave(stops, "stop-1")
        assertEquals("stop-2", after.nextStopPublicId)
        assertFalse(after.endOfRoute)
        val mid = ReportSaveReset.afterLocalSave(stops, "stop-2")
        assertEquals("stop-3", mid.nextStopPublicId)
        assertFalse(mid.endOfRoute)
    }

    @Test
    fun finalStopKeepsSelectionWithoutInvalidNext() {
        val after = ReportSaveReset.afterLocalSave(stops, "stop-3")
        assertNull(after.nextStopPublicId)
        assertTrue(after.endOfRoute)
        assertEquals(ReportSaveReset.END_OF_ROUTE, "Last stop on this direction.")
    }

    @Test
    fun roomFailurePreservesDraftAndShowsConciseError() {
        assertFalse(ReportSaveReset.shouldClearDraftMedia(false))
        assertFalse(ReportSaveReset.shouldResetForm(false))
        assertTrue(ReportSaveReset.shouldClearDraftMedia(true))
        assertTrue(ReportSaveReset.shouldResetForm(true))
        assertEquals(
            ReportSaveReset.ROOM_SAVE_FAILED,
            ReportSaveReset.roomFailureMessage(null),
        )
        assertEquals(
            ReportSaveReset.ROOM_SAVE_FAILED,
            ReportSaveReset.roomFailureMessage(RuntimeException("Could not save report")),
        )
        assertEquals(
            ReportSaveReset.ROOM_SAVE_FAILED,
            ReportSaveReset.roomFailureMessage(
                RuntimeException("x".repeat(120)),
            ),
        )
        assertEquals(
            ReportSaveReset.ROOM_SAVE_FAILED,
            ReportSaveReset.roomFailureMessage(RuntimeException("Disk full")),
        )
    }

    @Test
    fun mapMarkerRemovalRequiresClearedPickAfterSuccess() {
        val draft = NewStopReportFlow.useMyLocation(
            NewStopReportFlow.withName(NewStopReportFlow.newDraft("id-1"), "Corner"),
            GpsFix(16.8, 96.15, 8f, 1L),
        )
        assertTrue(draft.proposed != null)
        val cleared = NewStopReportFlow.newDraft()
        assertNull(cleared.proposed)
        assertEquals(NewStopPickMode.NONE, cleared.pickMode)
        assertTrue(ReportSaveReset.shouldResetForm(true))
    }
}
