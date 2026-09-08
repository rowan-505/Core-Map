package com.coremapmm.fieldsurveyor.survey

import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GpsTrackingTest {
    @Test
    fun startupPublishesCachedThenFreshLocation() = runBlocking {
        val cached = GpsFix(16.8000, 96.1500, 18f, 1_000L)
        val fresh = GpsFix(16.8002, 96.1502, 5f, 2_000L)
        val emitted = mutableListOf<GpsFix>()

        OneShotLocationPipeline.run(
            includeCached = true,
            timeoutMs = 100L,
            cached = { cached },
            fresh = { fresh },
            emit = emitted::add,
        )

        assertEquals(listOf(cached, fresh), emitted)
    }

    @Test
    fun startupWithoutCachePublishesFreshLocationOnly() = runBlocking {
        val fresh = GpsFix(16.8002, 96.1502, 5f, 2_000L)
        val emitted = mutableListOf<GpsFix>()

        OneShotLocationPipeline.run(true, 100L, cached = { null }, fresh = { fresh }, emit = emitted::add)

        assertEquals(listOf(fresh), emitted)
    }

    @Test
    fun unavailableAndTimedOutStartupFinishWithoutLocation() = runBlocking {
        val unavailable = mutableListOf<GpsFix>()
        OneShotLocationPipeline.run(true, 100L, cached = { null }, fresh = { null }, emit = unavailable::add)
        assertTrue(unavailable.isEmpty())

        val timedOut = mutableListOf<GpsFix>()
        OneShotLocationPipeline.run(
            includeCached = false,
            timeoutMs = 1L,
            cached = { error("cache must not be requested") },
            fresh = { delay(100L); GpsFix(1.0, 1.0, 5f, 1L) },
            emit = timedOut::add,
        )
        assertTrue(timedOut.isEmpty())
    }

    @Test
    fun startupRequestsOneShotAndOneCenter() {
        val started = LocationStateModel.startup(LocationState())
        assertEquals(LocationMode.ONE_SHOT, started.mode)
        assertFalse(started.cameraFollowEnabled)
        assertTrue(started.centerOncePending)
        assertFalse(LocationStateModel.centered(started).centerOncePending)
    }

    @Test
    fun oneShotTimeoutReturnsToIdle() {
        val timedOut = LocationStateModel.oneShotFinished(
            LocationStateModel.startup(LocationState()),
        )
        assertEquals(LocationMode.IDLE, timedOut.mode)
        assertEquals(9_000L, GpsEngine.ONE_SHOT_TIMEOUT_MS)
    }

    @Test
    fun manualPanCancelsFollowButTrackingContinues() {
        val panned = LocationStateModel.manualPan(LocationStateModel.startSurvey())
        assertEquals(LocationMode.SURVEY_TRACKING, panned.mode)
        assertFalse(panned.cameraFollowEnabled)
        assertFalse(panned.centerOncePending)
    }

    @Test
    fun locateDuringSurveyReenablesFollow() {
        val panned = LocationStateModel.manualPan(LocationStateModel.startSurvey())
        val located = LocationStateModel.locate(panned)
        assertEquals(LocationMode.SURVEY_TRACKING, located.mode)
        assertTrue(located.cameraFollowEnabled)
    }

    @Test
    fun finishingSurveyStopsTracking() {
        val finished = LocationStateModel.finishSurvey()
        assertEquals(LocationMode.IDLE, finished.mode)
        assertFalse(finished.cameraFollowEnabled)
    }

    @Test
    fun worseFreshFixIsRejectedWhileBetterFixIsValid() {
        val better = GpsFix(16.80, 96.15, 4f, 10_000L)
        val worse = GpsFix(16.800001, 96.150001, 24f, 12_000L)
        assertNull(GpsFixPolicy.publish(better, worse, 12_000L))

        val stillHeld = GpsFixPolicy.publish(
            better,
            worse.copy(epochMs = 21_000L),
            21_000L,
        )
        assertNull(stillHeld)
    }

    @Test
    fun firstFixIsPublished() {
        val next = GpsFix(16.80, 96.15, 8f, 1_000L)
        assertEquals(next, GpsFixPolicy.publish(null, next, next.epochMs))
    }

    @Test
    fun olderFixIsDropped() {
        val previous = GpsFix(16.80, 96.15, 8f, 10_000L)
        val stale = GpsFix(16.81, 96.16, 5f, 1_000L)
        assertNull(GpsFixPolicy.publish(previous, stale, 10_000L))
    }

    @Test
    fun walkingFixesArePublished() {
        var previous: GpsFix? = null
        val published = (0 until 5).mapNotNull { step ->
            val next = GpsFix(
                lat = 16.80 + (step * 0.00012),
                lng = 96.15,
                accuracyM = 6f,
                epochMs = 1_000L + (step * 1_000L),
            )
            val accepted = GpsFixPolicy.publish(previous, next, next.epochMs)
            if (accepted != null) {
                previous = accepted
            }
            accepted
        }
        assertEquals(5, published.size)
        val moved = StopContext.haversineMeters(
            published.first().lat,
            published.first().lng,
            published.last().lat,
            published.last().lng,
        )
        assertTrue(moved > 40.0)
    }

    @Test
    fun busSpeedFixesArePublishedAtTrackingCadence() {
        val start = GpsFix(16.8000, 96.1500, 7f, 1_000L)
        // About 50 metres in four seconds: 45 km/h, representative urban bus speed.
        val bus = GpsFix(16.80045, 96.1500, 7f, 5_000L)
        val accepted = GpsFixPolicy.publish(start, bus, bus.epochMs)
        assertEquals(bus, accepted)
        assertTrue(StopContext.haversineMeters(start.lat, start.lng, bus.lat, bus.lng) > 45.0)
    }

    @Test
    fun everyMeaningfulMovementRefreshesTheMapFix() {
        var displayed = GpsFix(16.800000, 96.150000, 7f, 1_000L)
        repeat(6) { step ->
            val moved = GpsFix(
                lat = 16.800000 + ((step + 1) * 0.00002),
                lng = 96.150000,
                accuracyM = 7f,
                epochMs = 2_000L + (step * 1_000L),
            )
            displayed = GpsFixPolicy.publish(displayed, moved, moved.epochMs)
                ?: displayed
        }
        assertEquals(16.800120, displayed.lat, 0.000001)
        assertEquals(7_000L, displayed.epochMs)
    }

    @Test
    fun tinyJitterIsNotPublishedUntilHeartbeat() {
        val first = GpsFix(16.80, 96.15, 8f, 1_000L)
        val jitter = GpsFix(16.800001, 96.150001, 8f, 1_400L)
        assertNull(GpsFixPolicy.publish(first, jitter, jitter.epochMs))
        val heartbeat = GpsFix(16.800001, 96.150001, 8f, 3_200L)
        assertNotNull(GpsFixPolicy.publish(first, heartbeat, heartbeat.epochMs))
    }

    @Test
    fun cachedLastKnownIsKeptAsLastKnownEvenWhenOld() {
        val cached = GpsFix(16.80, 96.15, 8f, 1_000L)
        assertEquals(cached, GpsFixPolicy.publish(null, cached, 1_000L + GpsFixPolicy.MAX_FIX_AGE_MS + 1L))
    }

    @Test
    fun poorGpsQualityWarnsAndCriticalReportRequiresConfirmation() {
        val poor = GpsFix(16.80, 96.15, 40f, 10_000L)
        val critical = poor.copy(accuracyM = 75f)
        assertEquals(GpsQuality.POOR, GpsQualityPolicy.quality(poor, 10_000L))
        assertEquals(GpsQuality.CONFIRM_REQUIRED, GpsQualityPolicy.quality(critical, 10_000L))
        assertTrue(GpsQualityPolicy.canUseForNearby(poor, 10_000L))
        assertFalse(GpsQualityPolicy.canUseForNearby(critical, 10_000L))
        assertTrue(ReportLocationPolicy.requiresPoorAccuracyConfirmation(AnomalyKind.MOVED, critical, 10_000L))
        assertFalse(ReportLocationPolicy.requiresPoorAccuracyConfirmation(AnomalyKind.DATA, critical, 10_000L))
        assertFalse(ReportLocationPolicy.requiresPoorAccuracyConfirmation(AnomalyKind.NEW_STOP, critical, 10_000L))
    }

    @Test
    fun staleFixIsExplicitAndCannotDriveNearbyResults() {
        val fix = GpsFix(16.80, 96.15, 5f, 1_000L)
        val now = 1_000L + FieldLocationConfig.GOOD_FIX_STALE_MS + 1L
        assertEquals(GpsQuality.STALE, GpsQualityPolicy.quality(fix, now))
        assertEquals("Using last location", GpsQualityPolicy.label(fix, now))
        assertFalse(GpsQualityPolicy.canUseForNearby(fix, now))
    }

    @Test
    fun followMovesCameraWhenUserWalks() {
        val start = GpsFix(16.80, 96.15, 5f, 1_000L)
        val walked = GpsFix(16.8002, 96.15, 5f, 2_000L)
        assertTrue(GpsCameraFollow.shouldMoveCamera(true, false, start, walked))
        assertFalse(GpsCameraFollow.shouldMoveCamera(false, false, start, walked))
        assertTrue(GpsCameraFollow.shouldMoveCamera(false, true, start, start))
    }

    @Test
    fun followDoesNotChaseJitter() {
        val start = GpsFix(16.80, 96.15, 5f, 1_000L)
        val jitter = GpsFix(16.800001, 96.150001, 5f, 2_000L)
        assertFalse(GpsCameraFollow.shouldMoveCamera(true, false, start, jitter))
    }

    @Test
    fun panGestureTurnsFollowOff() {
        assertFalse(GpsCameraFollow.followingAfterMoveStarted(GpsCameraFollow.REASON_GESTURE, true))
        assertTrue(GpsCameraFollow.followingAfterMoveStarted(2, true))
    }

    @Test
    fun idleAndLocateNeverEnterContinuousTracking() {
        val startup = LocationStateModel.startup(LocationState())
        val startupDone = LocationStateModel.oneShotFinished(startup)
        val locate = LocationStateModel.locate(startupDone)
        val locateDone = LocationStateModel.oneShotFinished(locate)

        assertEquals(LocationMode.ONE_SHOT, startup.mode)
        assertEquals(LocationMode.IDLE, startupDone.mode)
        assertEquals(LocationMode.ONE_SHOT, locate.mode)
        assertEquals(LocationMode.IDLE, locateDone.mode)
    }

    @Test
    fun meButtonUsesStreetZoom() {
        assertEquals(16.0, GpsCameraFollow.cameraZoom(true, 11.0), 0.01)
        assertEquals(12.0, GpsCameraFollow.cameraZoom(false, 12.0), 0.01)
    }

    @Test
    fun selectingAStopUsesAtLeastStreetZoom() {
        assertEquals(16.0, GpsCameraFollow.stopFocusZoom(11.0), 0.01)
        assertEquals(18.0, GpsCameraFollow.stopFocusZoom(18.0), 0.01)
    }
}
