package com.coremapmm.fieldsurveyor.survey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationPuckTest {
    @Test
    fun screenSpaceSizeIsStableAcrossZoomBand() {
        val zooms = listOf(5.0, 8.0, 12.0, 15.0, 18.0, 20.0)
        val baseline = LocationPuck.screenMetricsAtZoom(12.0)
        zooms.forEach { zoom ->
            assertTrue(LocationPuck.isReadableAtZoom(zoom))
            val metrics = LocationPuck.screenMetricsAtZoom(zoom)
            assertEquals(baseline.circleRadiusDp, metrics.circleRadiusDp, 0.001f)
            assertEquals(baseline.glowRadiusDp, metrics.glowRadiusDp, 0.001f)
            assertEquals(baseline.arrowHeightDp, metrics.arrowHeightDp, 0.001f)
            assertEquals(baseline.arrowWidthDp, metrics.arrowWidthDp, 0.001f)
            assertEquals(baseline.totalSizeDp, metrics.totalSizeDp, 0.001f)
        }
        assertFalse(LocationPuck.usesGeographicArrowMeters())
        assertFalse(LocationPuck.hidesWithMinZoomOrOpacityRules())
    }

    @Test
    fun puckFootprintMatchesDesignBudget() {
        val metrics = LocationPuck.screenMetrics()
        assertTrue(metrics.totalSizeDp in 36f..44f)
        assertTrue(metrics.circleRadiusDp * 2f in 20f..24f)
        assertTrue(metrics.circleBorderDp in 3f..4f)
        assertTrue(metrics.arrowHeightDp in 10f..14f)
        assertTrue(metrics.arrowGapDp in 0f..2f)
    }

    @Test
    fun headingUnavailableHidesOnlyArrow() {
        assertFalse(LocationPuck.showArrow(null))
        assertFalse(LocationPuck.showArrow(Double.NaN))
        assertTrue(LocationPuck.showArrow(0.0))
        assertTrue(LocationPuck.showArrow(359.0))
        // Circle/glow remain driven by GPS presence, not heading.
        assertTrue(LocationPuck.continuesUpdatingAfterManualPan())
    }

    @Test
    fun headingUpdatesChangeMapAlignedRotate() {
        assertEquals(90.0, LocationPuck.mapAlignedIconRotateDeg(90.0), 0.001)
        assertEquals(180.0, LocationPuck.mapAlignedIconRotateDeg(180.0), 0.001)
        assertEquals(0.0, LocationPuck.mapAlignedIconRotateDeg(360.0), 0.001)
        val feature = SurveyMapOverlays.headingArrowFeature(
            GpsFix(16.8, 96.15, 8f, 1_000L),
            45.0,
        )
        assertEquals(45.0, feature.getNumberProperty(LocationPuck.PROP_BEARING).toDouble(), 0.001)
    }

    @Test
    fun cameraBearingCorrectsApparentScreenHeading() {
        // Facing geographic north while camera is rotated 90° clockwise → tip points left on screen.
        assertEquals(270.0, LocationPuck.screenHeadingDeg(0.0, 90.0), 0.001)
        assertEquals(0.0, LocationPuck.screenHeadingDeg(90.0, 90.0), 0.001)
        assertEquals(
            LocationPuck.viewportAlignedIconRotateDeg(30.0, 10.0),
            LocationPuck.screenHeadingDeg(30.0, 10.0),
            0.001,
        )
    }

    @Test
    fun crossingZeroUsesShortestCircularPath() {
        val smoothed = SurveyHeading.smooth(359.0, 1.0, alpha = 0.5)
        assertEquals(2.0, SurveyHeading.shortestDelta(359.0, 1.0), 0.001)
        assertTrue(smoothed < 10.0 || smoothed > 350.0)
        assertEquals(0.0, LocationPuck.mapAlignedIconRotateDeg(360.0), 0.001)
    }

    @Test
    fun manualPanStopsFollowButPuckKeepsUpdating() {
        assertFalse(GpsCameraFollow.followingAfterMoveStarted(GpsCameraFollow.REASON_GESTURE, true))
        assertTrue(LocationPuck.continuesUpdatingAfterManualPan())
        assertTrue(MapFollowPolicy.afterManualGesture().not())
    }

    @Test
    fun layerOrderIsAccuracyGlowCircleArrow() {
        assertEquals(
            listOf(
                SurveyMapOverlays.LAYER_GPS_ACCURACY,
                SurveyMapOverlays.LAYER_GPS_GLOW,
                SurveyMapOverlays.LAYER_GPS,
                SurveyMapOverlays.LAYER_GPS_HEADING,
            ),
            LocationPuck.layerOrderAboveAccuracy(),
        )
        assertTrue(LocationPuck.ignoresLabelCollision())
    }

    @Test
    fun arrowOffsetSitsJustAboveCircle() {
        val offset = LocationPuck.arrowIconOffsetDp()
        assertEquals(0f, offset[0], 0.001f)
        val expected = -(LocationPuck.CIRCLE_DIAMETER_DP / 2f + LocationPuck.ARROW_GAP_DP)
        assertEquals(expected, offset[1], 0.001f)
    }

    @Test
    fun gpsBearingPreferredWhileMovingCompassWhenSlow() {
        val moving = SurveyHeading.select(4.0, 90f, 10f, 10f, true)
        assertEquals(HeadingSource.LOCATION_BEARING, moving.source)
        assertTrue(moving.visible)
        val slow = SurveyHeading.select(0.2, 90f, 10f, 200f, true)
        assertEquals(HeadingSource.COMPASS, slow.source)
        assertTrue(LocationPuck.showArrow(slow.degrees))
        val none = SurveyHeading.select(null, null, null, null, false)
        assertFalse(LocationPuck.showArrow(if (none.visible) none.degrees else null))
    }

    @Test
    fun arrowBitmapHasPositiveScreenPixels() {
        // Smoke-check bitmap geometry without relying on Style (unit test stubs Bitmap).
        val density = 2f
        val metrics = LocationPuck.screenMetrics()
        val expectedW = ((metrics.arrowWidthDp + LocationPuck.ARROW_OUTLINE_DP * 2f) * density).toInt()
        val expectedH = ((metrics.arrowHeightDp + LocationPuck.ARROW_OUTLINE_DP * 2f) * density).toInt()
        assertTrue(expectedW >= 8)
        assertTrue(expectedH >= 8)
        assertNotNull(LocationPuck.IMAGE_ARROW)
    }
}
