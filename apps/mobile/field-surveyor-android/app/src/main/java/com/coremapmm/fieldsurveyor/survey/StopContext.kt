package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

data class StopWindow(
    val previous: OrderedStopRow?,
    val current: OrderedStopRow?,
    val next: OrderedStopRow?,
)

data class NearbyStop(
    val stop: OrderedStopRow,
    val distanceM: Double,
)

object StopContext {
    fun ordered(stops: List<OrderedStopRow>): List<OrderedStopRow> =
        stops.filter { hasValidSequence(it.stopSequence) }
            .sortedWith(compareBy<OrderedStopRow> { it.stopSequence }.thenBy { it.stopPublicId })

    fun window(stops: List<OrderedStopRow>, selectedStopPublicId: String?): StopWindow {
        val ordered = ordered(stops)
        if (ordered.isEmpty()) {
            return StopWindow(null, null, null)
        }
        val index = ordered.indexOfFirst { it.stopPublicId == selectedStopPublicId }
        if (index < 0) {
            return StopWindow(previous = null, current = null, next = ordered.first())
        }
        return StopWindow(
            previous = ordered.getOrNull(index - 1),
            current = ordered[index],
            next = ordered.getOrNull(index + 1),
        )
    }

    fun nearest(
        stops: List<OrderedStopRow>,
        lat: Double,
        lng: Double,
        variantPublicId: String,
    ): OrderedStopRow? {
        return nearby(stops, lat, lng, variantPublicId, limit = 1)
            .firstOrNull()?.stop
    }

    fun nearby(
        stops: List<OrderedStopRow>,
        lat: Double,
        lng: Double,
        variantPublicId: String,
        radiusM: Double = FieldLocationConfig.NEARBY_STOP_RADIUS_M,
        limit: Int = 3,
        previous: List<NearbyStop> = emptyList(),
    ): List<NearbyStop> {
        val ranked = stops.asSequence()
            .filter { it.variantPublicId == variantPublicId }
            .filter { hasValidSequence(it.stopSequence) }
            .filter { hasValidStopGeometry(it.lat, it.lng) }
            .map { stop -> NearbyStop(stop, haversineMeters(lat, lng, stop.lat, stop.lng)) }
            .filter { it.distanceM <= radiusM.coerceAtLeast(0.0) }
            .sortedWith(compareBy<NearbyStop> { it.distanceM }.thenBy { it.stop.stopSequence })
            .take(limit.coerceIn(0, MAX_NEARBY_STOPS))
            .toList()
        return stabilizeNearbyOrder(previous, ranked)
    }

    fun hasValidStopGeometry(lat: Double, lng: Double): Boolean {
        if (!lat.isFinite() || !lng.isFinite()) return false
        if (lat == 0.0 && lng == 0.0) return false
        return lat in -90.0..90.0 && lng in -180.0..180.0
    }

    fun hasValidSequence(sequence: Int): Boolean = sequence >= 0

    fun stabilizeNearbyOrder(
        previous: List<NearbyStop>,
        ranked: List<NearbyStop>,
        hysteresisM: Double = REORDER_HYSTERESIS_M,
    ): List<NearbyStop> {
        if (previous.isEmpty() || ranked.isEmpty()) return ranked
        val oldFirst = previous.first()
        val newFirst = ranked.first()
        if (oldFirst.stop.stopPublicId == newFirst.stop.stopPublicId) {
            return ranked
        }
        val oldInNew = ranked.firstOrNull { it.stop.stopPublicId == oldFirst.stop.stopPublicId } ?: return ranked
        if (newFirst.distanceM + hysteresisM < oldInNew.distanceM) {
            return ranked
        }
        val rest = ranked.filter { it.stop.stopPublicId != oldFirst.stop.stopPublicId }
        return listOf(oldInNew) + rest.take((MAX_NEARBY_STOPS - 1).coerceAtLeast(0))
    }

    fun haversineMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val earth = 6_371_000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
            sin(dLng / 2) * sin(dLng / 2)
        return 2 * earth * atan2(sqrt(a), sqrt(1 - a))
    }

    const val MAX_NEARBY_STOPS = 3
    const val REORDER_HYSTERESIS_M = 8.0
}

object NearbyStopRefreshPolicy {
    fun shouldRecompute(previous: GpsFix?, next: GpsFix, lastComputedAtMs: Long, nowMs: Long): Boolean {
        if (previous == null) return true
        val movedM = StopContext.haversineMeters(previous.lat, previous.lng, next.lat, next.lng)
        return movedM >= FieldLocationConfig.NEARBY_RECOMPUTE_MOVEMENT_M ||
            nowMs - lastComputedAtMs >= FieldLocationConfig.NEARBY_RECOMPUTE_INTERVAL_MS
    }
}

data class GpsFix(
    val lat: Double,
    val lng: Double,
    val accuracyM: Float?,
    val epochMs: Long,
    val elapsedRealtimeNanos: Long = 0L,
    val bearingDeg: Float? = null,
    val speedMps: Float? = null,
    val bearingAccuracyDeg: Float? = null,
)

object GpsBuffer {
    const val MAX_FIXES = 30
    const val BEST_WINDOW_MS = SurveyLocationPolicy.STALE_AGE_MS

    fun push(buffer: ArrayDeque<GpsFix>, fix: GpsFix): ArrayDeque<GpsFix> {
        buffer.addLast(fix)
        while (buffer.size > MAX_FIXES) {
            buffer.removeFirst()
        }
        return buffer
    }

    fun bestRecent(buffer: List<GpsFix>, nowEpochMs: Long): GpsFix? {
        val clock = FakeLocationClock(nowEpochMs, nowEpochMs * 1_000_000L)
        return bestRecent(buffer, clock, current = null)
    }

    fun bestRecent(buffer: List<GpsFix>, clock: LocationClock, current: GpsFix?): GpsFix? {
        val recent = buffer.filter { SurveyLocationPolicy.ageMs(it, clock) <= BEST_WINDOW_MS }
        if (recent.isEmpty()) return null
        val anchor = current ?: recent.maxWithOrNull(
            compareBy<GpsFix> { it.elapsedRealtimeNanos }.thenBy { it.epochMs },
        ) ?: return null
        val nearLimit = maxOf(
            SurveyLocationPolicy.EVIDENCE_NEAR_M,
            (anchor.accuracyM ?: SurveyLocationPolicy.DEGRADED_ACCURACY_M).toDouble(),
        )
        val near = recent.filter { candidate ->
            StopContext.haversineMeters(anchor.lat, anchor.lng, candidate.lat, candidate.lng) <= nearLimit
        }
        val pool = near.ifEmpty { listOf(anchor) }
        return pool.minWithOrNull(
            compareBy<GpsFix> { it.accuracyM ?: Float.MAX_VALUE }
                .thenByDescending { it.elapsedRealtimeNanos }
                .thenByDescending { it.epochMs },
        )
    }
}

object CaptureDebounce {
    const val SAME_BUTTON_MIN_GAP_MS = 80L

    fun shouldAccept(lastKind: AnomalyKind?, lastUptimeMs: Long, kind: AnomalyKind, nowUptimeMs: Long): Boolean {
        if (lastKind != kind) {
            return true
        }
        return nowUptimeMs - lastUptimeMs >= SAME_BUTTON_MIN_GAP_MS
    }
}
