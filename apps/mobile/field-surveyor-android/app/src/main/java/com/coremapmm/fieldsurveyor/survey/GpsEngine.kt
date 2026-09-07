package com.coremapmm.fieldsurveyor.survey

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationManager
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationAvailability
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

enum class LocationMode {
    IDLE,
    ONE_SHOT,
    SURVEY_TRACKING,
}

/** Field-tunable values for both one-shot and active-survey location requests. */
object FieldLocationConfig {
    const val ONE_SHOT_TIMEOUT_MS = 9_000L
    const val TRACKING_INTERVAL_MS = 4_000L
    const val TRACKING_MIN_INTERVAL_MS = 2_000L
    const val TRACKING_MIN_DISPLACEMENT_M = 5f
    const val GOOD_FIX_STALE_MS = 12_000L
    const val POOR_ACCURACY_WARNING_M = 30f
    const val REPORT_CONFIRM_ACCURACY_M = 50f
    const val NEARBY_STOP_RADIUS_M = 150.0
    const val NEARBY_RECOMPUTE_MOVEMENT_M = 10.0
    const val NEARBY_RECOMPUTE_INTERVAL_MS = 10_000L
}

enum class TrackingFailure {
    PERMISSION_REVOKED,
    LOCATION_DISABLED,
    PROVIDER_ERROR,
}

/** Deterministic cached-then-fresh sequencing shared by startup and Locate. */
internal object OneShotLocationPipeline {
    suspend fun run(
        includeCached: Boolean,
        timeoutMs: Long,
        cached: suspend () -> GpsFix?,
        fresh: suspend () -> GpsFix?,
        emit: (GpsFix) -> Unit,
    ) {
        if (includeCached) cached()?.let(emit)
        withTimeoutOrNull(timeoutMs) { fresh() }?.let(emit)
    }
}

/** One Fused Location Provider pipeline for cached, one-shot, and survey fixes. */
class GpsEngine(context: Context) {
    private val app = context.applicationContext
    private val client: FusedLocationProviderClient = LocationServices.getFusedLocationProviderClient(app)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var oneShotJob: Job? = null
    private var trackingCallback: LocationCallback? = null
    private var requestGeneration = 0L

    @SuppressLint("MissingPermission")
    fun requestOneShot(
        includeCached: Boolean,
        onFix: (GpsFix) -> Unit,
        onFinished: () -> Unit,
    ) {
        stop()
        val generation = ++requestGeneration
        oneShotJob = scope.launch {
            try {
                OneShotLocationPipeline.run(
                    includeCached = includeCached,
                    timeoutMs = FieldLocationConfig.ONE_SHOT_TIMEOUT_MS,
                    cached = {
                        awaitLastLocation()?.let { cached ->
                        val fix = toFix(cached)
                        if (System.currentTimeMillis() - fix.epochMs <= GpsFixPolicy.MAX_FIX_AGE_MS) {
                                fix
                            } else {
                                null
                            }
                        }
                    },
                    fresh = { awaitFreshLocation()?.let(::toFix) },
                    emit = onFix,
                )
            } catch (_: SecurityException) {
                // Permission can be revoked between the UI check and this request.
            } finally {
                if (generation == requestGeneration) {
                    oneShotJob = null
                    onFinished()
                }
            }
        }
    }

    @SuppressLint("MissingPermission")
    fun startTracking(
        onFix: (GpsFix) -> Unit,
        onUnavailable: (TrackingFailure) -> Unit = {},
    ): Boolean {
        stop()
        if (!hasLocationPermission()) {
            onUnavailable(TrackingFailure.PERMISSION_REVOKED)
            return false
        }
        if (!locationEnabled()) onUnavailable(TrackingFailure.LOCATION_DISABLED)
        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.locations.forEach { onFix(toFix(it)) }
            }

            override fun onLocationAvailability(availability: LocationAvailability) {
                if (!availability.isLocationAvailable) {
                    onUnavailable(
                        when {
                            !hasLocationPermission() -> TrackingFailure.PERMISSION_REVOKED
                            !locationEnabled() -> TrackingFailure.LOCATION_DISABLED
                            else -> TrackingFailure.PROVIDER_ERROR
                        },
                    )
                }
            }
        }
        trackingCallback = callback
        val request = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            FieldLocationConfig.TRACKING_INTERVAL_MS,
        )
            .setMinUpdateIntervalMillis(FieldLocationConfig.TRACKING_MIN_INTERVAL_MS)
            .setMinUpdateDistanceMeters(FieldLocationConfig.TRACKING_MIN_DISPLACEMENT_M)
            .build()
        try {
            client.requestLocationUpdates(request, callback, Looper.getMainLooper())
                .addOnFailureListener { error ->
                    if (trackingCallback === callback) trackingCallback = null
                    onUnavailable(
                        if (error is SecurityException || !hasLocationPermission()) {
                            TrackingFailure.PERMISSION_REVOKED
                        } else {
                            TrackingFailure.PROVIDER_ERROR
                        },
                    )
                }
        } catch (_: SecurityException) {
            trackingCallback = null
            onUnavailable(TrackingFailure.PERMISSION_REVOKED)
            return false
        }
        return true
    }

    fun stop() {
        requestGeneration += 1
        oneShotJob?.cancel()
        oneShotJob = null
        trackingCallback?.let(client::removeLocationUpdates)
        trackingCallback = null
    }

    fun isTracking(): Boolean = trackingCallback != null

    fun locationEnabled(): Boolean {
        val manager = app.getSystemService(LocationManager::class.java)
        return manager?.isLocationEnabled == true
    }

    fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(app, android.Manifest.permission.ACCESS_FINE_LOCATION) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(app, android.Manifest.permission.ACCESS_COARSE_LOCATION) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    private suspend fun awaitLastLocation(): Location? = suspendCancellableCoroutine { continuation ->
        client.lastLocation
            .addOnSuccessListener { if (continuation.isActive) continuation.resume(it) }
            .addOnFailureListener { if (continuation.isActive) continuation.resume(null) }
            .addOnCanceledListener { if (continuation.isActive) continuation.resume(null) }
    }

    @SuppressLint("MissingPermission")
    private suspend fun awaitFreshLocation(): Location? = suspendCancellableCoroutine { continuation ->
        val cancellation = CancellationTokenSource()
        val request = CurrentLocationRequest.Builder()
            .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
            .setMaxUpdateAgeMillis(0L)
            .setDurationMillis(FieldLocationConfig.ONE_SHOT_TIMEOUT_MS)
            .build()
        client.getCurrentLocation(request, cancellation.token)
            .addOnSuccessListener { if (continuation.isActive) continuation.resume(it) }
            .addOnFailureListener { if (continuation.isActive) continuation.resume(null) }
            .addOnCanceledListener { if (continuation.isActive) continuation.resume(null) }
        continuation.invokeOnCancellation { cancellation.cancel() }
    }

    companion object {
        const val ONE_SHOT_TIMEOUT_MS = FieldLocationConfig.ONE_SHOT_TIMEOUT_MS

        fun toFix(location: Location): GpsFix = GpsFix(
            lat = location.latitude,
            lng = location.longitude,
            accuracyM = if (location.hasAccuracy()) location.accuracy else null,
            epochMs = location.time.takeIf { it > 0L } ?: System.currentTimeMillis(),
        )
    }
}
