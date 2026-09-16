package com.coremapmm.fieldsurveyor.ui.survey

import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import com.coremapmm.fieldsurveyor.survey.AnomalyKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveyStickyBannerTest {
    @Test
    fun routeTitleUsesCodeAndDirectionWithoutIds() {
        assertEquals("YBS-1 · D0", SurveyStickyBannerModel.routeTitle("YBS-1", "D0"))
        assertEquals("Select a D0/D1 variant", SurveyStickyBannerModel.routeTitle(null, null))
    }

    @Test
    fun stopLineUsesSequenceAndNameWithoutCoordinates() {
        val stop = OrderedStopRow(
            stopSequence = 2,
            stopPublicId = "11111111-1111-4111-8111-111111111111",
            stopCode = "S2",
            nameMy = "ဆူးလေ",
            nameEn = "Sule",
            lat = 16.77,
            lng = 96.15,
        )
        assertEquals(
            "#3 Sule",
            SurveyStickyBannerModel.stopLine(stop, listOf(0, 1, 2), "Sule"),
        )
        assertEquals(
            SurveyStickyBannerModel.SELECT_A_STOP,
            SurveyStickyBannerModel.stopLine(null, emptyList(), null),
        )
    }

    @Test
    fun secondaryLineMergesStopAndReportInTwoRowHeader() {
        assertEquals(
            "Select a stop",
            SurveyStickyBannerModel.secondaryLine(
                SurveyStickyBannerModel.SELECT_A_STOP,
                StickyReportSummary.Empty(SurveyStickyBannerModel.SELECT_A_STOP),
            ),
        )
        assertEquals(
            "#2 ဆူးလေ · Moved",
            SurveyStickyBannerModel.secondaryLine(
                "#2 ဆူးလေ",
                StickyReportSummary.Chips(listOf("Moved"), 0),
            ),
        )
        assertEquals(
            "#2 ဆူးလေ",
            SurveyStickyBannerModel.secondaryLine(
                "#2 ဆူးလေ",
                StickyReportSummary.Empty(SurveyStickyBannerModel.SELECT_A_STOP),
            ),
        )
    }

    @Test
    fun reportSummaryPreservesSingleOptionAndNewStopMapText() {
        assertEquals(
            StickyReportSummary.Empty(SurveyStickyBannerModel.SELECT_A_STOP),
            SurveyStickyBannerModel.reportSummary(emptyList(), newStopHasMapPosition = false),
        )
        assertEquals(
            StickyReportSummary.Chips(listOf("Moved"), 0),
            SurveyStickyBannerModel.reportSummary(
                SurveyStickyBannerModel.selectedKinds(AnomalyKind.MOVED),
                newStopHasMapPosition = false,
            ),
        )
        assertEquals(
            StickyReportSummary.Special(SurveyStickyBannerModel.NEW_STOP_MAP_POSITION),
            SurveyStickyBannerModel.reportSummary(
                listOf(AnomalyKind.NEW_STOP),
                newStopHasMapPosition = true,
            ),
        )
    }

    @Test
    fun reportSummaryOverflowShowsAtMostTwoChipsPlusCount() {
        val summary = SurveyStickyBannerModel.reportSummary(
            selectedKinds = listOf(AnomalyKind.MOVED, AnomalyKind.MISSING, AnomalyKind.DATA),
            newStopHasMapPosition = false,
            maxVisible = 2,
            singleOptionOnly = false,
        )
        assertEquals(StickyReportSummary.Chips(listOf("Moved", "Missing"), 1), summary)
    }

    @Test
    fun pendingSyncHiddenWhenZeroAndStartStopIsCompact() {
        assertNull(SurveyStickyBannerModel.pendingSyncLabel(0))
        assertEquals("2 pending", SurveyStickyBannerModel.pendingSyncLabel(2))
        assertEquals(76f, SurveyStickyBannerModel.FINISH_WIDTH_DP, 0.001f)
        assertEquals(88f, SurveyStickyBannerModel.START_STOP_WIDTH_DP, 0.001f)
        assertEquals(44f, SurveyStickyBannerModel.START_STOP_HEIGHT_DP, 0.001f)
        assertTrue(SurveyStickyBannerModel.TARGET_HEADER_HEIGHT_DP in 80f..90f)
    }
}
