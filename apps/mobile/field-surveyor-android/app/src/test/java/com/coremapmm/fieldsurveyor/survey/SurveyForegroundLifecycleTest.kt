package com.coremapmm.fieldsurveyor.survey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveyForegroundLifecycleTest {
    @Test
    fun startingAndFinishingSurveyStartsAndStopsServiceOnce() {
        var starts = 0
        var stops = 0
        val coordinator = SurveyForegroundCoordinator(
            initiallyRequested = false,
            startService = { starts += 1; true },
            stopService = { stops += 1 },
        )

        assertTrue(coordinator.start())
        coordinator.stop()

        assertEquals(1, starts)
        assertEquals(1, stops)
    }

    @Test
    fun repeatedStartSurveyCallsAreIdempotent() {
        var starts = 0
        val coordinator = SurveyForegroundCoordinator(false, { starts += 1; true }, {})

        assertTrue(coordinator.start())
        assertTrue(coordinator.start())

        assertEquals(1, starts)
        assertEquals(
            SurveyStartDecision.ALREADY_ACTIVE,
            SurveyRuntimePolicy.visibleStart(true, true, true, true),
        )
    }

    @Test
    fun processRecreationRestoresAnActiveSurvey() {
        assertEquals(
            SurveyStartDecision.START,
            SurveyRuntimePolicy.restore(true, true, true, true),
        )

        var stops = 0
        val restoredCoordinator = SurveyForegroundCoordinator(true, { false }, { stops += 1 })
        restoredCoordinator.stop()
        assertEquals(1, stops)
    }

    @Test
    fun permissionLossStopsSurveySafely() {
        assertTrue(SurveyRuntimePolicy.failureStopsSurvey(TrackingFailure.PERMISSION_REVOKED))
        assertEquals(
            SurveyStartDecision.NO_PERMISSION,
            SurveyRuntimePolicy.restore(true, true, false, true),
        )
    }

    @Test
    fun disabledLocationIsRejectedAtStartButRetainedDuringRestore() {
        assertEquals(
            SurveyStartDecision.LOCATION_DISABLED,
            SurveyRuntimePolicy.visibleStart(false, true, true, false),
        )
        assertEquals(
            SurveyStartDecision.LOCATION_DISABLED,
            SurveyRuntimePolicy.restore(true, true, true, false),
        )
        assertFalse(SurveyRuntimePolicy.failureStopsSurvey(TrackingFailure.LOCATION_DISABLED))
    }

    @Test
    fun notificationStopActionMapsToSafeStopCommand() {
        assertEquals(
            SurveyForegroundService.Command.STOP,
            SurveyForegroundService.commandFor(SurveyForegroundService.ACTION_STOP),
        )
        assertEquals(
            SurveyForegroundService.Command.START_OR_RESTORE,
            SurveyForegroundService.commandFor(SurveyForegroundService.ACTION_START),
        )
    }

    @Test
    fun fieldLocationConfigurationMatchesSurveyRequirements() {
        assertEquals(4_000L, FieldLocationConfig.TRACKING_INTERVAL_MS)
        assertEquals(2_000L, FieldLocationConfig.TRACKING_MIN_INTERVAL_MS)
        assertEquals(5f, FieldLocationConfig.TRACKING_MIN_DISPLACEMENT_M)
        assertEquals(12_000L, FieldLocationConfig.GOOD_FIX_STALE_MS)
    }
}
