package com.coremapmm.fieldsurveyor.survey

object GpsFixPolicy {
    const val STALE_BEHIND_MS = 3_000L
    const val MIN_MOVE_METERS = 1.0
    const val HEARTBEAT_MS = 2_000L
    /** Drop lastKnown / cached provider samples that are too old for field capture. */
    const val MAX_FIX_AGE_MS = FieldLocationConfig.GOOD_FIX_STALE_MS
    const val BETTER_FIX_HOLD_MS = 10_000L

    /**
     * Fused callbacks can still include stale or duplicate jitter. Filter those
     * while retaining a short-lived, materially better fix for report evidence.
     * Keep a heartbeat so the blue dot and accuracy label stay fresh.
     */
    fun publish(previous: GpsFix?, next: GpsFix, nowEpochMs: Long): GpsFix? {
        if (nowEpochMs - next.epochMs > MAX_FIX_AGE_MS) {
            return null
        }
        if (previous == null) {
            return next
        }
        if (next.epochMs + STALE_BEHIND_MS < previous.epochMs) {
            return null
        }
        val previousAccuracy = previous.accuracyM
        val nextAccuracy = next.accuracyM
        val distance = StopContext.haversineMeters(previous.lat, previous.lng, next.lat, next.lng)
        val previousStillPreferred = nowEpochMs - previous.epochMs <= BETTER_FIX_HOLD_MS &&
            previousAccuracy != null &&
            nextAccuracy != null &&
            nextAccuracy > previousAccuracy + 3f &&
            distance <= maxOf(previousAccuracy.toDouble(), nextAccuracy.toDouble())
        if (previousStillPreferred) {
            return null
        }
        val moved = distance >= MIN_MOVE_METERS
        val betterAccuracy = (next.accuracyM ?: Float.MAX_VALUE) + 3f <
            (previous.accuracyM ?: Float.MAX_VALUE)
        val heartbeat = next.epochMs - previous.epochMs >= HEARTBEAT_MS
        return if (moved || betterAccuracy || heartbeat) next else null
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
    fun quality(fix: GpsFix?, nowMs: Long): GpsQuality = when {
        fix == null -> GpsQuality.MISSING
        nowMs - fix.epochMs > FieldLocationConfig.GOOD_FIX_STALE_MS -> GpsQuality.STALE
        fix.accuracyM == null || fix.accuracyM > FieldLocationConfig.REPORT_CONFIRM_ACCURACY_M ->
            GpsQuality.CONFIRM_REQUIRED
        fix.accuracyM > FieldLocationConfig.POOR_ACCURACY_WARNING_M -> GpsQuality.POOR
        else -> GpsQuality.GOOD
    }

    fun label(fix: GpsFix?, nowMs: Long): String = when (quality(fix, nowMs)) {
        GpsQuality.MISSING -> "GPS —"
        GpsQuality.STALE -> fix?.accuracyM?.let { "GPS stale · ±${it.toInt()} m" } ?: "GPS stale"
        else -> fix?.accuracyM?.let { "GPS ±${it.toInt()} m" } ?: "GPS ±? m"
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
