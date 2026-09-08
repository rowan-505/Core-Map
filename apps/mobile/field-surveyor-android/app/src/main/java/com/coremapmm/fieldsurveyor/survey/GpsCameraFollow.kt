package com.coremapmm.fieldsurveyor.survey

object GpsFixPolicy {
    const val STALE_BEHIND_MS = SurveyLocationPolicy.STALE_BEHIND_MS
    const val MIN_MOVE_METERS = SurveyLocationPolicy.MIN_MOVE_METERS
    const val HEARTBEAT_MS = 2_000L
    const val MAX_FIX_AGE_MS = SurveyLocationPolicy.STALE_AGE_MS
    const val BETTER_FIX_HOLD_MS = 10_000L

    /**
     * One fused stream. Keep last-known even when incoming samples are old.
     * Do not take a worse heartbeat. Movement replaces an old accurate park fix.
     */
    fun publish(previous: GpsFix?, next: GpsFix, nowEpochMs: Long): GpsFix? {
        val clock = FakeLocationClock(nowEpochMs, nowEpochMs * 1_000_000L)
        return publish(previous, next, clock)
    }

    fun publish(previous: GpsFix?, next: GpsFix, clock: LocationClock): GpsFix? {
        if (previous == null) {
            return next
        }
        if (isOlderThan(next, previous)) {
            return null
        }
        val previousAccuracy = previous.accuracyM
        val nextAccuracy = next.accuracyM
        val distance = StopContext.haversineMeters(previous.lat, previous.lng, next.lat, next.lng)
        val previousAge = SurveyLocationPolicy.ageMs(previous, clock)
        val previousStillPreferred = previousAge <= BETTER_FIX_HOLD_MS &&
            previousAccuracy != null &&
            nextAccuracy != null &&
            nextAccuracy > previousAccuracy + SurveyLocationPolicy.BETTER_ACCURACY_DELTA_M &&
            distance <= maxOf(previousAccuracy.toDouble(), nextAccuracy.toDouble())
        if (previousStillPreferred) {
            return null
        }
        val moved = distance >= MIN_MOVE_METERS
        if (moved) {
            return next
        }
        val betterAccuracy = (next.accuracyM ?: Float.MAX_VALUE) +
            SurveyLocationPolicy.BETTER_ACCURACY_DELTA_M <
            (previous.accuracyM ?: Float.MAX_VALUE)
        if (betterAccuracy) {
            return next
        }
        val worse = (next.accuracyM ?: Float.MAX_VALUE) >
            (previous.accuracyM ?: Float.MAX_VALUE) + SurveyLocationPolicy.BETTER_ACCURACY_DELTA_M
        if (worse) {
            return null
        }
        val newerByMs = newerByMs(previous, next)
        return if (newerByMs >= HEARTBEAT_MS) next else null
    }

    private fun isOlderThan(next: GpsFix, previous: GpsFix): Boolean {
        if (next.elapsedRealtimeNanos > 0L && previous.elapsedRealtimeNanos > 0L) {
            return next.elapsedRealtimeNanos + STALE_BEHIND_MS * 1_000_000L <
                previous.elapsedRealtimeNanos
        }
        return next.epochMs + STALE_BEHIND_MS < previous.epochMs
    }

    private fun newerByMs(previous: GpsFix, next: GpsFix): Long {
        if (next.elapsedRealtimeNanos > 0L && previous.elapsedRealtimeNanos > 0L) {
            return ((next.elapsedRealtimeNanos - previous.elapsedRealtimeNanos) / 1_000_000L)
                .coerceAtLeast(0L)
        }
        return (next.epochMs - previous.epochMs).coerceAtLeast(0L)
    }
}

enum class GpsQuality {
    MISSING,
    GOOD,
    POOR,
    CONFIRM_REQUIRED,
    STALE,
}

object GpsQualityPolicy {
    fun quality(fix: GpsFix?, nowMs: Long): GpsQuality {
        val clock = FakeLocationClock(nowMs, nowMs * 1_000_000L)
        val status = SurveyLocationPolicy.classify(
            displayFix = fix,
            permissionGranted = true,
            locationEnabled = true,
            tracking = false,
            oneShot = false,
            clock = clock,
        )
        return when (status) {
            SurveyLocationStatus.Unavailable, SurveyLocationStatus.Acquiring -> GpsQuality.MISSING
            SurveyLocationStatus.Stale -> GpsQuality.STALE
            SurveyLocationStatus.Disabled, SurveyLocationStatus.PermissionDenied -> GpsQuality.MISSING
            SurveyLocationStatus.Degraded, SurveyLocationStatus.Live -> when {
                fix?.accuracyM == null ||
                    (fix.accuracyM ?: Float.MAX_VALUE) > FieldLocationConfig.REPORT_CONFIRM_ACCURACY_M ->
                    GpsQuality.CONFIRM_REQUIRED
                (fix.accuracyM ?: 0f) > FieldLocationConfig.POOR_ACCURACY_WARNING_M -> GpsQuality.POOR
                else -> GpsQuality.GOOD
            }
        }
    }

