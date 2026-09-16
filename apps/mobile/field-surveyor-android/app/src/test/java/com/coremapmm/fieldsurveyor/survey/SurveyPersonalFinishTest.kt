package com.coremapmm.fieldsurveyor.survey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveyPersonalFinishTest {
    @Test
    fun activeTrackingFinishStopsGps() {
        assertTrue(SurveyPersonalFinish.shouldStopTracking(finished = true, trackingActive = true))
    }

    @Test
    fun finishWhileIdleDoesNotStopAgain() {
        assertFalse(SurveyPersonalFinish.shouldStopTracking(finished = true, trackingActive = false))
    }

    @Test
    fun reopenReturnsPartialWithoutGpsRestart() {
        val put = SurveyVariantCompletionMapping.applyLocalPut(
            existingFinished = true,
            finished = false,
            nowMs = 100L,
            previousFinishedAt = 50L,
        )
        assertFalse(put.isFinished)
        assertNull(put.finishedAtEpochMs)
        assertTrue(put.changed)
        assertFalse(SurveyPersonalFinish.shouldRestartGps(finished = false))
        assertFalse(SurveyPersonalFinish.shouldStopTracking(finished = false, trackingActive = false))
        assertEquals("Partial", SurveyVariantCompletionMapping.badge(false))
    }

    @Test
    fun offlineFinishQueuedExactlyOnceOnDuplicate() {
        val first = SurveyVariantCompletionMapping.applyLocalPut(
            existingFinished = null,
            finished = true,
            nowMs = 10L,
            previousFinishedAt = null,
        )
        assertTrue(SurveyPersonalFinish.shouldEnqueue(first.changed))

        val duplicate = SurveyVariantCompletionMapping.applyLocalPut(
            existingFinished = true,
            finished = true,
            nowMs = 20L,
            previousFinishedAt = 10L,
        )
        assertFalse(duplicate.changed)
        assertFalse(SurveyPersonalFinish.shouldEnqueue(duplicate.changed))
        assertFalse(
            SurveyPersonalFinish.shouldStopTracking(finished = true, trackingActive = false),
        )
    }

    @Test
    fun duplicateFinishWhileStillTrackingStillStopsGpsWithoutRequeue() {
        val duplicate = SurveyVariantCompletionMapping.applyLocalPut(
            existingFinished = true,
            finished = true,
            nowMs = 20L,
            previousFinishedAt = 10L,
        )
        assertFalse(SurveyPersonalFinish.shouldEnqueue(duplicate.changed))
        assertTrue(SurveyPersonalFinish.shouldStopTracking(finished = true, trackingActive = true))
    }

    @Test
    fun d0AndD1CompletionRemainIndependent() {
        val map = SurveyVariantCompletionMapping.finishedMap(
            listOf("variant-d0" to true, "variant-d1" to false),
        )
        assertEquals(true, map["variant-d0"])
        assertEquals(false, map["variant-d1"])
        assertEquals("Finished", SurveyVariantCompletionMapping.badge(map["variant-d0"]))
        assertEquals("Partial", SurveyVariantCompletionMapping.badge(map["variant-d1"]))
    }

    @Test
    fun keepScreenOnOnlyWhileTrackingActive() {
        assertTrue(SurveyKeepScreenOn.enabled(trackingActive = true))
        assertFalse(SurveyKeepScreenOn.enabled(trackingActive = false))
    }
}
