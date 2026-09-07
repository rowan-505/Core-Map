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
    fun window(stops: List<OrderedStopRow>, selectedStopPublicId: String?): StopWindow {
        if (stops.isEmpty()) {
            return StopWindow(null, null, null)
        }
        val index = stops.indexOfFirst { it.stopPublicId == selectedStopPublicId }
        if (index < 0) {
            return StopWindow(previous = null, current = null, next = stops.first())
        }
        return StopWindow(
            previous = stops.getOrNull(index - 1),
            current = stops[index],
            next = stops.getOrNull(index + 1),
        )
    }

    fun nearest(
        stops: List<OrderedStopRow>,
        lat: Double,
        lng: Double,
        variantPublicId: String? = null,
    ): OrderedStopRow? {
        return nearby(stops, lat, lng, variantPublicId = variantPublicId, limit = 1)
            .firstOrNull()?.stop
    }

    fun nearby(
        stops: List<OrderedStopRow>,
        lat: Double,
        lng: Double,
        variantPublicId: String? = null,
        radiusM: Double = FieldLocationConfig.NEARBY_STOP_RADIUS_M,
        limit: Int = 3,
    ): List<NearbyStop> = stops.asSequence()
        .filter { variantPublicId == null || it.variantPublicId == variantPublicId }
        .map { stop -> NearbyStop(stop, haversineMeters(lat, lng, stop.lat, stop.lng)) }
        .filter { it.distanceM <= radiusM.coerceAtLeast(0.0) }
        .sortedBy { it.distanceM }
        .take(limit.coerceIn(0, MAX_NEARBY_STOPS))
        .toList()

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
)

object GpsBuffer {
    const val MAX_FIXES = 30
    const val BEST_WINDOW_MS = FieldLocationConfig.GOOD_FIX_STALE_MS

    fun push(buffer: ArrayDeque<GpsFix>, fix: GpsFix): ArrayDeque<GpsFix> {
        buffer.addLast(fix)
        while (buffer.size > MAX_FIXES) {
            buffer.removeFirst()
        }
        return buffer
    }

    fun bestRecent(buffer: List<GpsFix>, nowEpochMs: Long): GpsFix? {
        val recent = buffer.filter { nowEpochMs - it.epochMs <= BEST_WINDOW_MS }
        return recent.minWithOrNull(
            compareBy<GpsFix> { it.accuracyM ?: Float.MAX_VALUE }
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
