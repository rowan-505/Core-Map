package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.NearbyServingRow
import com.coremapmm.fieldsurveyor.data.transport.RouteSelectionRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NearbyRouteRankerTest {
    private val now = 1_000_000_000L
    private val user = GpsFix(16.80, 96.15, 8f, now)
    private val pathNear = """{"type":"LineString","coordinates":[[96.1502,16.8002],[96.1510,16.8010]]}"""
    private val pathFar = """{"type":"LineString","coordinates":[[96.1540,16.8040],[96.1550,16.8050]]}"""

    @Test
    fun layoutKeepsRecommendButtonUnderSearch() {
        assertEquals(
            listOf("title", "description", "search", "recommendButton", "routeCount", "recommendations", "routeList"),
            NearbyRouteLayout.SLOTS,
        )
    }

    @Test
    fun statesCoverPermissionLocatingAccuracyEmptyStaleAndResults() {
        val row = ranked(serving("v-near", 16.8005, 96.1505, pathNear)).first()
        assertEquals(
            NearbyRouteState.PermissionRequired,
            NearbyRouteFlow.afterSnapshotAndFix(true, false, user, now, listOf(row)),
        )
        assertEquals("Finding your location…", NearbyRouteFlow.message(NearbyRouteState.Locating))
        assertEquals(
            NearbyRouteState.PoorAccuracy,
            NearbyRouteFlow.afterSnapshotAndFix(true, true, GpsFix(16.80, 96.15, 80f, now), now, emptyList()),
        )
        assertEquals(
            NearbyRouteState.StalePackage,
            NearbyRouteFlow.afterSnapshotAndFix(false, true, user, now, emptyList()),
        )
        assertEquals(
            NearbyRouteState.NoNearby,
            NearbyRouteFlow.afterSnapshotAndFix(true, true, user, now, emptyList()),
        )
        val recs = NearbyRouteFlow.afterSnapshotAndFix(true, true, user, now, listOf(row))
        assertTrue(recs is NearbyRouteState.Recommendations)
        assertEquals(
            "No YBS routes found near your current location.",
            NearbyRouteFlow.message(NearbyRouteState.NoNearby),
        )
    }

    @Test
    fun excludesStopsBeyond500mIncludingOtherCountries() {
        val london = serving("v-london", 51.5, -0.12, pathNear)
        val justOutside = offsetStop("v-out", 510.0)
        val justInside = offsetStop("v-in", 490.0)
        val ranked = NearbyRouteRanker.rank(
            user.lat,
            user.lng,
            listOf(london, justOutside, justInside),
            emptyMap(),
            now,
        )
        assertEquals(listOf("v-in"), ranked.map { it.selection.variantPublicId })
        assertTrue(ranked.single().stopDistanceM <= NearbyRoutePolicy.RADIUS_M)
    }

    @Test
    fun excludesIncompleteAndNonD0D1Variants() {
        val incompletePath = serving("v-path", 16.8004, 96.1504, null, stopCount = 8)
        val fewStops = serving("v-stops", 16.8004, 96.1504, pathNear, stopCount = 1)
        val notDirection = serving("v-d2", 16.8004, 96.1504, pathNear, directionId = 2)
        val ok = serving("v-ok", 16.8004, 96.1504, pathNear)
        val ranked = NearbyRouteRanker.rank(
            user.lat,
            user.lng,
            listOf(incompletePath, fewStops, notDirection, ok),
            emptyMap(),
            now,
        )
        assertEquals(listOf("v-ok"), ranked.map { it.selection.variantPublicId })
    }

    @Test
    fun closerStopRanksAboveFartherStopOnTheSamePath() {
        val closer = serving("v-close", 16.8003, 96.1503, pathNear, code = "21")
        val farther = serving("v-far", 16.8020, 96.1520, pathNear, code = "22")
        val ranked = NearbyRouteRanker.rank(
            user.lat,
            user.lng,
            listOf(farther, closer),
            emptyMap(),
            now,
        )
        assertEquals(listOf("v-close", "v-far"), ranked.map { it.selection.variantPublicId })
        assertTrue(ranked[0].stopDistanceM < ranked[1].stopDistanceM)
    }

    @Test
    fun nearerPathLowersScoreWhenStopsMatch() {
        val nearPath = serving("v-near-path", 16.8004, 96.1504, pathNear)
        val farPath = serving("v-far-path", 16.8004, 96.1504, pathFar)
        val ranked = NearbyRouteRanker.rank(
            user.lat,
            user.lng,
            listOf(farPath, nearPath),
            emptyMap(),
            now,
        )
        assertEquals("v-near-path", ranked.first().selection.variantPublicId)
        assertTrue(ranked[0].pathDistanceM < ranked[1].pathDistanceM)
        assertTrue(ranked[0].score < ranked[1].score)
    }

    @Test
    fun recentSurveyPenaltyRaisesScoreButKeepsTheVariant() {
        val fresh = serving("v-fresh", 16.8004, 96.1504, pathNear, code = "21")
        val recent = serving("v-recent", 16.8004, 96.1504, pathNear, code = "20")
        val ranked = NearbyRouteRanker.rank(
            user.lat,
            user.lng,
            listOf(recent, fresh),
            mapOf("v-recent" to now - 3_600_000L),
            now,
        )
        assertEquals(listOf("v-fresh", "v-recent"), ranked.map { it.selection.variantPublicId })
        assertTrue(ranked[1].score - ranked[0].score >= NearbyRoutePolicy.PENALTY_WITHIN_DAY_M - 1)
    }

    @Test
    fun historyPenaltyDoesNotRemoveAVariantAndCapsAtThree() {
        val rows = (0..4).map { index ->
            serving("v-$index", 16.8002 + index * 0.0002, 96.1502 + index * 0.0002, pathNear, code = "1$index")
        }
        val ranked = NearbyRouteRanker.rank(
            user.lat,
            user.lng,
            rows,
            mapOf("v-0" to now - 60_000L),
            now,
        )
        assertEquals(3, ranked.size)
        assertTrue(ranked.none { it.selection.variantPublicId == "v-4" })
        val withPenalty = NearbyRouteRanker.rank(user.lat, user.lng, rows.take(2), mapOf("v-0" to now), now)
        assertEquals(listOf("v-1", "v-0"), withPenalty.map { it.selection.variantPublicId })
    }

    @Test
    fun selectingAResultDoesNotStartSurvey() {
        var started = 0
        var selected: RouteSelectionRow? = null
        val row = RouteSelectionRow("r", "21", "v", "D0", "A", "B", 8)
        NearbyRouteNavigation.select(row) { selected = it }
        assertEquals("v", selected?.variantPublicId)
        assertEquals(0, started)
    }

    @Test
    fun boundingBoxCoversThe500mCutoffThenHaversineCuts() {
        val box = NearbyRoutePolicy.boundingBox(user.lat, user.lng)
        val inside = offsetStop("v-in", 490.0)
        val outside = offsetStop("v-out", 510.0)
        assertTrue(inside.stopLat in box.minLat..box.maxLat)
        assertTrue(outside.stopLat in box.minLat..box.maxLat)
        assertTrue(NearbyRoutePolicy.withinRadius(user.lat, user.lng, inside.stopLat, inside.stopLng))
        assertFalse(NearbyRoutePolicy.withinRadius(user.lat, user.lng, outside.stopLat, outside.stopLng))
    }

    private fun ranked(vararg rows: NearbyServingRow) =
        NearbyRouteRanker.rank(user.lat, user.lng, rows.toList(), emptyMap(), now)

    private fun offsetStop(id: String, distanceM: Double): NearbyServingRow {
        val dLat = distanceM / 111_320.0
        return serving(id, user.lat + dLat, user.lng, pathNear)
    }

    private fun serving(
        id: String,
        lat: Double,
        lng: Double,
        path: String?,
        stopCount: Int = 6,
        directionId: Int = 0,
        code: String = "13",
    ) = NearbyServingRow(
        routePublicId = "route-$id",
        routeCode = code,
        variantPublicId = id,
        variantCode = if (directionId == 0) "D0" else "D1",
        directionId = directionId,
        originName = "A",
        destinationName = "B",
        stopPublicId = "stop-$id",
        stopCode = "S",
        stopNameMy = null,
        stopNameEn = "Near stop",
        stopLat = lat,
        stopLng = lng,
        stopCount = stopCount,
        geometryJson = path,
    )
}
