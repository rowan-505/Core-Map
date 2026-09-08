package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NewStopReportFlowTest {
    private val gps = GpsFix(16.801, 96.151, 75f, 1_000L)
    private val previous = OrderedStopRow(4, "stop-1", "S4", null, "Corner", 16.8, 96.15)
    private val stops = listOf(
        previous,
        OrderedStopRow(5, "stop-2", "S5", null, "Next", 16.81, 96.16),
    )

    @Test
    fun gpsLocationBecomesProposedGeometryWithoutBlockingOnWeakAccuracy() {
        val draft = NewStopReportFlow.useMyLocation(NewStopReportFlow.newDraft("id-1"), gps)
        assertEquals(NewStopLocationSource.GPS, draft.locationSource)
        assertEquals(16.801, draft.proposed!!.lat, 0.0001)
        assertEquals(75f, draft.proposed!!.accuracyM)
        assertTrue(NewStopReportFlow.canSave(true, previous, NewStopReportFlow.withName(draft, "Corner stall")))
    }

    @Test
    fun mapPickRequiresExplicitModeAndIgnoresLaterTaps() {
        var draft = NewStopReportFlow.newDraft("id-1")
        draft = NewStopReportFlow.onMapTap(draft, 16.9, 96.2, 2_000L)
        assertNull(draft.proposed)
        draft = NewStopReportFlow.beginMapPick(draft)
        draft = NewStopReportFlow.onMapTap(draft, 16.9, 96.2, 2_000L)
        assertEquals(NewStopLocationSource.MAP_PICK, draft.locationSource)
        assertEquals(16.9, draft.proposed!!.lat, 0.0001)
        val ignored = NewStopReportFlow.onMapTap(draft, 17.0, 96.3, 3_000L)
        assertEquals(16.9, ignored.proposed!!.lat, 0.0001)
        assertEquals(NewStopPickMode.SELECTED, ignored.pickMode)
    }

    @Test
    fun removeClearsProposedGeometry() {
        val placed = NewStopReportFlow.onMapTap(
            NewStopReportFlow.beginMapPick(NewStopReportFlow.newDraft("id-1")),
            16.9,
            96.2,
            2_000L,
        )
        val cleared = NewStopReportFlow.removeGeometry(placed)
        assertNull(cleared.proposed)
        assertNull(cleared.locationSource)
        assertEquals(NewStopPickMode.NONE, cleared.pickMode)
    }

    @Test
    fun chooseAgainReEntersPickModeAndNextTapReplaces() {
        val first = NewStopReportFlow.onMapTap(
            NewStopReportFlow.beginMapPick(NewStopReportFlow.newDraft("id-1")),
            16.9,
            96.2,
            2_000L,
        )
        val picking = NewStopReportFlow.chooseAgain(first)
        assertEquals(NewStopPickMode.PICKING, picking.pickMode)
        assertNull(picking.proposed)
        val replaced = NewStopReportFlow.onMapTap(picking, 16.91, 96.21, 3_000L)
        assertEquals(16.91, replaced.proposed!!.lat, 0.0001)
        assertEquals(NewStopPickMode.SELECTED, replaced.pickMode)
    }

    @Test
    fun ordinaryTapsDoNotReplaceSelectedMarker() {
        val selected = NewStopReportFlow.onMapTap(
            NewStopReportFlow.beginMapPick(NewStopReportFlow.newDraft("id-1")),
            16.9,
            96.2,
            2_000L,
        )
        val ignored = NewStopReportFlow.onMapTap(selected, 16.95, 96.25, 3_000L)
        assertEquals(16.9, ignored.proposed!!.lat, 0.0001)
        assertEquals(NewStopPickMode.SELECTED, ignored.pickMode)
    }

    @Test
    fun locationSelectedLabelIncludesAccuracyWhenPresent() {
        assertEquals(
            "Location selected · ±40m",
            NewStopReportFlow.locationSelectedLabel(GpsFix(16.8, 96.1, 40f, 1L)),
        )
        assertEquals(
            "Location selected",
            NewStopReportFlow.locationSelectedLabel(GpsFix(16.8, 96.1, null, 1L)),
        )
    }

    @Test
    fun validationRequiresNamePreviousStopAndGeometry() {
        val named = NewStopReportFlow.withName(NewStopReportFlow.newDraft("id-1"), "Corner stall")
        assertNotNull(NewStopReportFlow.validationError(true, null, named))
        assertNotNull(NewStopReportFlow.validationError(true, previous, named))
        assertFalse(NewStopReportFlow.canSave(true, previous, named))
        val invalid = NewStopReportFlow.onMapTap(
            NewStopReportFlow.beginMapPick(named),
            200.0,
            96.0,
            1L,
        )
        assertNull(invalid.proposed)
        val ready = NewStopReportFlow.useMyLocation(named, gps)
        assertNull(NewStopReportFlow.validationError(true, previous, ready))
        assertTrue(NewStopReportFlow.canSave(true, previous, ready))
        assertNotNull(NewStopReportFlow.validationError(true, previous, NewStopReportFlow.withName(ready, "  ")))
    }

    @Test
    fun successBannersDependOnLocalNetworkNotUpload() {
        assertEquals("Report saved", NewStopReportFlow.successBanner(true))
        assertEquals("Saved offline", NewStopReportFlow.successBanner(false))
    }

    @Test
    fun processRecreationKeepsTheSameClientUuid() {
        val first = NewStopReportFlow.newDraft("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        val restored = NewStopReportFlow.newDraft(NewStopReportFlow.reuseDraftUuid(first.clientPublicId))
        assertEquals(first.clientPublicId, restored.clientPublicId)
        assertNotEquals(first.clientPublicId, NewStopReportFlow.reuseDraftUuid(null))
    }

    @Test
    fun processRecreationRestoresSelectedGeometryAndPickMode() {
        val selected = NewStopReportFlow.useMyLocation(
            NewStopReportFlow.withName(NewStopReportFlow.newDraft("id-restore"), "Corner"),
            GpsFix(16.801, 96.151, 12f, 1_000L),
        )
        val restored = NewStopDraft(
            clientPublicId = NewStopReportFlow.reuseDraftUuid(selected.clientPublicId),
            name = selected.name,
            note = selected.note,
            pickMode = NewStopPickMode.valueOf(selected.pickMode.name),
            proposed = selected.proposed?.let {
                GpsFix(it.lat, it.lng, it.accuracyM, it.epochMs)
            },
            locationSource = selected.locationSource,
        )
        assertEquals(selected.clientPublicId, restored.clientPublicId)
        assertEquals("Corner", restored.name)
        assertEquals(NewStopPickMode.SELECTED, restored.pickMode)
        assertEquals(16.801, restored.proposed!!.lat, 0.0001)
        assertEquals(NewStopLocationSource.GPS, restored.locationSource)
        assertTrue(NewStopReportFlow.canSave(true, previous, restored))
    }

    @Test
    fun afterRoomSuccessSelectsNextStopAndResetsDraft() {
        val after = NewStopReportFlow.afterSave(stops, "stop-1")
        assertEquals("stop-2", after.nextStopPublicId)
        assertFalse(after.endOfRoute)
        val cleared = NewStopReportFlow.newDraft()
        assertTrue(cleared.name.isEmpty())
        assertNull(cleared.proposed)
        assertNotEquals("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cleared.clientPublicId)
    }

    @Test
    fun lastStopKeepsSelectionAndShowsEndOfRoute() {
        val after = NewStopReportFlow.afterSave(stops, "stop-2")
        assertNull(after.nextStopPublicId)
        assertTrue(after.endOfRoute)
        assertEquals(NewStopReportFlow.END_OF_ROUTE, "Last stop on this direction.")
    }
}
