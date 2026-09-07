package com.coremapmm.fieldsurveyor.media

import org.junit.Assert.assertEquals
import org.junit.Test

class JpegTargetTest {
    @Test
    fun doesNotUpscaleSmallImages() {
        assertEquals(800 to 600, JpegTarget.outputSize(800, 600))
    }

    @Test
    fun downscalesLongestEdgeTo2048() {
        assertEquals(2048 to 1536, JpegTarget.outputSize(3200, 2400))
        assertEquals(1152 to 2048, JpegTarget.outputSize(1800, 3200))
    }

    @Test
    fun keepsAlreadyInRangeIncluding1600To2048() {
        assertEquals(1600 to 900, JpegTarget.outputSize(1600, 900))
        assertEquals(1800 to 1200, JpegTarget.outputSize(1800, 1200))
        assertEquals(2048 to 1152, JpegTarget.outputSize(2048, 1152))
    }

    @Test
    fun sampleSizeJumpsByPowersOfTwo() {
        assertEquals(1, JpegTarget.inSampleSize(2048, 1536))
        assertEquals(2, JpegTarget.inSampleSize(5000, 3000))
    }
}
