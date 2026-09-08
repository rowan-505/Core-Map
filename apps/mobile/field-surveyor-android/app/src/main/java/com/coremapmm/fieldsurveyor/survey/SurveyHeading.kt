package com.coremapmm.fieldsurveyor.survey

enum class HeadingSource {
    LOCATION_BEARING,
    COMPASS,
    NONE,
}

enum class MapFollowMode {
    LOCATE,
    DIRECTION,
}

data class HeadingSample(
    val degrees: Double,
    val source: HeadingSource,
    val visible: Boolean,
)

/**
 * Travel heading for the location marker. GPS bearing is used while moving.
 * Compass is used only when slow/stationary. This is not YBS D0/D1.
 */
object SurveyHeading {
    const val RELIABLE_SPEED_MPS = 1.5
    const val SMOOTH_ALPHA = 0.28

    fun normalize(degrees: Double): Double {
        var value = degrees % 360.0
        if (value < 0.0) value += 360.0
        return value
    }

    fun shortestDelta(fromDeg: Double, toDeg: Double): Double {
        var delta = normalize(toDeg) - normalize(fromDeg)
        if (delta > 180.0) delta -= 360.0
        if (delta < -180.0) delta += 360.0
        return delta
    }

    fun smooth(previousDeg: Double?, nextDeg: Double, alpha: Double = SMOOTH_ALPHA): Double {
        val next = normalize(nextDeg)
        if (previousDeg == null) return next
        return normalize(previousDeg + alpha * shortestDelta(previousDeg, next))
    }

    fun speedMps(current: GpsFix, previous: GpsFix?): Double? {
        current.speedMps?.toDouble()?.let { speed ->
            if (speed >= 0.0) return speed
        }
        if (previous == null) return null
        val dtMs = when {
            current.elapsedRealtimeNanos > 0L && previous.elapsedRealtimeNanos > 0L ->
                (current.elapsedRealtimeNanos - previous.elapsedRealtimeNanos) / 1_000_000.0
            else -> (current.epochMs - previous.epochMs).toDouble()
        }
        if (dtMs <= 80.0) return null
        val meters = StopContext.haversineMeters(previous.lat, previous.lng, current.lat, current.lng)
        return meters / (dtMs / 1_000.0)
    }

    fun select(
        speedMps: Double?,
        locationBearingDeg: Float?,
        locationBearingAccuracyDeg: Float?,
        compassHeadingDeg: Float?,
        compassUsable: Boolean,
    ): HeadingSample {
        val moving = (speedMps ?: 0.0) >= RELIABLE_SPEED_MPS
        val gpsBearing = locationBearingDeg?.takeIf {
            locationBearingAccuracyDeg == null || locationBearingAccuracyDeg <= 45f
        }
        if (moving && gpsBearing != null) {
            return HeadingSample(normalize(gpsBearing.toDouble()), HeadingSource.LOCATION_BEARING, true)
        }
        if (compassUsable && compassHeadingDeg != null && (!moving || gpsBearing == null)) {
            return HeadingSample(normalize(compassHeadingDeg.toDouble()), HeadingSource.COMPASS, true)
        }
        if (gpsBearing != null) {
            return HeadingSample(normalize(gpsBearing.toDouble()), HeadingSource.LOCATION_BEARING, true)
        }
        return HeadingSample(0.0, HeadingSource.NONE, visible = false)
    }
}

object HeadingListenerLifecycle {
    const val STABLE_KEY = "survey-rotation-vector"

    fun shouldRecreate(previousKey: String?, nextKey: String?): Boolean =
        previousKey != nextKey
}

object MapFollowPolicy {
    fun afterManualGesture(): Boolean = false

    fun restore(selected: MapFollowMode): MapFollowMode = selected

    fun cameraNorthUp(mode: MapFollowMode): Boolean = mode == MapFollowMode.LOCATE

    fun cameraHeadingUp(mode: MapFollowMode, headingVisible: Boolean): Boolean =
        mode == MapFollowMode.DIRECTION && headingVisible
}

object MapCameraThrottle {
    const val MIN_INTERVAL_MS = 800L
    const val MIN_MOVE_METERS = 5.0
    const val MIN_HEADING_DELTA_DEG = 12.0

    fun shouldApply(
        following: Boolean,
        focusOnUser: Boolean,
        previous: GpsFix?,
        next: GpsFix?,
        previousHeadingDeg: Double?,
        nextHeadingDeg: Double?,
        lastAppliedAtMs: Long,
        nowMs: Long,
        headingUp: Boolean,
    ): Boolean {
        if (next == null) return false
        if (focusOnUser) return true
        if (!following) return false
        if (nowMs - lastAppliedAtMs < MIN_INTERVAL_MS && previous != null) return false
        if (previous == null) return true
        val moved = StopContext.haversineMeters(previous.lat, previous.lng, next.lat, next.lng) >=
            MIN_MOVE_METERS
        val headingChanged = headingUp &&
            previousHeadingDeg != null &&
            nextHeadingDeg != null &&
            kotlin.math.abs(SurveyHeading.shortestDelta(previousHeadingDeg, nextHeadingDeg)) >=
            MIN_HEADING_DELTA_DEG
        return moved || headingChanged
    }
}
