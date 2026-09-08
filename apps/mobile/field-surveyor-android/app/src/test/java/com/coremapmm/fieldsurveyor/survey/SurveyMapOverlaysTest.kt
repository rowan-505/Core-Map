package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveyMapOverlaysTest {
    @Test
    fun routeFitIncludesPathAndStops() {
        val path = listOf(96.15 to 16.78, 96.20 to 16.85)
        val stops = listOf(
            OrderedStopRow(1, "a", "A", null, null, 16.90, 96.10),
        )

        val points = SurveyMapOverlays.routeFitLatLngs(path, stops)

        assertEquals(3, points.size)
        assertEquals(16.78, points[0].latitude, 0.000001)
        assertEquals(96.15, points[0].longitude, 0.000001)
        assertEquals(16.90, points[2].latitude, 0.000001)
        assertEquals(96.10, points[2].longitude, 0.000001)
        assertTrue(points.minOf { it.latitude } <= 16.78)
        assertTrue(points.maxOf { it.latitude } >= 16.90)
    }

    @Test
    fun routeFitWorksWithStopsOnly() {
        val stops = listOf(
            OrderedStopRow(1, "a", null, null, null, 16.8, 96.1),
        )
        assertEquals(1, SurveyMapOverlays.routeFitLatLngs(emptyList(), stops).size)
        assertTrue(SurveyMapOverlays.routeFitLatLngs(emptyList(), emptyList()).isEmpty())
    }

    @Test
    fun anomaliesAreGpsPointMarkersNotPhotos() {
        val points = listOf(GpsFix(16.8, 96.15, 8f, 1L), GpsFix(16.81, 96.16, 8f, 2L))
        assertEquals(2, points.size)
        assertTrue(points.all { it.lat > 0 && it.lng > 0 })
    }

    @Test
    fun accuracyRingUsesAccuracyInMetres() {
        val fix = GpsFix(16.8, 96.15, 75f, 1_000L)
        val ring = SurveyMapOverlays.accuracyRing(fix)
        assertEquals(ring.first(), ring.last())
        assertEquals(49, ring.size)
        val radius = StopContext.haversineMeters(
            fix.lat,
            fix.lng,
            ring.first().second,
            ring.first().first,
        )
        assertEquals(75.0, radius, 0.25)
    }

    @Test
    fun headingChevronPointsNorthAndCloses() {
        val fix = GpsFix(16.8, 96.15, 8f, 1_000L)
        val chevron = SurveyMapOverlays.headingChevron(fix, 0.0)
        assertEquals(chevron.first(), chevron.last())
        assertEquals(4, chevron.size)
        assertTrue(chevron[0].second > fix.lat)
    }

    @Test
    fun headingChevronIsHiddenWhenHeadingMissing() {
        val fix = GpsFix(16.8, 96.15, 8f, 1_000L)
        assertTrue(SurveyMapOverlays.headingChevron(fix, 90.0).isNotEmpty())
        assertEquals(0.0, SurveyHeading.select(null, null, null, null, false).degrees, 0.0)
        assertFalse(SurveyHeading.select(null, null, null, null, false).visible)
    }
}
