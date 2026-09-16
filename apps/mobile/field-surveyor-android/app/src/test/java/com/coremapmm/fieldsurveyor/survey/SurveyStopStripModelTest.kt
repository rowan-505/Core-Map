package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveyStopStripModelTest {
    @Test
    fun missingNamesUseUnnamedStopWithoutIds() {
        assertEquals(
            SurveyStopStripModel.UNNAMED_STOP,
            SurveyStopStripModel.displayName(null, null, preferMyanmar = true),
        )
        assertEquals("Sule", SurveyStopStripModel.displayName(null, "Sule", preferMyanmar = true))
        assertEquals("ဆူးလေ", SurveyStopStripModel.displayName("ဆူးလေ", "Sule", preferMyanmar = true))
        // English UI mode still prefers Myanmar when available.
        assertEquals("ဆူးလေ", SurveyStopStripModel.displayName("ဆူးလေ", "Sule", preferMyanmar = false))
        assertEquals("Sule", SurveyStopStripModel.displayName(null, "Sule", preferMyanmar = false))
    }

    @Test
    fun cardsExposeSelectionAndReportWithoutCreatingData() {
        val stops = listOf(
            stop(1, "a", "One"),
            stop(2, "b", "Two"),
            stop(3, "c", null),
        )
        val cards = SurveyStopStripModel.cards(
            stops = stops,
            selectedStopPublicId = "b",
            reportedStopIds = setOf("c"),
            preferMyanmar = true,
        )
        assertEquals(3, cards.size)
        assertEquals(SurveyStopCardState.NEUTRAL, cards[0].state)
        assertEquals(SurveyStopCardState.SELECTED, cards[1].state)
        assertEquals(SurveyStopCardState.REPORTED, cards[2].state)
        assertEquals(SurveyStopStripModel.UNNAMED_STOP, cards[2].displayName)
        assertEquals(1, SurveyStopStripModel.selectedIndex(cards))
        assertEquals(116f, SurveyStopStripModel.CARD_WIDTH_DP, 0.001f)
        assertEquals(68f, SurveyStopStripModel.CARD_HEIGHT_DP, 0.001f)
    }

    @Test
    fun longRouteKeepsAllOrderedCardsAndCentersMidIndex() {
        val stops = (1..40).map { stop(it, "s$it", "Stop $it") }
        val cards = SurveyStopStripModel.cards(
            stops = stops,
            selectedStopPublicId = "s20",
            reportedStopIds = emptySet(),
            preferMyanmar = true,
        )
        assertEquals(40, cards.size)
        assertEquals(19, SurveyStopStripModel.selectedIndex(cards))
        assertEquals(122, SurveyStopStripModel.centerItemStartOffset(360, 116))
        assertTrue(SurveyStopStripModel.centerScrollOffset(19, 40, 360, 116, 8) > 0)
    }

    @Test
    fun d0AndD1SequencesStayIsolated() {
        val d0 = listOf(stop(1, "d0-a", "D0 A", "d0"), stop(2, "d0-b", "D0 B", "d0"))
        val d1 = listOf(stop(1, "d1-a", "D1 A", "d1"), stop(2, "d1-b", "D1 B", "d1"))
        val d0Cards = SurveyStopStripModel.cards(d0, "d0-a", emptySet(), false)
        val d1Cards = SurveyStopStripModel.cards(d1, "d1-b", setOf("d1-b"), false)
        assertEquals(listOf("d0-a", "d0-b"), d0Cards.map { it.stopPublicId })
        assertEquals(listOf("d1-a", "d1-b"), d1Cards.map { it.stopPublicId })
        assertTrue(d1Cards[1].hasReport)
        assertFalse(d0Cards.any { it.stopPublicId.startsWith("d1") })
    }

    @Test
    fun reportedStopIdReadsStopTargetAndContext() {
        val moved = """{"target":{"entityType":"stop","publicId":"stop-1"},"context":{"stopPublicId":"stop-1","variantPublicId":"v0"}}"""
        val newStop = """{"target":{"entityType":"variant","publicId":"v0"},"context":{"previousStopPublicId":"stop-2","variantPublicId":"v0"}}"""
        val route = """{"target":{"entityType":"route","publicId":"route-1"},"context":{"variantPublicId":"v0"}}"""
        assertEquals("stop-1", SurveyStopStripModel.reportedStopPublicId(moved))
        assertEquals("stop-2", SurveyStopStripModel.reportedStopPublicId(newStop))
        assertEquals(null, SurveyStopStripModel.reportedStopPublicId(route))
        assertEquals(
            setOf("stop-1", "stop-2"),
            SurveyStopStripModel.reportedStopIdsFromPayloads(listOf(moved, newStop, route)),
        )
    }

    private fun stop(
        sequence: Int,
        id: String,
        nameEn: String?,
        variant: String = "d0",
    ) = OrderedStopRow(
        stopSequence = sequence,
        stopPublicId = id,
        stopCode = null,
        nameMy = null,
        nameEn = nameEn,
        lat = 16.8,
        lng = 96.1,
        variantPublicId = variant,
    )
}
