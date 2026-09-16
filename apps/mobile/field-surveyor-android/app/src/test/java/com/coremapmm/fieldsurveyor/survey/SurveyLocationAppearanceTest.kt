package com.coremapmm.fieldsurveyor.survey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Compact fixed-size self-location puck appearance and heading behavior. */
class SurveyLocationAppearanceTest {
    @Test
    fun bluePuckUsesCompactVisualConstants() {
        assertEquals("#1A73E8", LocationPuck.COREMAP_BLUE)
        assertEquals(14f, LocationPuck.DOT_DIAMETER_DP, 0.001f)
        assertEquals(2.5f, LocationPuck.DOT_BORDER_DP, 0.001f)
        assertEquals(46f, LocationPuck.HALO_DIAMETER_DP, 0.001f)
    }

    @Test
    fun headingArrowIsAPropertyOnTheGpsPoint() {
        val gps = GpsFix(16.8, 96.15, 8f, 1_000L)
        val feature = SurveyMapOverlays.headingArrowFeature(gps, 725.0)
        assertEquals(5.0, feature.getNumberProperty(LocationPuck.PROP_BEARING).toDouble(), 0.001)
    }

    @Test
    fun headingUnavailableClearsArrowOnly() {
        assertFalse(LocationPuck.showArrow(null))
        assertFalse(LocationPuck.showArrow(Double.NaN))
        assertTrue(LocationPuck.showArrow(90.0))
    }

    @Test
    fun layerOrderIsHaloDotThenHeading() {
        assertEquals(
            listOf(
                SurveyMapOverlays.LAYER_GPS_ACCURACY,
                SurveyMapOverlays.LAYER_GPS,
                SurveyMapOverlays.LAYER_GPS_HEADING,
            ),
            LocationPuck.layerOrder(),
        )
    }

    @Test
    fun gpsBearingPreferredWhileMovingCompassWhenSlow() {
        val moving = SurveyHeading.select(4.0, 90f, 10f, 10f, true)
        assertEquals(HeadingSource.LOCATION_BEARING, moving.source)
        assertTrue(moving.visible)
        val slow = SurveyHeading.select(0.2, 90f, 10f, 200f, true)
        assertEquals(HeadingSource.COMPASS, slow.source)
        assertTrue(slow.visible)
    }

    @Test
    fun manualPanStopsFollowButLocationKeepsUpdating() {
        assertFalse(GpsCameraFollow.followingAfterMoveStarted(GpsCameraFollow.REASON_GESTURE, true))
        assertTrue(MapFollowPolicy.afterManualGesture().not())
    }
}
