package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.NearbyServingRow
import com.coremapmm.fieldsurveyor.data.transport.RouteSelectionRow
import kotlin.math.cos

data class NearbyRouteRecommendation(
    val selection: RouteSelectionRow,
    val nearestStopName: String,
    val stopDistanceM: Double,
)

data class NearbyRouteLocation(
    val fix: GpsFix,
    val status: SurveyLocationStatus,
    val qualifier: String?,
)

sealed class NearbyRouteState {
    data object Idle : NearbyRouteState()
    data object PermissionRequired : NearbyRouteState()
    data object Locating : NearbyRouteState()
    data object NoLocation : NearbyRouteState()
    data object NoNearby : NearbyRouteState()
    data object StalePackage : NearbyRouteState()
    data class Recommendations(
        val rows: List<NearbyRouteRecommendation>,
        val qualifier: String? = null,
    ) : NearbyRouteState()
}

object NearbyRoutePolicy {
    const val MIN_RADIUS_M = 120.0
    const val MAX_RADIUS_M = 500.0
    const val MAX_RESULTS = 3
    const val MIN_STOPS = 2
    const val RECOMPUTE_MOVE_M = 10.0
    const val RECOMPUTE_INTERVAL_MS = 10_000L

    const val QUALIFIER_DEGRADED = "Using a weaker GPS fix."
    const val QUALIFIER_STALE = "Using last known location."
    const val EMPTY_NO_LOCATION = "No location yet. Nearby routes will appear when a coordinate is available."
    const val EMPTY_NO_NEARBY = "No YBS routes found near your current location."

    fun candidateRadiusM(accuracyM: Float?): Double {
        val fromAccuracy = (accuracyM?.toDouble() ?: 0.0) * 2.0
        return maxOf(MIN_RADIUS_M, fromAccuracy).coerceAtMost(MAX_RADIUS_M)
    }

    fun boundingBox(lat: Double, lng: Double, radiusM: Double = MAX_RADIUS_M): NearbyBounds {
        val padded = radiusM * 1.15
        val dLat = padded / 111_320.0
        val dLng = padded / (111_320.0 * cos(Math.toRadians(lat)).coerceAtLeast(0.2))
        return NearbyBounds(lat - dLat, lat + dLat, lng - dLng, lng + dLng)
    }

    fun hasValidStopGeometry(lat: Double, lng: Double): Boolean {
        if (!lat.isFinite() || !lng.isFinite()) return false
        if (lat == 0.0 && lng == 0.0) return false
        return lat in -90.0..90.0 && lng in -180.0..180.0
    }

    fun isUsableVariant(row: NearbyServingRow): Boolean {
        if (row.directionId !in 0..1) return false
        if (row.variantCode != "D0" && row.variantCode != "D1") return false
        if (row.stopCount < MIN_STOPS) return false
        return hasValidStopGeometry(row.stopLat, row.stopLng)
    }

    fun withinRadius(
        userLat: Double,
        userLng: Double,
        stopLat: Double,
        stopLng: Double,
        radiusM: Double,
    ): Boolean = StopContext.haversineMeters(userLat, userLng, stopLat, stopLng) <= radiusM

    fun formatDistance(meters: Double): String = "~${meters.toInt()} m"

    fun qualifier(status: SurveyLocationStatus): String? = when (status) {
        SurveyLocationStatus.Degraded -> QUALIFIER_DEGRADED
        SurveyLocationStatus.Stale -> QUALIFIER_STALE
        else -> null
    }
}

data class NearbyBounds(
    val minLat: Double,
    val maxLat: Double,
    val minLng: Double,
    val maxLng: Double,
)

object NearbyRouteLocationPolicy {
    fun select(
        snapshot: SurveyLocationSnapshot,
        fallbackFix: GpsFix? = null,
        clock: LocationClock = SystemLocationClock,
    ): NearbyRouteLocation? {
        val fromSnapshot = snapshot.displayFix
        if (fromSnapshot != null) {
            val status = when (snapshot.status) {
                SurveyLocationStatus.Live -> SurveyLocationStatus.Live
                SurveyLocationStatus.Degraded -> SurveyLocationStatus.Degraded
                else -> SurveyLocationStatus.Stale
            }
            return NearbyRouteLocation(fromSnapshot, status, NearbyRoutePolicy.qualifier(status))
        }
        val fallback = fallbackFix ?: return null
        val classified = SurveyLocationPolicy.classify(
            displayFix = fallback,
            permissionGranted = true,
            locationEnabled = true,
            tracking = false,
            oneShot = false,
            clock = clock,
        )
        val status = when (classified) {
            SurveyLocationStatus.Live -> SurveyLocationStatus.Live
            SurveyLocationStatus.Degraded -> SurveyLocationStatus.Degraded
            else -> SurveyLocationStatus.Stale
        }
        return NearbyRouteLocation(fallback, status, NearbyRoutePolicy.qualifier(status))
    }
}

