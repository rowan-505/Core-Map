package com.coremapmm.fieldsurveyor.ui.survey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveySheetLayoutTest {
    @Test
    fun threeAnchorsMatchOneThreeSixFractions() {
        assertEquals(1f / 6f, SurveySheetStage.MAP.visibleFraction, 0.0001f)
        assertEquals(3f / 6f, SurveySheetStage.STOPS.visibleFraction, 0.0001f)
        assertEquals(1f, SurveySheetStage.FULL.visibleFraction, 0.0001f)
        assertEquals(3, SurveySheetStage.entries.size)
    }

    @Test
    fun heightsKeepHalfMapAtHalfSheet() {
        val height = 600f
        assertEquals(100f, SurveySheetLayout.heightPx(SurveySheetStage.MAP, height), 0.01f)
        assertEquals(300f, SurveySheetLayout.heightPx(SurveySheetStage.STOPS, height), 0.01f)
        assertEquals(600f, SurveySheetLayout.heightPx(SurveySheetStage.FULL, height), 0.01f)
        assertEquals(0.5f, SurveySheetLayout.mapVisibleFraction(SurveySheetStage.STOPS), 0.0001f)
        assertEquals(500f, SurveySheetLayout.offset(SurveySheetStage.MAP, height), 0.01f)
        assertEquals(300f, SurveySheetLayout.offset(SurveySheetStage.STOPS, height), 0.01f)
        assertEquals(0f, SurveySheetLayout.offset(SurveySheetStage.FULL, height), 0.01f)
    }

    @Test
    fun dragSettlesAtNearestAnchor() {
        val height = 600f
        assertEquals(SurveySheetStage.MAP, SurveySheetLayout.nearest(540f, height))
        assertEquals(SurveySheetStage.STOPS, SurveySheetLayout.nearest(305f, height))
        assertEquals(SurveySheetStage.FULL, SurveySheetLayout.nearest(20f, height))
        assertEquals(SurveySheetStage.MAP, SurveySheetLayout.nearestByHeight(110f, height))
        assertEquals(SurveySheetStage.STOPS, SurveySheetLayout.nearestByHeight(290f, height))
        assertEquals(SurveySheetStage.FULL, SurveySheetLayout.nearestByHeight(580f, height))
    }

    @Test
    fun headerTapTogglesHalfAndFull() {
        assertEquals(SurveySheetStage.FULL, SurveySheetLayout.toggleHalfFull(SurveySheetStage.STOPS))
        assertEquals(SurveySheetStage.STOPS, SurveySheetLayout.toggleHalfFull(SurveySheetStage.FULL))
        assertEquals(SurveySheetStage.STOPS, SurveySheetLayout.toggleHalfFull(SurveySheetStage.MAP))
    }

    @Test
    fun scrollableFormAvailableAtHalfAndFull() {
        assertFalse(SurveySheetLayout.showsScrollableForm(SurveySheetStage.MAP))
        assertTrue(SurveySheetLayout.showsScrollableForm(SurveySheetStage.STOPS))
        assertTrue(SurveySheetLayout.showsScrollableForm(SurveySheetStage.FULL))
    }

    @Test
    fun gestureSeparationKeepsScrollAndMapIndependent() {
        assertFalse(SurveySheetGesturePolicy.formScrollChangesAnchor())
        assertFalse(SurveySheetGesturePolicy.mapGestureDragsSheet())
        assertFalse(SurveySheetGesturePolicy.sheetGesturePansMap())
        assertTrue(SurveySheetGesturePolicy.onlyHeaderDragsSheet())
        assertEquals(48f, SurveySheetGesturePolicy.headerDragHeightDp(), 0.01f)
    }

    @Test
    fun keyboardDoesNotAutoExpandSheet() {
        assertFalse(SurveySheetGesturePolicy.keyboardChangesSheetHeight())
    }

    @Test
    fun stateAndScrollPreservedAcrossAnchors() {
        assertTrue(SurveySheetGesturePolicy.preservesFormStateAcrossAnchors())
        assertTrue(SurveySheetGesturePolicy.preservesScrollAcrossAnchors())
    }

    @Test
    fun rotationRecreationRestoresStageByName() {
        SurveySheetStage.entries.forEach { stage ->
            assertEquals(stage, SurveySheetStage.valueOf(stage.name))
        }
    }
}
