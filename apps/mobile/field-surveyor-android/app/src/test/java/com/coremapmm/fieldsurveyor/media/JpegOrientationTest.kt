package com.coremapmm.fieldsurveyor.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class JpegOrientationTest {
    @Test
    fun portraitRotationSwapsToLandscapeDisplay() {
        assertTrue(JpegOrientation.swapsWidthHeight(JpegOrientation.ROTATE_90))
        assertEquals(1600 to 900, JpegOrientation.displaySize(900, 1600, JpegOrientation.ROTATE_90))
    }

    @Test
    fun landscapeRotationSwapsToPortraitDisplay() {
        assertEquals(900 to 1600, JpegOrientation.displaySize(1600, 900, JpegOrientation.ROTATE_90))
        assertEquals(900 to 1600, JpegOrientation.displaySize(1600, 900, JpegOrientation.ROTATE_270))
    }

    @Test
    fun normalKeepsCapturedAspect() {
        assertFalse(JpegOrientation.swapsWidthHeight(JpegOrientation.NORMAL))
        assertEquals(1200 to 1600, JpegOrientation.displaySize(1200, 1600, JpegOrientation.NORMAL))
        assertEquals(1600 to 900, JpegOrientation.displaySize(1600, 900, JpegOrientation.NORMAL))
    }
}
