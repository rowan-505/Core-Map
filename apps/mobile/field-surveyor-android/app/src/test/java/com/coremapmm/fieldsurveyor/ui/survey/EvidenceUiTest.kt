package com.coremapmm.fieldsurveyor.ui.survey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EvidenceUiTest {
    @Test
    fun summaryFormatsPhotoAndVoiceWithoutDiagnostics() {
        assertEquals("1 photo · 12-sec voice", EvidenceUi.summary(1, 12_000L))
        assertEquals("2 photos · 5-sec voice", EvidenceUi.summary(2, 5_400L))
        assertEquals("1 photo", EvidenceUi.summary(1, null))
        assertEquals("3-sec voice", EvidenceUi.summary(0, 3_000L))
        assertNull(EvidenceUi.summary(0, 0L))
        assertNull(EvidenceUi.summary(0, null))
    }
}
