package com.coremapmm.fieldsurveyor.survey

import android.os.SystemClock

/** Wall clock for report timestamps; elapsed realtime for GPS age. */
interface LocationClock {
    fun epochMs(): Long
    fun elapsedRealtimeNanos(): Long
}

object SystemLocationClock : LocationClock {
    override fun epochMs(): Long = System.currentTimeMillis()
    override fun elapsedRealtimeNanos(): Long = SystemClock.elapsedRealtimeNanos()
}

class FakeLocationClock(
    var epochMs: Long = 0L,
    var elapsedRealtimeNanos: Long = 0L,
) : LocationClock {
    override fun epochMs(): Long = epochMs
    override fun elapsedRealtimeNanos(): Long = elapsedRealtimeNanos

    fun advanceMs(ms: Long) {
        epochMs += ms
        elapsedRealtimeNanos += ms * 1_000_000L
    }

    fun fix(
        lat: Double,
        lng: Double,
        accuracyM: Float?,
        ageMs: Long = 0L,
    ): GpsFix = GpsFix(
        lat = lat,
        lng = lng,
        accuracyM = accuracyM,
        epochMs = epochMs - ageMs,
        elapsedRealtimeNanos = elapsedRealtimeNanos - ageMs * 1_000_000L,
    )
}

enum class SurveyLocationStatus {
    Acquiring,
    Live,
    Degraded,
    Stale,
    Disabled,
    PermissionDenied,
    Unavailable,
}

data class SurveyLocationSnapshot(
    val status: SurveyLocationStatus,
    val displayFix: GpsFix? = null,
    val evidenceFix: GpsFix? = null,
    val chipLabel: String,
    val banner: String? = null,
    val permissionGranted: Boolean = true,
    val locationEnabled: Boolean = true,
    val tracking: Boolean = false,
    val oneShot: Boolean = false,
    val watchdogStale: Boolean = false,
) {
    companion object {
        fun idle(): SurveyLocationSnapshot = SurveyLocationLabels.snapshot(
            status = SurveyLocationStatus.Unavailable,
            displayFix = null,
            evidenceFix = null,
        )
    }
}

sealed class SurveyLocationEvent {
    data class FixReceived(val fix: GpsFix) : SurveyLocationEvent()
    data class ProviderAvailable(val available: Boolean) : SurveyLocationEvent()
    data object PermissionDenied : SurveyLocationEvent()
    data object LocationDisabled : SurveyLocationEvent()
    data object LocationEnabled : SurveyLocationEvent()
    data object PermissionGranted : SurveyLocationEvent()
    data object TrackingStarted : SurveyLocationEvent()
    data object TrackingStopped : SurveyLocationEvent()
    data object OneShotStarted : SurveyLocationEvent()
    data object OneShotFinished : SurveyLocationEvent()
    data object Tick : SurveyLocationEvent()
    data object WatchdogSilence : SurveyLocationEvent()
}

object SurveyLocationPolicy {
    const val LIVE_AGE_MS = 5_000L
    const val STALE_AGE_MS = 15_000L
    const val DEGRADED_ACCURACY_M = 25f
    const val REPORT_CONFIRM_ACCURACY_M = 50f
    const val BETTER_ACCURACY_DELTA_M = 3f
    const val MIN_MOVE_METERS = 1.0
    const val STALE_BEHIND_MS = 3_000L
    const val EVIDENCE_NEAR_M = 25.0

    fun ageMs(fix: GpsFix, clock: LocationClock): Long {
        if (fix.elapsedRealtimeNanos > 0L) {
            return ((clock.elapsedRealtimeNanos() - fix.elapsedRealtimeNanos) / 1_000_000L)
                .coerceAtLeast(0L)
        }
        return (clock.epochMs() - fix.epochMs).coerceAtLeast(0L)
    }

    fun classify(
        displayFix: GpsFix?,
        permissionGranted: Boolean,
        locationEnabled: Boolean,
        tracking: Boolean,
        oneShot: Boolean,
        clock: LocationClock,
        watchdogStale: Boolean = false,
    ): SurveyLocationStatus {
        if (!permissionGranted) return SurveyLocationStatus.PermissionDenied
        if (!locationEnabled) return SurveyLocationStatus.Disabled
        if (displayFix == null) {
            return if (tracking || oneShot) {
                SurveyLocationStatus.Acquiring
            } else {
                SurveyLocationStatus.Unavailable
            }
        }
        val age = ageMs(displayFix, clock)
        val accuracy = displayFix.accuracyM
        return when {
            watchdogStale || age > STALE_AGE_MS -> SurveyLocationStatus.Stale
            age <= LIVE_AGE_MS && accuracy != null && accuracy <= DEGRADED_ACCURACY_M ->
                SurveyLocationStatus.Live
            else -> SurveyLocationStatus.Degraded
        }
    }
}

object SurveyLocationLabels {
    const val CHIP_NONE = "Location unavailable"
    const val CHIP_ACQUIRING = "Finding location…"
    const val CHIP_LIVE_PREFIX = "GPS ±"
    const val CHIP_WEAK_PREFIX = "Weak GPS · ±"
    const val CHIP_STALE = "Last location"
    const val CHIP_OFF = "Turn on location"
    const val CHIP_PERMISSION = "Location permission required"
    /** Kept for message filtering only; UI uses a single chip, never a second GPS banner. */
    const val TEMPORARILY_UNAVAILABLE = "Location is temporarily unavailable."

