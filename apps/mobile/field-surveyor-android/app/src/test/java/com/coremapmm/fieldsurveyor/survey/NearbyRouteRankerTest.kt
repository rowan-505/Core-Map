package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.NearbyServingRow
import com.coremapmm.fieldsurveyor.data.transport.RouteSelectionRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NearbyRouteRankerTest {
    private val now = 1_000_000_000L
    private val clock = FakeLocationClock(now, now * 1_000_000L)
    private val user = GpsFix(16.80, 96.15, 8f, now, elapsedRealtimeNanos = now * 1_000_000L)
    private val pathNear = """{"type":"LineString","coordinates":[[96.1502,16.8002],[96.1510,16.8010]]}"""

    @Test
    fun layoutKeepsRecommendationsUnderSearch() {
        assertEquals(
            listOf("title", "description", "search", "recommendButton", "routeCount", "recommendations", "routeList"),
            NearbyRouteLayout.SLOTS,
        )
    }

    @Test
    fun liveAccurateFixReturnsUnqualifiedRecommendations() {
        val snapshot = liveSnapshot(user)
        val location = NearbyRouteLocationPolicy.select(snapshot, clock = clock)
        val recs = NearbyRouteRanker.rank(user.lat, user.lng, listOf(serving("v-near", 16.8005, 96.1505)), 120.0)
        val state = NearbyRouteFlow.afterSnapshotAndFix(true, true, location, recs)
        assertTrue(state is NearbyRouteState.Recommendations)
        assertNull((state as NearbyRouteState.Recommendations).qualifier)
        assertEquals(1, state.rows.size)
    }

    @Test
    fun degradedFixStillReturnsResults() {
        val fix = user.copy(accuracyM = 40f)
        val snapshot = snapshot(SurveyLocationStatus.Degraded, fix)
        val location = NearbyRouteLocationPolicy.select(snapshot, clock = clock)!!
        assertEquals(NearbyRoutePolicy.QUALIFIER_DEGRADED, location.qualifier)
        val radius = NearbyRoutePolicy.candidateRadiusM(fix.accuracyM)
        val recs = NearbyRouteRanker.rank(fix.lat, fix.lng, listOf(serving("v-near", 16.8005, 96.1505)), radius)
        val state = NearbyRouteFlow.afterSnapshotAndFix(true, true, location, recs)
        assertTrue(state is NearbyRouteState.Recommendations)
        assertEquals(NearbyRoutePolicy.QUALIFIER_DEGRADED, NearbyRouteFlow.message(state))
        assertFalse(NearbyRouteFlow.message(state)!!.contains("accuracy required", ignoreCase = true))
    }

    @Test
    fun staleLastKnownFixStillReturnsQualifiedResults() {
        val fix = GpsFix(16.80, 96.15, 12f, now - 60_000L, elapsedRealtimeNanos = (now - 60_000L) * 1_000_000L)
        val snapshot = snapshot(SurveyLocationStatus.Stale, fix)
        val location = NearbyRouteLocationPolicy.select(snapshot, clock = clock)!!
        assertEquals(NearbyRoutePolicy.QUALIFIER_STALE, location.qualifier)
        val recs = NearbyRouteRanker.rank(fix.lat, fix.lng, listOf(serving("v-near", 16.8004, 96.1504)))
        val state = NearbyRouteFlow.afterSnapshotAndFix(true, true, location, recs)
        assertTrue(state is NearbyRouteState.Recommendations)
        assertEquals(NearbyRoutePolicy.QUALIFIER_STALE, (state as NearbyRouteState.Recommendations).qualifier)
    }

    @Test
    fun noLocationProducesCorrectEmptyState() {
        val idle = SurveyLocationSnapshot.idle()
        assertNull(NearbyRouteLocationPolicy.select(idle, clock = clock))
        val state = NearbyRouteFlow.afterSnapshotAndFix(true, true, null, emptyList())
        assertEquals(NearbyRouteState.NoLocation, state)
        assertEquals(NearbyRoutePolicy.EMPTY_NO_LOCATION, NearbyRouteFlow.message(state))
        assertFalse(NearbyRouteFlow.message(state)!!.contains("GPS accuracy required", ignoreCase = true))
    }

    @Test
    fun invalidGeometryIsIgnored() {
        val invalid = serving("v-bad", Double.NaN, 96.15)
        val zero = serving("v-zero", 0.0, 0.0)
        val ok = serving("v-ok", 16.8004, 96.1504)
        val ranked = NearbyRouteRanker.rank(user.lat, user.lng, listOf(invalid, zero, ok))
        assertEquals(listOf("v-ok"), ranked.map { it.selection.variantPublicId })
    }

    @Test
    fun groupsByVariantKeepsNearestStopAndOrdersByDistance() {
        val near = serving("v-a", 16.8003, 96.1503, code = "22")
        val farSame = serving("v-a", 16.8015, 96.1515, code = "22")
        val farther = serving("v-b", 16.8010, 96.1510, code = "21")
        val ranked = NearbyRouteRanker.rank(user.lat, user.lng, listOf(farther, farSame, near))
        assertEquals(listOf("v-a", "v-b"), ranked.map { it.selection.variantPublicId })
        assertTrue(ranked[0].stopDistanceM < ranked[1].stopDistanceM)
        assertEquals(2, ranked.size)
    }

    @Test
    fun d0AndD1StaySeparateAndAreNotReversed() {
        val d0 = serving("v-d0", 16.8004, 96.1504, directionId = 0, code = "13")
        val d1 = serving("v-d1", 16.8006, 96.1506, directionId = 1, code = "13")
        val ranked = NearbyRouteRanker.rank(user.lat, user.lng, listOf(d0, d1))
        assertEquals(listOf("v-d0", "v-d1"), ranked.map { it.selection.variantPublicId })
        assertEquals(listOf("D0", "D1"), ranked.map { it.selection.variantCode })
        assertEquals("v-d0", d0.variantPublicId)
        assertEquals("v-d1", d1.variantPublicId)
    }

    @Test
    fun outputIsBoundedToThree() {
        val rows = (0..4).map { index ->
            serving("v-$index", 16.8002 + index * 0.0002, 96.1502 + index * 0.0002, code = "1$index")
        }
        val ranked = NearbyRouteRanker.rank(user.lat, user.lng, rows)
        assertEquals(3, ranked.size)
        assertTrue(ranked.none { it.selection.variantPublicId == "v-4" })
    }

    @Test
    fun candidateRadiusUsesAccuracyWithoutBlockingPoorFixes() {
        assertEquals(120.0, NearbyRoutePolicy.candidateRadiusM(8f), 0.01)
        assertEquals(160.0, NearbyRoutePolicy.candidateRadiusM(80f), 0.01)
        assertEquals(500.0, NearbyRoutePolicy.candidateRadiusM(400f), 0.01)
        val far = offsetStop("v-far", 150.0)
        assertTrue(NearbyRouteRanker.rank(user.lat, user.lng, listOf(far), 120.0).isEmpty())
        assertEquals(1, NearbyRouteRanker.rank(user.lat, user.lng, listOf(far), 160.0).size)
    }

    @Test
    fun cacheRefreshKeepsLastValidRecommendations() {
        val recs = NearbyRouteRanker.rank(user.lat, user.lng, listOf(serving("v-near", 16.8004, 96.1504)))
        val previous = NearbyRouteState.Recommendations(recs)
        assertEquals(previous, NearbyRouteFlow.retainDuringRefresh(previous, NearbyRouteState.Locating))
        assertEquals(previous, NearbyRouteFlow.retainDuringRefresh(previous, NearbyRouteState.StalePackage))
        assertEquals(NearbyRouteState.NoNearby, NearbyRouteFlow.retainDuringRefresh(previous, NearbyRouteState.NoNearby))
    }

    @Test
    fun recomputesOnlyAfterMeaningfulMovementOrThrottle() {
        val start = user
        val jitter = GpsFix(16.80001, 96.15001, 8f, now + 1_000L)
        assertFalse(NearbyRouteRecompute.shouldRecompute(start, jitter, now, now + 1_000L))
        val walked = GpsFix(16.8002, 96.15, 8f, now + 2_000L)
        assertTrue(NearbyRouteRecompute.shouldRecompute(start, walked, now, now + 2_000L))
        assertTrue(NearbyRouteRecompute.shouldRecompute(start, start, now, now + NearbyRoutePolicy.RECOMPUTE_INTERVAL_MS))
    }

    @Test
    fun emptyNearbyStateIsNotBlank() {
        val state = NearbyRouteFlow.afterSnapshotAndFix(
            true,
            true,
            NearbyRouteLocation(user, SurveyLocationStatus.Live, null),
            emptyList(),
        )
        assertEquals(NearbyRouteState.NoNearby, state)
        assertEquals(NearbyRoutePolicy.EMPTY_NO_NEARBY, NearbyRouteFlow.message(state))
    }

    @Test
    fun excludesIncompleteAndNonD0D1Variants() {
        val fewStops = serving("v-stops", 16.8004, 96.1504, stopCount = 1)
        val notDirection = serving("v-d2", 16.8004, 96.1504, directionId = 2)
        val ok = serving("v-ok", 16.8004, 96.1504)
        val ranked = NearbyRouteRanker.rank(user.lat, user.lng, listOf(fewStops, notDirection, ok))
        assertEquals(listOf("v-ok"), ranked.map { it.selection.variantPublicId })
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
    fun permissionWithoutCoordinateStaysPermissionRequired() {
        assertEquals(
            NearbyRouteState.PermissionRequired,
            NearbyRouteFlow.afterSnapshotAndFix(true, false, null, emptyList()),
        )
    }

    private fun liveSnapshot(fix: GpsFix) = snapshot(SurveyLocationStatus.Live, fix)

    private fun snapshot(status: SurveyLocationStatus, fix: GpsFix) = SurveyLocationLabels.snapshot(
        status = status,
        displayFix = fix,
        evidenceFix = fix,
    )

    private fun offsetStop(id: String, distanceM: Double): NearbyServingRow {
        val dLat = distanceM / 111_320.0
        return serving(id, user.lat + dLat, user.lng)
    }

    private fun serving(
        id: String,
        lat: Double,
        lng: Double,
        stopCount: Int = 6,
        directionId: Int = 0,
        code: String = "13",
    ) = NearbyServingRow(
        routePublicId = "route-$code",
        routeCode = code,
        variantPublicId = id,
        variantCode = if (directionId == 0) "D0" else if (directionId == 1) "D1" else "D$directionId",
        directionId = directionId,
        originName = "A",
        destinationName = "B",
        stopPublicId = "stop-$id-$lat",
        stopCode = "S",
        stopNameMy = null,
        stopNameEn = "Near stop",
        stopLat = lat,
        stopLng = lng,
        stopCount = stopCount,
        geometryJson = pathNear,
    )
}
