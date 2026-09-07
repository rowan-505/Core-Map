package com.coremapmm.fieldsurveyor.data.transport

import com.coremapmm.fieldsurveyor.survey.DirectionSwitchAction
import com.coremapmm.fieldsurveyor.survey.DirectionSwitchPolicy
import com.coremapmm.fieldsurveyor.survey.LocalSessionSnapshot
import com.coremapmm.fieldsurveyor.survey.SurveySelection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DirectionSwitchTest {
    private val route13 = "11111111-1111-4111-8111-111111111111"
    private val route13A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    private val d0 = "22222222-2222-4222-8222-222222222220"
    private val d1 = "99999999-9999-4999-8999-999999999991"
    private val d1Lookalike = "22222222-2222-4222-8222-222222222221"
    private val d0On13A = "33333333-3333-4333-8333-333333333330"
    private val d1On13A = "33333333-3333-4333-8333-333333333331"

    private val variants = listOf(
        variant(d0, route13, "D0", 0, "Sule", "Hledan"),
        variant(d1, route13, "D1", 1, "Hledan", "Sule"),
        variant(d0On13A, route13A, "D0", 0, "A", "B"),
        variant(d1On13A, route13A, "D1", 1, "B", "A"),
    )

    private val d0Stops = listOf(
        stop(1, "stop-a", d0, 16.80, 96.15),
        stop(2, "stop-b", d0, 16.81, 96.16),
        stop(3, "stop-c", d0, 16.82, 96.17),
    )
    private val d1Stops = listOf(
        stop(1, "stop-c", d1, 16.82, 96.17),
        stop(2, "stop-x", d1, 16.83, 96.18),
        stop(3, "stop-a", d1, 16.80, 96.15),
    )
    private val d0Path = """{"type":"LineString","coordinates":[[96.15,16.80],[96.16,16.81]]}"""
    private val d1Path = """{"type":"LineString","coordinates":[[96.18,16.83],[96.15,16.80]]}"""

    @Test
    fun switchesD0ToD1BeforeStartUsingStoredCounterpart() {
        val target = resolve(d0)!!
        assertEquals(d1, target.selection.variantPublicId)
        assertEquals("D1", target.oppositeCode)
        assertEquals(DirectionSwitchAction.SWITCH_NOW, DirectionSwitchPolicy.action(false, true))
        assertEquals("⇄ D1", DirectionSwitchPolicy.buttonLabel(target.oppositeCode))
        assertNotEquals(d1Lookalike, target.selection.variantPublicId)
    }

    @Test
    fun switchesD1ToD0() {
        val target = resolve(d1)!!
        assertEquals(d0, target.selection.variantPublicId)
        assertEquals("D0", target.oppositeCode)
        assertEquals("⇄ D0", DirectionSwitchPolicy.buttonLabel(target.oppositeCode))
    }

    @Test
    fun runningSurveyRequiresConfirmation() {
        assertEquals(DirectionSwitchAction.CONFIRM_AND_SWITCH, DirectionSwitchPolicy.action(true, true))
    }

    @Test
    fun abRouteCodesDoNotBecomeCounterparts() {
        assertEquals(d1, OppositeVariantLookup.counterpart(variants, d0)?.publicId)
        assertEquals(d1On13A, OppositeVariantLookup.counterpart(variants, d0On13A)?.publicId)
        assertNull(OppositeVariantLookup.counterpart(variants.filter { it.routePublicId == route13 }, d0On13A))
    }

    @Test
    fun missingCounterpartDisablesSwitch() {
        val onlyD0 = variants.filter { it.publicId == d0 }
        assertNull(OppositeVariantLookup.counterpart(onlyD0, d0))
        assertNull(resolve(d0, onlyD0, d0Stops, d0Path))
        assertEquals(DirectionSwitchAction.DISABLED, DirectionSwitchPolicy.action(true, false))
    }

    @Test
    fun usesRealOppositeStopsAndPathInsteadOfReversing() {
        val target = resolve(d0)!!
        assertEquals(listOf("stop-c", "stop-x", "stop-a"), target.stops.map { it.stopPublicId })
        assertNotEquals(d0Stops.reversed().map { it.stopPublicId }, target.stops.map { it.stopPublicId })
        assertEquals(d1Path, target.pathJson)
        assertNotEquals(d0Path, target.pathJson)
        assertTrue(RoutePathGeometry.hasLineString(target.pathJson))
    }

    @Test
    fun processInterruptionRestoresActiveSessionVariant() {
        val stored = SurveySelection(route13, "YBS-13", d0, "D0", "stop-b")
        val restored = DirectionSwitchPolicy.restoredSelection(
            active = LocalSessionSnapshot(route13, "YBS-13", d1, "D1"),
            stored = stored,
        )
        assertEquals(d1, restored?.variantPublicId)
        assertEquals("D1", restored?.variantCode)
        assertNull(restored?.selectedStopPublicId)
    }

    @Test
    fun processInterruptionKeepsStopOnlyWhenVariantStillMatches() {
        val stored = SurveySelection(route13, "YBS-13", d1, "D1", "stop-x")
        val restored = DirectionSwitchPolicy.restoredSelection(
            active = LocalSessionSnapshot(route13, "YBS-13", d1, "D1"),
            stored = stored,
        )
        assertEquals("stop-x", restored?.selectedStopPublicId)
    }

    @Test
    fun claimedStringReplacedIdIsRejectedBySnapshotValidator() {
        val json = org.json.JSONObject(
            """
            {
              "snapshotRevision": "v1-test",
              "unchanged": false,
              "routes": [{"publicId":"$route13","routeCode":"YBS-13","nameMy":null,"nameEn":"13"}],
              "variants": [
                {"publicId":"$d0","routePublicId":"$route13","variantCode":"D0","directionId":0,"originName":"A","destinationName":"B","oppositeVariantPublicId":"$d1Lookalike"},
                {"publicId":"$d1","routePublicId":"$route13","variantCode":"D1","directionId":1,"originName":"B","destinationName":"A"}
              ],
              "stops": [],
              "routeStops": [],
              "routePaths": []
            }
            """.trimIndent(),
        )
        try {
            SnapshotValidator.validate(BootstrapJson.parseDataset(json))
            throw AssertionError("expected invalid opposite id")
        } catch (error: SnapshotParseException) {
            assertTrue(error.message!!.contains("oppositeVariantPublicId"))
        }
    }

    @Test
    fun bootstrapMayOmitOppositeFieldAndClientStillDerivesIt() {
        val json = org.json.JSONObject(
            """
            {
              "snapshotRevision": "v1-test",
              "unchanged": false,
              "routes": [{"publicId":"$route13","routeCode":"YBS-13","nameMy":null,"nameEn":"13"}],
              "variants": [
                {"publicId":"$d0","routePublicId":"$route13","variantCode":"D0","directionId":0,"originName":"A","destinationName":"B"},
                {"publicId":"$d1","routePublicId":"$route13","variantCode":"D1","directionId":1,"originName":"B","destinationName":"A"}
              ],
              "stops": [],
              "routeStops": [],
              "routePaths": []
            }
            """.trimIndent(),
        )
        val snapshot = SnapshotValidator.validate(BootstrapJson.parseDataset(json))
        assertEquals(d1, OppositeVariantLookup.counterpart(snapshot.variants, d0)?.publicId)
        assertFalse(snapshot.variants.any { it.publicId == d1Lookalike })
    }

    private fun resolve(
        currentId: String,
        source: List<CacheVariantEntity> = variants,
        stops: List<OrderedStopRow> = if (currentId == d0) d1Stops else d0Stops,
        path: String = if (currentId == d0) d1Path else d0Path,
    ) = DirectionSwitchResolver.resolve(
        currentVariantPublicId = currentId,
        variants = source,
        selections = source.map {
            RouteSelectionRow(
                it.routePublicId,
                if (it.routePublicId == route13) "YBS-13" else "YBS-13A",
                it.publicId,
                it.variantCode,
                it.originName,
                it.destinationName,
                3,
            )
        },
        counterpartStops = stops,
        counterpartPathJson = path,
    )

    private fun variant(
        id: String,
        routeId: String,
        code: String,
        direction: Int,
        origin: String,
        destination: String,
    ) = CacheVariantEntity(id, routeId, code, direction, origin, destination)

    private fun stop(sequence: Int, id: String, variantId: String, lat: Double, lng: Double) =
        OrderedStopRow(sequence, id, null, null, null, lat, lng, variantId)
}
