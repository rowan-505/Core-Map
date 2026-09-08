package com.coremapmm.fieldsurveyor.survey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveyTrackingWatchdogTest {
    @Test
    fun oneActiveSubscriptionOnly() {
        assertTrue(GpsSubscriptionPolicy.shouldRegisterCallback(false))
        assertFalse(GpsSubscriptionPolicy.shouldRegisterCallback(true))
        assertTrue(GpsSubscriptionPolicy.shouldRestart(true, true))
        assertFalse(GpsSubscriptionPolicy.shouldRestart(false, true))
        assertFalse(GpsSubscriptionPolicy.shouldRestart(true, false))
    }

    @Test
    fun watchdogRequestsFreshThenRestartsOnce() {
        var state = TrackingWatchdog.started(0L)
        val early = TrackingWatchdog.onTick(state, 8_000L)
        assertEquals(TrackingWatchdogAction.NONE, early.second)

        val stale = TrackingWatchdog.onTick(state, TrackingWatchdog.SILENCE_MS)
        assertEquals(TrackingWatchdogAction.REQUEST_FRESH, stale.second)
        state = stale.first

        val tooSoon = TrackingWatchdog.onTick(state, TrackingWatchdog.SILENCE_MS + 500L)
        assertEquals(TrackingWatchdogAction.NONE, tooSoon.second)

        val restart = TrackingWatchdog.onTick(
            state,
            TrackingWatchdog.SILENCE_MS + TrackingWatchdog.FRESH_WAIT_MS,
        )
        assertEquals(TrackingWatchdogAction.RESTART_ONCE, restart.second)
        state = restart.first

        val loop = TrackingWatchdog.onTick(state, TrackingWatchdog.SILENCE_MS + 8_000L)
        assertEquals(TrackingWatchdogAction.NONE, loop.second)
    }

    @Test
    fun noRepeatedRestartLoop() {
        var state = TrackingWatchdog.started(0L)
        var restarts = 0
        var fresh = 0
        for (t in 0L..60_000L step 1_000L) {
            val (next, action) = TrackingWatchdog.onTick(state, t)
            state = next
            when (action) {
                TrackingWatchdogAction.REQUEST_FRESH -> fresh += 1
                TrackingWatchdogAction.RESTART_ONCE -> restarts += 1
                TrackingWatchdogAction.NONE -> Unit
            }
        }
        assertEquals(1, fresh)
        assertEquals(1, restarts)
    }

    @Test
    fun callbackResetsWatchdog() {
        var state = TrackingWatchdog.started(0L)
        state = TrackingWatchdog.onTick(state, TrackingWatchdog.SILENCE_MS).first
        state = TrackingWatchdog.onCallback(state, 12_000L)
        val next = TrackingWatchdog.onTick(state, 16_000L)
        assertEquals(TrackingWatchdogAction.NONE, next.second)
    }

    @Test
    fun stoppedSurveyDisablesWatchdog() {
        val stopped = TrackingWatchdog.stopped()
        val tick = TrackingWatchdog.onTick(stopped, 30_000L)
        assertEquals(TrackingWatchdogAction.NONE, tick.second)
        assertFalse(stopped.tracking)
    }

    @Test
    fun serviceBeginsAndEndsWithSurveyLifecycle() {
        var starts = 0
        var stops = 0
        val coordinator = SurveyForegroundCoordinator(false, { starts += 1; true }, { stops += 1 })
        assertTrue(coordinator.start())
        assertTrue(coordinator.start())
        coordinator.stop()
        coordinator.stop()
        assertEquals(1, starts)
        assertEquals(1, stops)
    }

    @Test
    fun screenOrActivityStopDoesNotEndActiveSubscription() {
        assertTrue(SurveyTrackingResumePolicy.keepSubscriptionWhenActivityStops(true))
        assertFalse(SurveyTrackingResumePolicy.keepSubscriptionWhenActivityStops(false))
        assertFalse(SurveyTrackingResumePolicy.abandonSurveyWhenServiceDestroyed())
    }

    @Test
    fun stoppedSurveyHasNoLocationServiceOrCallbacks() {
        val coordinator = SurveyForegroundCoordinator(true, { true }, {})
        coordinator.stop()
        assertFalse(GpsSubscriptionPolicy.shouldRegisterCallback(true))
        assertTrue(GpsSubscriptionPolicy.shouldRegisterCallback(false))
        assertFalse(TrackingWatchdog.stopped().tracking)
    }

    @Test
    fun permissionRevocationIsHandledSafely() {
        assertTrue(SurveyRuntimePolicy.failureStopsSurvey(TrackingFailure.PERMISSION_REVOKED))
        assertEquals(
            SurveyStartDecision.NO_PERMISSION,
            SurveyTrackingResumePolicy.resumeAfterSettingsOrPermission(
                surveyRunning = true,
                hasPermission = false,
                alreadyTracking = false,
            ),
        )
    }

    @Test
    fun processRecreationRestoresWithoutDuplication() {
        assertTrue(SurveyTrackingResumePolicy.restoreStartsTracking(false))
        assertFalse(SurveyTrackingResumePolicy.restoreStartsTracking(true))
        assertEquals(
            SurveyStartDecision.ALREADY_ACTIVE,
            SurveyTrackingResumePolicy.resumeAfterSettingsOrPermission(true, true, true),
        )
        assertEquals(
            SurveyStartDecision.START,
            SurveyTrackingResumePolicy.resumeAfterSettingsOrPermission(true, true, false),
        )
    }
}
