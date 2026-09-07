package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StopContextTest {
    private val a = stop(1, "a", 16.80, 96.15)
    private val b = stop(2, "b", 16.8005, 96.1500)
    private val c = stop(3, "c", 16.8010, 96.1500)

    @Test
    fun windowUsesStopSequenceOrder() {
        val window = StopContext.window(listOf(a, b, c), "b")
        assertEquals("a", window.previous?.stopPublicId)
        assertEquals("b", window.current?.stopPublicId)
        assertEquals("c", window.next?.stopPublicId)
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
        val nearest = StopContext.nearest(listOf(a, b, c), 16.80051, 96.15001)
        assertEquals("b", nearest?.stopPublicId)
    }

    @Test
    fun nearbyReturnsThreeStopsOrderedByDistance() {
        val fourth = stop(4, "d", 16.8014, 96.1500)
        val nearby = StopContext.nearby(listOf(a, b, c, fourth), 16.80051, 96.15001)
        assertEquals(3, nearby.size)
        assertEquals(listOf("b", "c", "a"), nearby.map { it.stop.stopPublicId })
        assertTrue(nearby[0].distanceM < nearby[1].distanceM)
    }

    @Test
    fun movementReordersNearestSuggestions() {
        val beforeMove = StopContext.nearby(listOf(a, b, c), 16.8001, 96.1500)
        val afterMove = StopContext.nearby(listOf(a, b, c), 16.8009, 96.1500)

        assertEquals("a", beforeMove.first().stop.stopPublicId)
        assertEquals("c", afterMove.first().stop.stopPublicId)
        assertTrue(afterMove.zipWithNext().all { (nearer, farther) -> nearer.distanceM <= farther.distanceM })
    }

    @Test
    fun userOutsideYangonGetsNoNearbyStops() {
        val yangon = stop(1, "yangon", 16.8409, 96.1735)
        assertTrue(StopContext.nearby(listOf(yangon), 37.5665, 126.9780).isEmpty())
    }

    @Test
    fun stopThousandsOfKilometresAwayIsNeverNearby() {
        val yangon = stop(1, "yangon", 16.8409, 96.1735)
        val distance = StopContext.haversineMeters(37.5665, 126.9780, yangon.lat, yangon.lng)
        assertTrue(distance > 3_700_000.0)
        assertTrue(StopContext.nearby(listOf(yangon), 37.5665, 126.9780).isEmpty())
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
    fun validNearbyStopIsReturnedWithoutAutomaticSelection() {
        val nearby = StopContext.nearby(listOf(a), 16.8001, 96.15)
        assertEquals("a", nearby.single().stop.stopPublicId)
        assertNull(StopContext.window(listOf(a), null).current)
    }

    @Test
    fun radiusBoundaryIsInclusiveAndBeyondBoundaryIsEmpty() {
        val atBoundaryLatitude = 16.80 + Math.toDegrees(
            FieldLocationConfig.NEARBY_STOP_RADIUS_M / 6_371_000.0,
        )
        val boundary = stop(1, "boundary", atBoundaryLatitude, 96.15)
        val boundaryDistance = StopContext.haversineMeters(16.80, 96.15, boundary.lat, boundary.lng)
        assertEquals(150.0, boundaryDistance, 0.001)
        assertEquals(1, StopContext.nearby(listOf(boundary), 16.80, 96.15).size)

        val beyond = stop(2, "beyond", 16.80 + Math.toDegrees(150.1 / 6_371_000.0), 96.15)
        assertTrue(StopContext.nearby(listOf(beyond), 16.80, 96.15).isEmpty())
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
        variantPublicId: String = "",
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
