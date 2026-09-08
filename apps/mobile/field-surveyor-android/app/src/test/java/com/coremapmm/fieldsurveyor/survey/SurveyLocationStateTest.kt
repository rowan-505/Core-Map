package com.coremapmm.fieldsurveyor.survey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveyLocationStateTest {
    @Test
    fun everyGpsStateHasExactChipCopy() {
        assertEquals(
            SurveyLocationLabels.CHIP_ACQUIRING,
            SurveyLocationLabels.chip(SurveyLocationStatus.Acquiring, null),
        )
        assertEquals(
            "GPS ±8m",
            SurveyLocationLabels.chip(SurveyLocationStatus.Live, GpsFix(16.8, 96.1, 8f, 1L)),
        )
        assertEquals(
            "Weak GPS · ±40m",
            SurveyLocationLabels.chip(SurveyLocationStatus.Degraded, GpsFix(16.8, 96.1, 40f, 1L)),
        )
        assertEquals(
            SurveyLocationLabels.CHIP_STALE,
            SurveyLocationLabels.chip(SurveyLocationStatus.Stale, GpsFix(16.8, 96.1, 5f, 1L)),
        )
        assertEquals(
            SurveyLocationLabels.CHIP_OFF,
            SurveyLocationLabels.chip(SurveyLocationStatus.Disabled, null),
        )
        assertEquals(
            SurveyLocationLabels.CHIP_PERMISSION,
            SurveyLocationLabels.chip(SurveyLocationStatus.PermissionDenied, null),
        )
        assertEquals(
            SurveyLocationLabels.CHIP_NONE,
            SurveyLocationLabels.chip(SurveyLocationStatus.Unavailable, null),
        )
    }

    @Test
    fun noFixIsAcquiringWhileTracking() {
        val clock = FakeLocationClock(epochMs = 10_000L, elapsedRealtimeNanos = 10_000_000_000L)
        val started = SurveyLocationReducer.reduce(
            SurveyLocationSnapshot.idle(),
            SurveyLocationEvent.TrackingStarted,
            clock,
        )
        assertEquals(SurveyLocationStatus.Acquiring, started.status)
        assertNull(started.displayFix)
        assertEquals(SurveyLocationLabels.CHIP_ACQUIRING, started.chipLabel)
        assertNull(started.banner)
    }

    @Test
    fun accurateRecentFixIsLive() {
        val clock = FakeLocationClock(epochMs = 20_000L, elapsedRealtimeNanos = 20_000_000_000L)
        val live = reduceFix(clock, clock.fix(16.80, 96.15, 8f))
        assertEquals(SurveyLocationStatus.Live, live.status)
        assertEquals(clock.fix(16.80, 96.15, 8f), live.displayFix)
        assertEquals("GPS ±8m", live.chipLabel)
        assertNull(live.banner)
    }

    @Test
    fun inaccurateRecentFixIsDegradedNotUnavailable() {
        val clock = FakeLocationClock(epochMs = 20_000L, elapsedRealtimeNanos = 20_000_000_000L)
        val degraded = reduceFix(clock, clock.fix(16.80, 96.15, 40f))
        assertEquals(SurveyLocationStatus.Degraded, degraded.status)
        assertNotNull(degraded.displayFix)
        assertEquals("Weak GPS · ±40m", degraded.chipLabel)
        assertNull(degraded.banner)
        assertFalse(degraded.status == SurveyLocationStatus.Unavailable)
        assertTrue(SurveyLocationContradiction.isImpossible(degraded))
    }

    @Test
    fun oldFixIsStaleAndRemainsUsable() {
        val clock = FakeLocationClock(epochMs = 1_000L, elapsedRealtimeNanos = 1_000_000_000L)
        val withFix = reduceFix(clock, clock.fix(16.80, 96.15, 5f))
        clock.advanceMs(SurveyLocationPolicy.STALE_AGE_MS + 1L)
        val stale = SurveyLocationReducer.reduce(withFix, SurveyLocationEvent.Tick, clock)
        assertEquals(SurveyLocationStatus.Stale, stale.status)
        assertEquals(withFix.displayFix, stale.displayFix)
        assertEquals(SurveyLocationLabels.CHIP_STALE, stale.chipLabel)
        assertNull(stale.banner)
        assertEquals(stale.displayFix, SurveyLocationConsumers.mapFix(stale))
        assertEquals(stale.displayFix, SurveyLocationConsumers.formFix(stale))
        assertTrue(stale.displayFix != null)
        assertNotEquals(SurveyLocationLabels.CHIP_NONE, stale.chipLabel)
    }

    @Test
    fun providerOffWithNoFixIsDisabled() {
        val clock = FakeLocationClock()
        val disabled = SurveyLocationReducer.reduce(
            SurveyLocationSnapshot.idle(),
            SurveyLocationEvent.LocationDisabled,
            clock,
        )
        assertEquals(SurveyLocationStatus.Disabled, disabled.status)
        assertEquals(SurveyLocationLabels.CHIP_OFF, disabled.chipLabel)
        assertNull(disabled.banner)
        assertNull(disabled.displayFix)
    }

    @Test
    fun permissionDeniedWithNoFixIsPermissionDenied() {
        val clock = FakeLocationClock()
        val denied = SurveyLocationReducer.reduce(
            SurveyLocationSnapshot.idle(),
            SurveyLocationEvent.PermissionDenied,
            clock,
        )
        assertEquals(SurveyLocationStatus.PermissionDenied, denied.status)
        assertEquals(SurveyLocationLabels.CHIP_PERMISSION, denied.chipLabel)
        assertNull(denied.banner)
    }

    @Test
    fun noFixAndIdleIsUnavailable() {
        val idle = SurveyLocationSnapshot.idle()
        assertEquals(SurveyLocationStatus.Unavailable, idle.status)
        assertEquals(SurveyLocationLabels.CHIP_NONE, idle.chipLabel)
        assertNull(idle.displayFix)
        assertNull(idle.banner)
    }

    @Test
    fun neverShowsStaleAndUnavailableTogetherWhenCoordinateExists() {
        val clock = FakeLocationClock(epochMs = 1_000L, elapsedRealtimeNanos = 1_000_000_000L)
        val live = reduceFix(clock, clock.fix(16.80, 96.15, 7f))
        clock.advanceMs(SurveyLocationPolicy.STALE_AGE_MS + 50L)
        val stale = SurveyLocationReducer.reduce(live, SurveyLocationEvent.Tick, clock)
        assertEquals(SurveyLocationStatus.Stale, stale.status)
        assertNotNull(stale.displayFix)
        assertEquals(SurveyLocationLabels.CHIP_STALE, stale.chipLabel)
        assertNotEquals(SurveyLocationStatus.Unavailable, stale.status)
        assertNotEquals(SurveyLocationLabels.CHIP_NONE, stale.chipLabel)
        assertTrue(SurveyLocationContradiction.isImpossible(stale))
        assertNull(SurveyLocationLabels.banner(stale.status, stale.displayFix))
    }

    @Test
    fun singleGpsPresentationNeverDuplicatesBanner() {
        SurveyLocationStatus.entries.forEach { status ->
            val fix = if (
                status == SurveyLocationStatus.Live ||
                status == SurveyLocationStatus.Degraded ||
                status == SurveyLocationStatus.Stale
            ) {
                GpsFix(16.8, 96.1, 10f, 1L)
            } else {
                null
            }
            assertNull(SurveyLocationLabels.banner(status, fix))
            val snap = SurveyLocationLabels.snapshot(status, fix, fix)
            assertNull(snap.banner)
            assertTrue(SurveyLocationContradiction.isImpossible(snap))
        }
    }

    @Test
    fun worseFixDoesNotReplaceFreshBetterFix() {
        val clock = FakeLocationClock(epochMs = 10_000L, elapsedRealtimeNanos = 10_000_000_000L)
        val better = reduceFix(clock, clock.fix(16.80, 96.15, 4f))
        clock.advanceMs(1_000L)
        val rejected = SurveyLocationReducer.reduce(
            better,
            SurveyLocationEvent.FixReceived(clock.fix(16.80001, 96.15001, 24f)),
            clock,
        )
        assertEquals(4f, rejected.displayFix?.accuracyM)
        assertEquals(better.displayFix?.lat, rejected.displayFix?.lat)
    }

    @Test
    fun movementReplacesAnOldAccurateFix() {
        val clock = FakeLocationClock(epochMs = 10_000L, elapsedRealtimeNanos = 10_000_000_000L)
        val parked = reduceFix(clock, clock.fix(16.80, 96.15, 4f))
        clock.advanceMs(6_000L)
        val travelled = clock.fix(16.80045, 96.1500, 18f)
        val next = SurveyLocationReducer.reduce(
            parked,
            SurveyLocationEvent.FixReceived(travelled),
            clock,
        )
        assertEquals(16.80045, next.displayFix?.lat ?: 0.0, 0.000001)
        assertEquals(18f, next.displayFix?.accuracyM)
        assertEquals(next.displayFix, next.evidenceFix)
    }

    @Test
    fun mapAndFormReceiveTheSameState() {
        val clock = FakeLocationClock(epochMs = 5_000L, elapsedRealtimeNanos = 5_000_000_000L)
        val live = reduceFix(clock, clock.fix(16.81, 96.16, 6f))
        assertEquals(SurveyLocationConsumers.mapFix(live), SurveyLocationConsumers.formFix(live))
        assertEquals(live.displayFix, live.evidenceFix)
    }

    @Test
    fun contradictoryUnavailableAndStaleMessagesAreImpossible() {
        val clock = FakeLocationClock(epochMs = 1_000L, elapsedRealtimeNanos = 1_000_000_000L)
        val live = reduceFix(clock, clock.fix(16.80, 96.15, 7f))
        val afterGap = SurveyLocationReducer.reduce(
            live,
            SurveyLocationEvent.ProviderAvailable(false),
            clock,
        )
        assertNotEquals(SurveyLocationStatus.Unavailable, afterGap.status)
        assertNotEquals(SurveyLocationLabels.TEMPORARILY_UNAVAILABLE, afterGap.banner)
        assertTrue(SurveyLocationContradiction.isImpossible(afterGap))

        clock.advanceMs(SurveyLocationPolicy.STALE_AGE_MS + 50L)
        val stale = SurveyLocationReducer.reduce(
            afterGap,
            SurveyLocationEvent.ProviderAvailable(false),
            clock,
        )
        assertEquals(SurveyLocationStatus.Stale, stale.status)
        assertNotNull(stale.displayFix)
        assertNotEquals(SurveyLocationLabels.CHIP_NONE, stale.chipLabel)
        assertTrue(SurveyLocationContradiction.isImpossible(stale))
    }

    @Test
    fun evidenceDoesNotKeepOldAccurateFixAfterTravel() {
        val clock = FakeLocationClock(epochMs = 0L, elapsedRealtimeNanos = 0L)
        val buffer = ArrayDeque<GpsFix>()
        val oldAccurate = clock.fix(16.80, 96.15, 3f)
        GpsBuffer.push(buffer, oldAccurate)
        clock.advanceMs(4_000L)
        val current = clock.fix(16.8005, 96.15, 12f)
        GpsBuffer.push(buffer, current)
        val evidence = GpsBuffer.bestRecent(buffer.toList(), clock, current)
        assertEquals(current.lat, evidence?.lat)
        assertNotEquals(3f, evidence?.accuracyM)
    }

    @Test
    fun watchdogSilenceMarksStaleButKeepsTheLastCoordinate() {
        val clock = FakeLocationClock(epochMs = 20_000L, elapsedRealtimeNanos = 20_000_000_000L)
        val live = reduceFix(clock, clock.fix(16.80, 96.15, 8f))
        val silenced = SurveyLocationReducer.reduce(live, SurveyLocationEvent.WatchdogSilence, clock)
        assertEquals(SurveyLocationStatus.Stale, silenced.status)
        assertEquals(live.displayFix, silenced.displayFix)
        assertEquals(SurveyLocationLabels.CHIP_STALE, silenced.chipLabel)
        assertTrue(SurveyLocationContradiction.isImpossible(silenced))
    }

    private fun reduceFix(clock: FakeLocationClock, fix: GpsFix): SurveyLocationSnapshot {
        val tracking = SurveyLocationReducer.reduce(
            SurveyLocationSnapshot.idle(),
            SurveyLocationEvent.TrackingStarted,
            clock,
        )
        return SurveyLocationReducer.reduce(tracking, SurveyLocationEvent.FixReceived(fix), clock)
    }
}