object NearbyRouteRecompute {
    fun shouldRecompute(
        previous: GpsFix?,
        next: GpsFix?,
        lastComputedAtMs: Long,
        nowMs: Long,
    ): Boolean {
        if (next == null) return previous != null
        if (previous == null) return true
        val moved = StopContext.haversineMeters(previous.lat, previous.lng, next.lat, next.lng)
        return moved >= NearbyRoutePolicy.RECOMPUTE_MOVE_M ||
            nowMs - lastComputedAtMs >= NearbyRoutePolicy.RECOMPUTE_INTERVAL_MS
    }
}

object NearbyRouteRanker {
    fun rank(
        userLat: Double,
        userLng: Double,
        rows: List<NearbyServingRow>,
        radiusM: Double = NearbyRoutePolicy.MAX_RADIUS_M,
    ): List<NearbyRouteRecommendation> {
        val bestByVariant = linkedMapOf<String, NearbyRouteRecommendation>()
        rows.forEach { row ->
            if (!NearbyRoutePolicy.isUsableVariant(row)) return@forEach
            if (!NearbyRoutePolicy.withinRadius(userLat, userLng, row.stopLat, row.stopLng, radiusM)) {
                return@forEach
            }
            val stopDistance = StopContext.haversineMeters(userLat, userLng, row.stopLat, row.stopLng)
            val scored = NearbyRouteRecommendation(
                selection = RouteSelectionRow(
                    routePublicId = row.routePublicId,
                    routeCode = row.routeCode,
                    variantPublicId = row.variantPublicId,
                    variantCode = row.variantCode,
                    originName = row.originName,
                    destinationName = row.destinationName,
                    stopCount = row.stopCount,
                ),
                nearestStopName = row.stopNameEn?.takeIf { it.isNotBlank() }
                    ?: row.stopNameMy?.takeIf { it.isNotBlank() }
                    ?: row.stopCode
                    ?: "Stop",
                stopDistanceM = stopDistance,
            )
            val current = bestByVariant[row.variantPublicId]
            if (current == null || scored.stopDistanceM < current.stopDistanceM) {
                bestByVariant[row.variantPublicId] = scored
            }
        }
        return bestByVariant.values.sortedWith(
            compareBy<NearbyRouteRecommendation> { it.stopDistanceM }
                .thenBy { it.selection.routeCode }
                .thenBy { it.selection.variantCode },
        ).take(NearbyRoutePolicy.MAX_RESULTS)
    }
}

object NearbyRouteFlow {
    fun afterSnapshotAndFix(
        hasUsableSnapshot: Boolean,
        hasPermission: Boolean,
        location: NearbyRouteLocation?,
        recommendations: List<NearbyRouteRecommendation>,
    ): NearbyRouteState = when {
        !hasPermission && location == null -> NearbyRouteState.PermissionRequired
        !hasUsableSnapshot -> NearbyRouteState.StalePackage
        location == null -> NearbyRouteState.NoLocation
        recommendations.isEmpty() -> NearbyRouteState.NoNearby
        else -> NearbyRouteState.Recommendations(
            rows = recommendations.take(NearbyRoutePolicy.MAX_RESULTS),
            qualifier = location.qualifier,
        )
    }

    fun retainDuringRefresh(previous: NearbyRouteState, incoming: NearbyRouteState): NearbyRouteState {
        val keep = previous as? NearbyRouteState.Recommendations ?: return incoming
        return when (incoming) {
            NearbyRouteState.Locating,
            NearbyRouteState.Idle,
            NearbyRouteState.StalePackage,
            -> keep
            else -> incoming
        }
    }

    fun message(state: NearbyRouteState): String? = when (state) {
        NearbyRouteState.Idle -> null
        NearbyRouteState.PermissionRequired -> "Location permission needed"
        NearbyRouteState.Locating -> "Finding nearby…"
        NearbyRouteState.NoLocation -> "No location yet"
        NearbyRouteState.NoNearby -> "No nearby routes"
        NearbyRouteState.StalePackage -> "Sync routes to use nearby"
        // Do not surface GPS accuracy qualifiers on the route list.
        is NearbyRouteState.Recommendations -> null
    }
}

object NearbyRouteLayout {
    val SLOTS = listOf(
        "title",
        "description",
        "search",
        "recommendButton",
        "routeCount",
        "recommendations",
        "routeList",
    )
}

object NearbyRouteNavigation {
    /** Loads the variant. Survey starts only from the Survey tab Start button. */
    fun select(row: RouteSelectionRow, onSelectVariant: (RouteSelectionRow) -> Unit) {
        onSelectVariant(row)
    }
}
