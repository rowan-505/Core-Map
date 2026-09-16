package com.coremapmm.fieldsurveyor.survey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveySessionOpsTest {
    @Test
    fun zeroReportFinishStopsTrackingAndIsIdempotent() {
        val first = SurveySessionOps.applyFinish(
            trackingState = SurveySessionOps.TRACKING_ACTIVE,
            completionStatus = SurveySessionOps.COMPLETION_PARTIAL,
            nowMs = 10_000L,
            accumulatedSeconds = 5,
            segmentStartedAtMs = 5_000L,
        )
        assertTrue(first.changed)
        assertTrue(first.stopTracking)
        assertEquals(SurveySessionOps.TRACKING_IDLE, first.trackingState)
        assertEquals(SurveySessionOps.COMPLETION_FINISHED, first.completionStatus)
        assertEquals(10, first.accumulatedActiveSeconds)

        val retry = SurveySessionOps.applyFinish(
            trackingState = SurveySessionOps.TRACKING_IDLE,
            completionStatus = SurveySessionOps.COMPLETION_FINISHED,
            nowMs = 20_000L,
            accumulatedSeconds = 10,
            segmentStartedAtMs = null,
        )
        assertFalse(retry.changed)
        assertFalse(retry.stopTracking)
        assertEquals(SurveySessionOps.COMPLETION_FINISHED, retry.completionStatus)
    }

    @Test
    fun reopenDoesNotRestartGps() {
        val result = SurveySessionOps.applyReopen(SurveySessionOps.COMPLETION_FINISHED, 30_000L)
        assertTrue(result.changed)
        assertFalse(result.restartGps)
        assertEquals(SurveySessionOps.COMPLETION_PARTIAL, result.completionStatus)
        assertEquals(SurveySessionOps.TRACKING_IDLE, result.trackingState)

        val idempotent = SurveySessionOps.applyReopen(SurveySessionOps.COMPLETION_PARTIAL, 40_000L)
        assertFalse(idempotent.changed)
    }

    @Test
    fun heartbeatThrottleIsSixtySeconds() {
        assertTrue(SurveySessionOps.shouldHeartbeat(null, 1_000L))
        assertFalse(SurveySessionOps.shouldHeartbeat(1_000L, 30_000L))
        assertTrue(SurveySessionOps.shouldHeartbeat(1_000L, 61_000L))
    }

    @Test
    fun d0AndD1CompletionRemainIndependent() {
        val d0 = SurveySessionOps.applyFinish(
            trackingState = SurveySessionOps.TRACKING_IDLE,
            completionStatus = SurveySessionOps.COMPLETION_PARTIAL,
            nowMs = 1L,
            accumulatedSeconds = 0,
            segmentStartedAtMs = null,
        )
        val d1 = SurveySessionOps.COMPLETION_PARTIAL
        assertEquals(SurveySessionOps.COMPLETION_FINISHED, d0.completionStatus)
        assertEquals(SurveySessionOps.COMPLETION_PARTIAL, d1)
    }
}
