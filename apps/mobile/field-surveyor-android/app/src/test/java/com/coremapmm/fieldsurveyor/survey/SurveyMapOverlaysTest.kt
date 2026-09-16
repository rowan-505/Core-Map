package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveyMapOverlaysTest {
    @Test
    fun stopTapTargetIsFingerSizedAndDensityAware() {
        assertEquals(24f, SurveyMapOverlays.stopTapRadiusPx(1f), 0.001f)
        assertEquals(72f, SurveyMapOverlays.stopTapRadiusPx(3f), 0.001f)
    }

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
    fun headingArrowUsesTheGpsPointAndScreenSpaceIcon() {
        val arrow = SurveyMapOverlays.headingArrowFeature(
            GpsFix(16.8, 96.15, 8f, 1_000L),
            90.0,
        )
        assertEquals(90.0, arrow.getNumberProperty(LocationPuck.PROP_BEARING).toDouble(), 0.001)
        assertTrue(LocationPuck.HALO_DIAMETER_DP <= 48f)
    }

    @Test
    fun stopFeaturesExposeIdSequenceNameSelectionAndReportState() {
        val stops = listOf(
            OrderedStopRow(0, "stop-a", null, "ဆူးလေ", "Sule", 16.8, 96.1, "d0"),
            OrderedStopRow(1, "stop-b", null, null, null, 16.81, 96.11, "d0"),
        )
        val sequences = stops.map { it.stopSequence }
        val selected = SurveyMapOverlays.stopFeature(
            stop = stops[0],
            sequences = sequences,
            selectedStopPublicId = "stop-a",
            reportedStopIds = emptySet(),
            preferMyanmar = true,
        )
        assertEquals("stop-a", selected.getStringProperty(SurveyMapOverlays.PROP_STOP_ID))
        assertEquals("stop-a", selected.getStringProperty(SurveyMapOverlays.PROP_STOP_PUBLIC_ID))
        assertEquals(0, selected.getNumberProperty(SurveyMapOverlays.PROP_STOP_SEQUENCE).toInt())
        assertEquals("ဆူးလေ", selected.getStringProperty(SurveyMapOverlays.PROP_DISPLAY_NAME))
        assertEquals("#1 ဆူးလေ", selected.getStringProperty(SurveyMapOverlays.PROP_LABEL))
        assertEquals(1, selected.getNumberProperty(SurveyMapOverlays.PROP_SELECTED).toInt())
        assertEquals(0, selected.getNumberProperty(SurveyMapOverlays.PROP_REPORTED).toInt())

        val unnamed = SurveyMapOverlays.stopFeature(
            stop = stops[1],
            sequences = sequences,
            selectedStopPublicId = "stop-a",
            reportedStopIds = setOf("stop-b"),
            preferMyanmar = false,
        )
        assertEquals(SurveyStopStripModel.UNNAMED_STOP, unnamed.getStringProperty(SurveyMapOverlays.PROP_DISPLAY_NAME))
        assertEquals("#2 Unnamed stop", unnamed.getStringProperty(SurveyMapOverlays.PROP_LABEL))
        assertEquals(0, unnamed.getNumberProperty(SurveyMapOverlays.PROP_SELECTED).toInt())
        assertEquals(1, unnamed.getNumberProperty(SurveyMapOverlays.PROP_REPORTED).toInt())
        assertEquals("stop-b", SurveyMapOverlays.stopIdFromFeature(unnamed))
    }

    @Test
    fun stopLabelZoomsKeepSelectedVisibleEarlierThanDenseLabels() {
        assertEquals(15.0, SurveyMapOverlays.STOP_LABEL_ZOOM, 0.001)
        assertEquals(12.0, SurveyMapOverlays.SELECTED_STOP_LABEL_ZOOM, 0.001)
        assertTrue(SurveyMapOverlays.SELECTED_STOP_LABEL_ZOOM < SurveyMapOverlays.STOP_LABEL_ZOOM)
        assertEquals("#3 Sule", SurveyMapOverlays.stopLabelText("#3", "Sule"))
        assertTrue(
            SurveyMapOverlays.STOP_HIT_LAYERS.toList().containsAll(
                listOf(
                    SurveyMapOverlays.LAYER_STOPS,
                    SurveyMapOverlays.LAYER_STOP_LABELS,
                    SurveyMapOverlays.LAYER_SELECTED,
                    SurveyMapOverlays.LAYER_SELECTED_STOP_LABEL,
                ),
            ),
        )
        assertEquals("NotoSansMyanmar-Regular", SurveyMapOverlays.STOP_LABEL_FONT.first())
    }

    @Test
    fun locationLayerIdsMatchModernPuckOrder() {
        assertEquals("survey-gps-accuracy", SurveyMapOverlays.LAYER_GPS_ACCURACY)
        assertEquals("survey-gps-heading", SurveyMapOverlays.LAYER_GPS_HEADING)
        assertEquals("survey-gps", SurveyMapOverlays.LAYER_GPS)
        assertEquals("#1A73E8", LocationPuck.COREMAP_BLUE)
        assertEquals(
            listOf("survey-gps-accuracy", "survey-gps", "survey-gps-heading"),
            LocationPuck.layerOrder(),
        )
    }
}
