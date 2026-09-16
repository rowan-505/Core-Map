package com.coremapmm.fieldsurveyor.survey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveySessionClassifyTest {
    @Test
    fun shortEmptyOnlyWhenCompletedIdleUnderOneMinute() {
        assertTrue(
            SurveySessionClassify.isShortEmptySession(
                status = "COMPLETED",
                activeDurationSeconds = 9,
                checkedStopCount = 0,
                reportCount = 0,
                finishedAtEpochMs = null,
                reopenedAtEpochMs = null,
            ),
        )
        assertFalse(
            SurveySessionClassify.isShortEmptySession(
                status = "COMPLETED",
                activeDurationSeconds = 9,
                checkedStopCount = 0,
                reportCount = 1,
                finishedAtEpochMs = null,
                reopenedAtEpochMs = null,
            ),
        )
        assertFalse(
            SurveySessionClassify.isShortEmptySession(
                status = "ACTIVE",
                activeDurationSeconds = 5,
                checkedStopCount = 0,
                reportCount = 0,
                finishedAtEpochMs = null,
                reopenedAtEpochMs = null,
            ),
        )
    }

    @Test
    fun labelsAvoidMisleadingZeros() {
        assertEquals("—", SurveySessionClassify.formatCheckedLabel(0, 0))
        assertEquals("12 / 114", SurveySessionClassify.formatCheckedLabel(12, 114))
        assertEquals("No reports", SurveySessionClassify.formatReportLabel(0))
        assertEquals("1 report", SurveySessionClassify.formatReportLabel(1))
        assertEquals("1m", SurveySessionClassify.formatActiveDuration(60))
    }
}
