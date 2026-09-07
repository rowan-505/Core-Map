package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.NearbyServingRow
import com.coremapmm.fieldsurveyor.data.transport.RoutePathGeometry
import com.coremapmm.fieldsurveyor.data.transport.RouteSelectionRow
import kotlin.math.cos

data class NearbyRouteRecommendation(
    val selection: RouteSelectionRow,
    val nearestStopName: String,
    val stopDistanceM: Double,
    val pathDistanceM: Double,
    val lastSurveyedAtEpochMs: Long?,
    val score: Double,
)

sealed class NearbyRouteState {
    data object Idle : NearbyRouteState()
    data object PermissionRequired : NearbyRouteState()
    data object Locating : NearbyRouteState()
    data object PoorAccuracy : NearbyRouteState()
    data object NoNearby : NearbyRouteState()
    data object StalePackage : NearbyRouteState()
    data class Recommendations(val rows: List<NearbyRouteRecommendation>) : NearbyRouteState()
}

object NearbyRoutePolicy {
    const val RADIUS_M = 500.0
    const val PATH_WEIGHT = 0.35
    const val RECENT_DAY_MS = 24L * 60 * 60 * 1000
    const val RECENT_WEEK_MS = 7L * 24 * 60 * 60 * 1000
    const val PENALTY_WITHIN_DAY_M = 400.0
    const val PENALTY_WITHIN_WEEK_M = 150.0
    const val MAX_RESULTS = 3
    const val MIN_STOPS = 2

    fun boundingBox(lat: Double, lng: Double, radiusM: Double = RADIUS_M): NearbyBounds {
        val padded = radiusM * 1.15
        val dLat = padded / 111_320.0
        val dLng = padded / (111_320.0 * cos(Math.toRadians(lat)).coerceAtLeast(0.2))
        return NearbyBounds(lat - dLat, lat + dLat, lng - dLng, lng + dLng)
    }

    fun isCompleteD0D1(row: NearbyServingRow): Boolean {
        if (row.directionId !in 0..1) return false
        if (row.stopCount < MIN_STOPS) return false
        val path = row.geometryJson ?: return false
        return RoutePathGeometry.hasLineString(path)
    }

    fun withinRadius(userLat: Double, userLng: Double, stopLat: Double, stopLng: Double): Boolean =
        StopContext.haversineMeters(userLat, userLng, stopLat, stopLng) <= RADIUS_M

    fun surveyPenaltyM(lastSurveyedAtEpochMs: Long?, nowMs: Long): Double {
        if (lastSurveyedAtEpochMs == null) return 0.0
        val age = nowMs - lastSurveyedAtEpochMs
        return when {
            age < 0L -> PENALTY_WITHIN_DAY_M
            age <= RECENT_DAY_MS -> PENALTY_WITHIN_DAY_M
            age <= RECENT_WEEK_MS -> PENALTY_WITHIN_WEEK_M
            else -> 0.0
        }
    }

    fun score(stopDistanceM: Double, pathDistanceM: Double, lastSurveyedAtEpochMs: Long?, nowMs: Long): Double =
        stopDistanceM + PATH_WEIGHT * pathDistanceM + surveyPenaltyM(lastSurveyedAtEpochMs, nowMs)

    fun lastSurveyLabel(lastSurveyedAtEpochMs: Long?, nowMs: Long): String {
        if (lastSurveyedAtEpochMs == null) return "Not surveyed yet"
        val age = (nowMs - lastSurveyedAtEpochMs).coerceAtLeast(0L)
        val hours = age / 3_600_000L
        val days = age / RECENT_DAY_MS
        return when {
            hours < 1L -> "Surveyed just now"
            hours < 24L -> "Surveyed ${hours}h ago"
            days < 7L -> "Surveyed ${days}d ago"
            else -> "Surveyed earlier"
        }
    }
}

data class NearbyBounds(
    val minLat: Double,
    val maxLat: Double,
    val minLng: Double,
    val maxLng: Double,
)

object NearbyRouteRanker {
    fun rank(
        userLat: Double,
        userLng: Double,
        rows: List<NearbyServingRow>,
        lastSurveyByVariant: Map<String, Long>,
        nowMs: Long,
    ): List<NearbyRouteRecommendation> {
        val bestByVariant = linkedMapOf<String, NearbyRouteRecommendation>()
        rows.forEach { row ->
            if (!NearbyRoutePolicy.isCompleteD0D1(row)) return@forEach
            if (!NearbyRoutePolicy.withinRadius(userLat, userLng, row.stopLat, row.stopLng)) return@forEach
            val path = row.geometryJson ?: return@forEach
            val pathDistance = minPathDistanceM(userLat, userLng, path) ?: return@forEach
            val stopDistance = StopContext.haversineMeters(userLat, userLng, row.stopLat, row.stopLng)
            val lastSurvey = lastSurveyByVariant[row.variantPublicId]
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
                pathDistanceM = pathDistance,
                lastSurveyedAtEpochMs = lastSurvey,
                score = NearbyRoutePolicy.score(stopDistance, pathDistance, lastSurvey, nowMs),
            )
            val current = bestByVariant[row.variantPublicId]
            if (current == null || scored.stopDistanceM < current.stopDistanceM - 0.01 ||
                (kotlin.math.abs(scored.stopDistanceM - current.stopDistanceM) <= 0.01 && scored.score < current.score)
            ) {
                bestByVariant[row.variantPublicId] = scored
            }
        }
        return bestByVariant.values.sortedWith(
            compareBy<NearbyRouteRecommendation> { it.score }
                .thenBy { it.stopDistanceM }
                .thenBy { it.selection.routeCode }
                .thenBy { it.selection.variantCode },
        ).take(NearbyRoutePolicy.MAX_RESULTS)
    }

    private fun minPathDistanceM(lat: Double, lng: Double, geometryJson: String): Double? {
        val points = RoutePathGeometry.lngLatPoints(geometryJson)
        if (points.size < 2) return null
        return points.minOf { point -> StopContext.haversineMeters(lat, lng, point.second, point.first) }
    }
}

object NearbyRouteFlow {
    fun afterSnapshotAndFix(
        hasUsableSnapshot: Boolean,
        hasPermission: Boolean,
        fix: GpsFix?,
        nowMs: Long,
        recommendations: List<NearbyRouteRecommendation>,
    ): NearbyRouteState = when {
        !hasPermission -> NearbyRouteState.PermissionRequired
        !hasUsableSnapshot -> NearbyRouteState.StalePackage
        !GpsQualityPolicy.canUseForNearby(fix, nowMs) -> NearbyRouteState.PoorAccuracy
        recommendations.isEmpty() -> NearbyRouteState.NoNearby
        else -> NearbyRouteState.Recommendations(recommendations.take(NearbyRoutePolicy.MAX_RESULTS))
    }

    fun message(state: NearbyRouteState): String? = when (state) {
        NearbyRouteState.Idle -> null
        NearbyRouteState.PermissionRequired -> "Location permission is required to recommend a nearby route."
        NearbyRouteState.Locating -> "Finding your location…"
        NearbyRouteState.PoorAccuracy -> "GPS accuracy is too poor to recommend a nearby route."
        NearbyRouteState.NoNearby -> "No YBS routes found near your current location."
        NearbyRouteState.StalePackage -> "Offline route package is missing or incomplete. Sync routes in Setup."
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
