package com.coremapmm.fieldsurveyor.survey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationPuckTest {
    @Test
    fun puckUsesCompactFixedScreenMetricsAtEveryZoom() {
        val baseline = LocationPuck.screenMetricsAtZoom(5.0)
        listOf(5.0, 12.0, 16.0, 20.0).forEach { zoom ->
            assertEquals(baseline, LocationPuck.screenMetricsAtZoom(zoom))
        }
        assertTrue(baseline.dotRadiusDp * 2f in 12f..14f)
        assertTrue(baseline.dotBorderDp in 2f..3f)
        assertTrue(baseline.haloRadiusDp * 2f in 44f..48f)
        assertTrue(baseline.totalSizeDp in 28f..32f)
    }

    @Test
    fun headingArrowIsHiddenWithoutValidBearing() {
        assertFalse(LocationPuck.showArrow(null))
        assertFalse(LocationPuck.showArrow(Double.NaN))
        assertTrue(LocationPuck.showArrow(0.0))
        assertTrue(LocationPuck.showArrow(359.0))
    }

    @Test
    fun arrowBearingIsNormalizedAndSitsAboveDot() {
        assertEquals(0.0, LocationPuck.mapAlignedIconRotateDeg(360.0), 0.001)
        val offset = LocationPuck.arrowIconOffsetDp()
        assertEquals(0f, offset[0], 0.001f)
        assertEquals(-8f, offset[1], 0.001f)
    }

    @Test
    fun layerOrderKeepsDotAndArrowAboveHalo() {
        assertEquals(
            listOf(
                SurveyMapOverlays.LAYER_GPS_ACCURACY,
                SurveyMapOverlays.LAYER_GPS,
                SurveyMapOverlays.LAYER_GPS_HEADING,
            ),
            LocationPuck.layerOrder(),
        )
    }
}
