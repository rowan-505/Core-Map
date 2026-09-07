package com.coremapmm.fieldsurveyor.ui.survey

import org.junit.Assert.assertEquals
import org.junit.Test

class SurveyDistanceTest {
    @Test
    fun formatsNearbyAndFarStopsCompactly() {
        assertEquals("0 m", formatDistance(0.0))
        assertEquals("12 m", formatDistance(12.9))
        assertEquals("999 m", formatDistance(999.9))
        assertEquals("1.0 km", formatDistance(1_000.0))
        assertEquals("3.8 km", formatDistance(3_770.0))
        assertEquals("3770 km", formatDistance(3_770_741.0))
    }
}