    fun label(fix: GpsFix?, nowMs: Long): String {
        val clock = FakeLocationClock(nowMs, nowMs * 1_000_000L)
        val status = SurveyLocationPolicy.classify(
            displayFix = fix,
            permissionGranted = true,
            locationEnabled = true,
            tracking = false,
            oneShot = false,
            clock = clock,
        )
        return SurveyLocationLabels.chip(status, fix)
    }

    fun canUseForNearby(fix: GpsFix?, nowMs: Long): Boolean = when (quality(fix, nowMs)) {
        GpsQuality.GOOD, GpsQuality.POOR -> true
        GpsQuality.MISSING, GpsQuality.CONFIRM_REQUIRED, GpsQuality.STALE -> false
    }
}

object ReportLocationPolicy {
    fun isLocationCritical(kind: AnomalyKind): Boolean =
        kind == AnomalyKind.MOVED || kind == AnomalyKind.MISSING

    fun requiresPoorAccuracyConfirmation(kind: AnomalyKind, fix: GpsFix?, nowMs: Long): Boolean =
        isLocationCritical(kind) && GpsQualityPolicy.quality(fix, nowMs) == GpsQuality.CONFIRM_REQUIRED
}

data class LocationState(
    val mode: LocationMode = LocationMode.IDLE,
    val cameraFollowEnabled: Boolean = false,
    val centerOncePending: Boolean = false,
)

object LocationStateModel {
    fun startup(state: LocationState): LocationState = when (state.mode) {
        LocationMode.IDLE -> LocationState(LocationMode.ONE_SHOT, centerOncePending = true)
        else -> state
    }

    fun locate(state: LocationState): LocationState = when (state.mode) {
        LocationMode.SURVEY_TRACKING -> state.copy(cameraFollowEnabled = true, centerOncePending = false)
        else -> LocationState(LocationMode.ONE_SHOT, centerOncePending = true)
    }

    fun startSurvey(): LocationState = LocationState(
        mode = LocationMode.SURVEY_TRACKING,
        cameraFollowEnabled = true,
    )

    fun manualPan(state: LocationState): LocationState = state.copy(
        cameraFollowEnabled = false,
        centerOncePending = false,
    )

    fun centered(state: LocationState): LocationState = state.copy(centerOncePending = false)

    fun oneShotFinished(state: LocationState): LocationState = if (state.mode == LocationMode.ONE_SHOT) {
        state.copy(mode = LocationMode.IDLE)
    } else {
        state
    }

    fun finishSurvey(): LocationState = LocationState(LocationMode.IDLE, cameraFollowEnabled = false)
}

object GpsCameraFollow {
    /** Same value as MapLibre [org.maplibre.android.maps.MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE]. */
    const val REASON_GESTURE = 1
    const val FOLLOW_MOVE_METERS = 1.0

    fun followingAfterMoveStarted(reason: Int, following: Boolean): Boolean {
        return if (reason == REASON_GESTURE) false else following
    }

    fun cameraZoom(focusOnUser: Boolean, currentZoom: Double): Double {
        val zoom = if (focusOnUser) SurveyMapOverlays.GPS_ZOOM else currentZoom
        return zoom.coerceIn(SurveyMapOverlays.MIN_ZOOM, SurveyMapOverlays.MAX_ZOOM)
    }

    fun stopFocusZoom(currentZoom: Double): Double {
        return maxOf(currentZoom, SurveyMapOverlays.GPS_ZOOM)
            .coerceIn(SurveyMapOverlays.MIN_ZOOM, SurveyMapOverlays.MAX_ZOOM)
    }

    fun shouldMoveCamera(
        following: Boolean,
        focusOnUser: Boolean,
        previous: GpsFix?,
        next: GpsFix?,
    ): Boolean {
        if (next == null) {
            return false
        }
        if (focusOnUser) {
            return true
        }
        if (!following) {
            return false
        }
        if (previous == null) {
            return true
        }
        return StopContext.haversineMeters(
            previous.lat,
            previous.lng,
            next.lat,
            next.lng,
        ) >= FOLLOW_MOVE_METERS
    }
}
