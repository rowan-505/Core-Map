package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StopContextTest {
    private val variant = "variant-d0"
    private val a = stop(1, "a", 16.80, 96.15)
    private val b = stop(2, "b", 16.8005, 96.1500)
    private val c = stop(3, "c", 16.8010, 96.1500)

    @Test
    fun firstMiddleAndFinalWindowsFollowSequence() {
        assertEquals("a", StopContext.window(listOf(a, b, c), "a").current?.stopPublicId)
        assertNull(StopContext.window(listOf(a, b, c), "a").previous)
        assertEquals("b", StopContext.window(listOf(a, b, c), "a").next?.stopPublicId)

        val middle = StopContext.window(listOf(a, b, c), "b")
        assertEquals("a", middle.previous?.stopPublicId)
        assertEquals("b", middle.current?.stopPublicId)
        assertEquals("c", middle.next?.stopPublicId)

        val last = StopContext.window(listOf(a, b, c), "c")
        assertEquals("b", last.previous?.stopPublicId)
        assertEquals("c", last.current?.stopPublicId)
        assertNull(last.next)
    }

    @Test
    fun sparseSequencesStillUseOrderedNeighbors() {
        val first = stop(1, "a", 16.80, 96.15)
        val middle = stop(7, "b", 16.8005, 96.15)
        val last = stop(20, "c", 16.8010, 96.15)
        val window = StopContext.window(listOf(last, first, middle), "b")
        assertEquals("a", window.previous?.stopPublicId)
        assertEquals("b", window.current?.stopPublicId)
        assertEquals("c", window.next?.stopPublicId)
        assertEquals(7, window.current?.stopSequence)
    }

    @Test
    fun noSelectionDoesNotAssumeCurrent() {
        val window = StopContext.window(listOf(a, b, c), null)
        assertNull(window.previous)
        assertNull(window.current)
        assertEquals("a", window.next?.stopPublicId)
    }

    @Test
    fun nearestDoesNotWriteSelection() {
        val nearest = StopContext.nearest(listOf(a, b, c), 16.80051, 96.15001, variant)
        assertEquals("b", nearest?.stopPublicId)
        assertNull(StopContext.window(listOf(a, b, c), null).current)
    }

    @Test
    fun nearbyReturnsThreeStopsOrderedByDistance() {
        val fourth = stop(4, "d", 16.8014, 96.1500)
        val nearby = StopContext.nearby(listOf(a, b, c, fourth), 16.80051, 96.15001, variant)
        assertEquals(3, nearby.size)
        assertEquals(listOf("b", "c", "a"), nearby.map { it.stop.stopPublicId })
        assertTrue(nearby[0].distanceM < nearby[1].distanceM)
    }

    @Test
    fun tinyGpsJitterDoesNotReorderNearbyStops() {
        val first = StopContext.nearby(listOf(a, b, c), 16.8001, 96.1500, variant)
        val jittered = StopContext.nearby(
            listOf(a, b, c),
            16.80011,
            96.1500,
            variant,
            previous = first,
        )
        assertEquals(first.map { it.stop.stopPublicId }, jittered.map { it.stop.stopPublicId })
    }

    @Test
    fun movementReordersNearestSuggestions() {
        val beforeMove = StopContext.nearby(listOf(a, b, c), 16.8001, 96.1500, variant)
        val afterMove = StopContext.nearby(listOf(a, b, c), 16.8009, 96.1500, variant)

        assertEquals("a", beforeMove.first().stop.stopPublicId)
        assertEquals("c", afterMove.first().stop.stopPublicId)
        assertTrue(afterMove.zipWithNext().all { (nearer, farther) -> nearer.distanceM <= farther.distanceM })
    }

    @Test
    fun wrongDirectionVariantIsExcludedEvenWhenItIsCloser() {
        val selected = stop(1, "selected", 16.8004, 96.15, "variant-a")
        val wrongDirection = stop(1, "wrong", 16.80001, 96.15, "variant-b")
        val nearby = StopContext.nearby(
            listOf(wrongDirection, selected),
            16.80,
            96.15,
            variantPublicId = "variant-a",
        )
        assertEquals(listOf("selected"), nearby.map { it.stop.stopPublicId })
    }

    @Test
    fun missingAndInvalidGeometryAreIgnored() {
        val invalid = stop(1, "bad", Double.NaN, 96.15)
        val zero = stop(2, "zero", 0.0, 0.0)
        val ok = stop(3, "ok", 16.8004, 96.15)
        val nearby = StopContext.nearby(listOf(invalid, zero, ok), 16.80, 96.15, variant)
        assertEquals(listOf("ok"), nearby.map { it.stop.stopPublicId })
    }

    @Test
    fun poorAccuracyDoesNotBlockNearbyCalculation() {
        val nearby = StopContext.nearby(listOf(a), 16.8001, 96.15, variant)
        assertEquals("a", nearby.single().stop.stopPublicId)
        assertFalse(GpsQualityPolicy.canUseForNearby(GpsFix(16.80, 96.15, 80f, 1_000L), 10_000L))
    }

    @Test
    fun selectionRemainsStableWhileNearbyOrderChanges() {
        val afterMove = StopContext.nearby(listOf(a, b, c), 16.8009, 96.1500, variant)
        assertEquals("c", afterMove.first().stop.stopPublicId)
        assertEquals("a", StopContext.window(listOf(a, b, c), "a").current?.stopPublicId)
    }

    @Test
    fun uiNeverShowsHashZeroAndKeepsStoredSequence() {
        val oneBased = listOf(a, b, c)
        assertEquals("#1", StopSequenceDisplay.uiLabel(1, oneBased.map { it.stopSequence }))
        assertEquals("#1 of 3", StopProgress.label(listOf(a, b, c), "a"))
        assertEquals("— of 3", StopProgress.label(listOf(a, b, c), null))
        assertFalse(StopProgress.label(listOf(a, b, c), null).contains("#0"))
        val zeroBased = listOf(stop(0, "z0", 16.80, 96.15), stop(1, "z1", 16.8005, 96.15))
        assertEquals("#1", StopSequenceDisplay.uiLabel(0, zeroBased.map { it.stopSequence }))
        assertEquals(0, zeroBased.first().stopSequence)
        assertEquals("#1 of 2", StopProgress.label(zeroBased, "z0"))
    }

    @Test
    fun previousCurrentNextAfterDirectionSwitchStayOnNewVariant() {
        val d0 = listOf(stop(1, "d0-a", 16.80, 96.15, "d0"), stop(2, "d0-b", 16.81, 96.16, "d0"))
        val d1 = listOf(stop(1, "d1-x", 16.82, 96.17, "d1"), stop(2, "d1-y", 16.83, 96.18, "d1"))
        val afterSwitch = StopContext.window(d1, null)
        assertNull(afterSwitch.current)
        assertEquals("d1-x", afterSwitch.next?.stopPublicId)
        assertTrue(StopContext.nearby(d0 + d1, 16.82, 96.17, "d1").all { it.stop.variantPublicId == "d1" })
        assertTrue(StopContext.window(d1, "d1-x").next?.stopPublicId == "d1-y")
    }

    @Test
    fun accessibilityLabelsRemainMeaningfulWithoutIcons() {
        val sequences = listOf(1, 2, 3)
        assertEquals("Previous, empty", com.coremapmm.fieldsurveyor.ui.survey.StopWindowDisplay.accessibilityLabel("Previous", null, sequences, null))
        assertEquals(
            "Current, #2, Sule",
            com.coremapmm.fieldsurveyor.ui.survey.StopWindowDisplay.accessibilityLabel("Current", b, sequences, "Sule"),
        )
        assertFalse(com.coremapmm.fieldsurveyor.ui.survey.StopWindowDisplay.accessibilityLabel("Current", b, sequences, "Sule").contains("#0"))
    }

    @Test
    fun userOutsideYangonGetsNoNearbyStops() {
        val yangon = stop(1, "yangon", 16.8409, 96.1735)
        assertTrue(StopContext.nearby(listOf(yangon), 37.5665, 126.9780, variant).isEmpty())
    }

    @Test
    fun radiusBoundaryIsInclusiveAndBeyondBoundaryIsEmpty() {
        val atBoundaryLatitude = 16.80 + Math.toDegrees(
            FieldLocationConfig.NEARBY_STOP_RADIUS_M / 6_371_000.0,
        )
        val boundary = stop(1, "boundary", atBoundaryLatitude, 96.15)
        assertEquals(1, StopContext.nearby(listOf(boundary), 16.80, 96.15, variant).size)
        val beyond = stop(2, "beyond", 16.80 + Math.toDegrees(150.1 / 6_371_000.0), 96.15)
        assertTrue(StopContext.nearby(listOf(beyond), 16.80, 96.15, variant).isEmpty())
    }

    @Test
    fun nearbyRecomputesOnlyAfterMeaningfulMovementOrTime() {
        val first = GpsFix(16.80, 96.15, 5f, 1_000L)
        val jitter = GpsFix(16.80001, 96.15, 5f, 2_000L)
        assertTrue(NearbyStopRefreshPolicy.shouldRecompute(null, first, 0L, 1_000L))
        assertTrue(!NearbyStopRefreshPolicy.shouldRecompute(first, jitter, 1_000L, 2_000L))
        assertTrue(NearbyStopRefreshPolicy.shouldRecompute(first, jitter, 1_000L, 11_000L))
        val moved = GpsFix(16.8001, 96.15, 5f, 3_000L)
        assertTrue(NearbyStopRefreshPolicy.shouldRecompute(first, moved, 1_000L, 3_000L))
    }

    private fun stop(
        seq: Int,
        id: String,
        lat: Double,
        lng: Double,
        variantPublicId: String = variant,
    ) = OrderedStopRow(
        stopSequence = seq,
        stopPublicId = id,
        stopCode = "S$seq",
        nameMy = null,
        nameEn = id,
        lat = lat,
        lng = lng,
        variantPublicId = variantPublicId,
    )
}
