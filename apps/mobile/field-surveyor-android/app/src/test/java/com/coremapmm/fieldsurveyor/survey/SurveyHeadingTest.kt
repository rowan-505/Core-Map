package com.coremapmm.fieldsurveyor.survey

import android.hardware.SensorManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveyHeadingTest {
    @Test
    fun bearingNormalizationWrapsToZeroThreeSixty() {
        assertEquals(0.0, SurveyHeading.normalize(360.0), 0.001)
        assertEquals(1.0, SurveyHeading.normalize(361.0), 0.001)
        assertEquals(359.0, SurveyHeading.normalize(-1.0), 0.001)
        assertEquals(10.0, SurveyHeading.normalize(-350.0), 0.001)
    }

    @Test
    fun circularSmoothingCrossesZeroWithoutSpinning() {
        val smoothed = SurveyHeading.smooth(359.0, 1.0, alpha = 0.5)
        assertTrue(smoothed < 10.0 || smoothed > 350.0)
        assertEquals(2.0, SurveyHeading.shortestDelta(359.0, 1.0), 0.001)
        assertEquals(-2.0, SurveyHeading.shortestDelta(1.0, 359.0), 0.001)
        val stepped = SurveyHeading.smooth(350.0, 10.0, 0.5)
        assertTrue(stepped > 350.0 || stepped < 20.0)
    }

    @Test
    fun movingUsesLocationBearingNotCompass() {
        val sample = SurveyHeading.select(
            speedMps = 4.0,
            locationBearingDeg = 90f,
            locationBearingAccuracyDeg = 12f,
            compassHeadingDeg = 10f,
            compassUsable = true,
        )
        assertEquals(HeadingSource.LOCATION_BEARING, sample.source)
        assertEquals(90.0, sample.degrees, 0.01)
        assertTrue(sample.visible)
    }

    @Test
    fun poorLocationBearingWhileMovingUsesCompass() {
        val sample = SurveyHeading.select(
            speedMps = 5.0,
            locationBearingDeg = 90f,
            locationBearingAccuracyDeg = 80f,
            compassHeadingDeg = 12f,
            compassUsable = true,
        )
        assertEquals(HeadingSource.COMPASS, sample.source)
        assertEquals(12.0, sample.degrees, 0.01)
    }

    @Test
    fun stationaryUsesCompassNotPhoneAsRouteDirection() {
        val sample = SurveyHeading.select(
            speedMps = 0.1,
            locationBearingDeg = 90f,
            locationBearingAccuracyDeg = 12f,
            compassHeadingDeg = 200f,
            compassUsable = true,
        )
        assertEquals(HeadingSource.COMPASS, sample.source)
        assertEquals(200.0, sample.degrees, 0.01)
        assertTrue(sample.visible)
    }

    @Test
    fun unavailableHeadingIsHidden() {
        val sample = SurveyHeading.select(
            speedMps = null,
            locationBearingDeg = null,
            locationBearingAccuracyDeg = null,
            compassHeadingDeg = null,
            compassUsable = false,
        )
        assertEquals(HeadingSource.NONE, sample.source)
        assertFalse(sample.visible)
    }

    @Test
    fun manualPanExitsFollow() {
        assertFalse(GpsCameraFollow.followingAfterMoveStarted(GpsCameraFollow.REASON_GESTURE, true))
        assertFalse(MapFollowPolicy.afterManualGesture())
    }

    @Test
    fun controlRestoresSelectedFollowMode() {
        assertEquals(MapFollowMode.DIRECTION, MapFollowPolicy.restore(MapFollowMode.DIRECTION))
        assertEquals(MapFollowMode.LOCATE, MapFollowPolicy.restore(MapFollowMode.LOCATE))
        assertTrue(MapFollowPolicy.cameraNorthUp(MapFollowMode.LOCATE))
        assertTrue(MapFollowPolicy.cameraHeadingUp(MapFollowMode.DIRECTION, true))
        assertFalse(MapFollowPolicy.cameraHeadingUp(MapFollowMode.DIRECTION, false))
    }

    @Test
    fun recompositionDoesNotRecreateSensorListeners() {
        assertFalse(
            HeadingListenerLifecycle.shouldRecreate(
                HeadingListenerLifecycle.STABLE_KEY,
                HeadingListenerLifecycle.STABLE_KEY,
            ),
        )
        assertTrue(HeadingListenerLifecycle.shouldRecreate(null, HeadingListenerLifecycle.STABLE_KEY))
    }

    @Test
    fun cameraThrottleIgnoresHalfSecondJitter() {
        val start = GpsFix(16.80, 96.15, 5f, 1_000L)
        val nearby = GpsFix(16.80002, 96.15002, 5f, 1_500L)
        assertFalse(
            MapCameraThrottle.shouldApply(
                following = true,
                focusOnUser = false,
                previous = start,
                next = nearby,
                previousHeadingDeg = 10.0,
                nextHeadingDeg = 12.0,
                lastAppliedAtMs = 1_000L,
                nowMs = 1_500L,
                headingUp = true,
            ),
        )
        val walked = GpsFix(16.8002, 96.15, 5f, 2_000L)
        assertTrue(
            MapCameraThrottle.shouldApply(
                following = true,
                focusOnUser = false,
                previous = start,
                next = walked,
                previousHeadingDeg = 10.0,
                nextHeadingDeg = 12.0,
                lastAppliedAtMs = 1_000L,
                nowMs = 2_000L,
                headingUp = false,
            ),
        )
    }

    @Test
    fun rotationVectorAccuracyHidesUnreliableHeading() {
        assertTrue(RotationVectorHeadingSource.accuracyUsable(SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM))
        assertTrue(RotationVectorHeadingSource.accuracyUsable(SensorManager.SENSOR_STATUS_ACCURACY_LOW))
        assertFalse(RotationVectorHeadingSource.accuracyUsable(SensorManager.SENSOR_STATUS_UNRELIABLE))
        assertFalse(RotationVectorHeadingSource.accuracyUsable(SensorManager.SENSOR_STATUS_NO_CONTACT))
    }
}