    fun chip(status: SurveyLocationStatus, fix: GpsFix?): String {
        val meters = fix?.accuracyM?.toInt()
        return when (status) {
            SurveyLocationStatus.Acquiring -> CHIP_ACQUIRING
            SurveyLocationStatus.Live -> "$CHIP_LIVE_PREFIX${meters ?: "?"}m"
            SurveyLocationStatus.Degraded -> "$CHIP_WEAK_PREFIX${meters ?: "?"}m"
            SurveyLocationStatus.Stale -> CHIP_STALE
            SurveyLocationStatus.Disabled -> CHIP_OFF
            SurveyLocationStatus.PermissionDenied -> CHIP_PERMISSION
            SurveyLocationStatus.Unavailable -> CHIP_NONE
        }
    }

    /** Second GPS banner is retired; one chip is the only presentation. */
    fun banner(status: SurveyLocationStatus, displayFix: GpsFix?): String? = null

    fun snapshot(
        status: SurveyLocationStatus,
        displayFix: GpsFix?,
        evidenceFix: GpsFix?,
        permissionGranted: Boolean = true,
        locationEnabled: Boolean = true,
        tracking: Boolean = false,
        oneShot: Boolean = false,
        watchdogStale: Boolean = false,
    ): SurveyLocationSnapshot {
        val shown = if (status == SurveyLocationStatus.Unavailable) null else displayFix
        val safeStatus = if (shown != null && status == SurveyLocationStatus.Unavailable) {
            SurveyLocationStatus.Stale
        } else {
            status
        }
        return SurveyLocationSnapshot(
            status = safeStatus,
            displayFix = shown,
            evidenceFix = evidenceFix ?: shown,
            chipLabel = chip(safeStatus, shown),
            banner = null,
            permissionGranted = permissionGranted,
            locationEnabled = locationEnabled,
            tracking = tracking,
            oneShot = oneShot,
            watchdogStale = watchdogStale,
        )
    }
}

object SurveyLocationConsumers {
    fun mapFix(snapshot: SurveyLocationSnapshot): GpsFix? = snapshot.displayFix
    fun formFix(snapshot: SurveyLocationSnapshot): GpsFix? = snapshot.displayFix
    fun evidenceFix(snapshot: SurveyLocationSnapshot): GpsFix? = snapshot.evidenceFix
}

object SurveyLocationContradiction {
    fun isImpossible(snapshot: SurveyLocationSnapshot): Boolean {
        val unavailableWithPoint =
            snapshot.displayFix != null && snapshot.status == SurveyLocationStatus.Unavailable
        val staleAndUnavailableChip =
            snapshot.displayFix != null &&
                snapshot.status == SurveyLocationStatus.Stale &&
                (
                    snapshot.chipLabel == SurveyLocationLabels.CHIP_NONE ||
                        snapshot.chipLabel == SurveyLocationLabels.TEMPORARILY_UNAVAILABLE
                    )
        val bannerVsMap = snapshot.banner != null &&
            snapshot.displayFix != null &&
            snapshot.banner == SurveyLocationLabels.TEMPORARILY_UNAVAILABLE
        val mapFormSplit = SurveyLocationConsumers.mapFix(snapshot) !=
            SurveyLocationConsumers.formFix(snapshot)
        val hasContradiction = unavailableWithPoint || staleAndUnavailableChip || bannerVsMap || mapFormSplit
        return !hasContradiction
    }
}

object SurveyLocationReducer {
    fun reduce(
        previous: SurveyLocationSnapshot,
        event: SurveyLocationEvent,
        clock: LocationClock,
        evidenceBuffer: List<GpsFix> = emptyList(),
    ): SurveyLocationSnapshot {
        var permission = previous.permissionGranted
        var enabled = previous.locationEnabled
        var tracking = previous.tracking
        var oneShot = previous.oneShot
        var display = previous.displayFix
        when (event) {
            is SurveyLocationEvent.FixReceived -> {
                display = GpsFixPolicy.publish(display, event.fix, clock) ?: display
            }
            is SurveyLocationEvent.ProviderAvailable -> {
                if (event.available) {
                    enabled = true
                }
            }
            SurveyLocationEvent.PermissionDenied -> permission = false
            SurveyLocationEvent.PermissionGranted -> permission = true
            SurveyLocationEvent.LocationDisabled -> enabled = false
            SurveyLocationEvent.LocationEnabled -> enabled = true
            SurveyLocationEvent.TrackingStarted -> tracking = true
            SurveyLocationEvent.TrackingStopped -> {
                tracking = false
                oneShot = false
            }
            SurveyLocationEvent.OneShotStarted -> oneShot = true
            SurveyLocationEvent.OneShotFinished -> oneShot = false
            SurveyLocationEvent.Tick -> Unit
            SurveyLocationEvent.WatchdogSilence -> Unit
        }
        var watchdogStale = previous.watchdogStale
        when (event) {
            is SurveyLocationEvent.FixReceived -> watchdogStale = false
            SurveyLocationEvent.WatchdogSilence -> if (display != null) watchdogStale = true
            SurveyLocationEvent.TrackingStopped -> watchdogStale = false
            else -> Unit
        }
        val evidence = GpsBuffer.bestRecent(
            buffer = evidenceBuffer + listOfNotNull(display),
            clock = clock,
            current = display,
        ) ?: display
        val status = SurveyLocationPolicy.classify(
            displayFix = display,
            permissionGranted = permission,
            locationEnabled = enabled,
            tracking = tracking,
            oneShot = oneShot,
            clock = clock,
            watchdogStale = watchdogStale,
        )
        return SurveyLocationLabels.snapshot(
            status = status,
            displayFix = display,
            evidenceFix = evidence,
            permissionGranted = permission,
            locationEnabled = enabled,
            tracking = tracking,
            oneShot = oneShot,
            watchdogStale = watchdogStale,
        )
    }
}
