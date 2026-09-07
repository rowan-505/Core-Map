package com.coremapmm.fieldsurveyor.media

import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceTargetTest {
    @Test
    fun voiceIsCompressedMonoAndCappedAtSixtySeconds() {
        assertEquals(1, VoiceTarget.CHANNELS)
        assertEquals(16_000, VoiceTarget.SAMPLE_RATE_HZ)
        assertEquals(40_000, VoiceTarget.BITRATE)
        assertEquals(60_000, VoiceTarget.MAX_DURATION_MS)
    }
}
