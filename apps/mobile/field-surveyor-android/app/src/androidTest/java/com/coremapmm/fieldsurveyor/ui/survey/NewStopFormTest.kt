package com.coremapmm.fieldsurveyor.ui.survey

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import com.coremapmm.fieldsurveyor.survey.GpsFix
import com.coremapmm.fieldsurveyor.survey.NewStopReportFlow
import com.coremapmm.fieldsurveyor.ui.settings.FieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.LocalFieldLanguage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NewStopFormTest {
    @get:Rule val compose = createComposeRule()

    private val previous = OrderedStopRow(4, "stop-1", "S4", null, "Corner", 16.8, 96.15)
    private val next = OrderedStopRow(5, "stop-2", "S5", null, "Next", 16.81, 96.16)

    @Test
    fun gpsSelectionShowsFrozenPointAndActions() {
        val draft = NewStopReportFlow.useMyLocation(
            NewStopReportFlow.withName(NewStopReportFlow.newDraft("id-1"), "Corner stall"),
            GpsFix(16.801, 96.151, 40f, 1_000L),
        )
        setForm(draft, gps = draft.proposed, nextStop = next)
        compose.onNodeWithText("Previous stop: #4 Corner", substring = true).assertExists()
        compose.onNodeWithText("Next stop: #5 Next", substring = true).assertExists()
        compose.onNodeWithText("Using GPS").assertExists()
        compose.onNodeWithTag("newStopRemove").assertExists()
        compose.onNodeWithTag("newStopChooseAgain").assertExists()
    }

    @Test
    fun weakGpsDoesNotDisableMapPick() {
        val draft = NewStopReportFlow.beginMapPick(NewStopReportFlow.newDraft("id-1"))
        setForm(draft, gps = null, nextStop = next)
        compose.onNodeWithTag("newStopUseMyLocation").assertIsNotEnabled()
        compose.onNodeWithTag("newStopChooseOnMap").assertIsEnabled()
        compose.onNodeWithText("Tap the map once to place the new stop.").assertExists()
    }

    @Test
    fun mapPickShowsRemoveAndChooseAgainWithoutMovingHintAfterSelection() {
        val selected = NewStopReportFlow.onMapTap(
            NewStopReportFlow.beginMapPick(NewStopReportFlow.newDraft("id-1")),
            16.9,
            96.2,
            2_000L,
        )
        setForm(selected, gps = null, nextStop = null)
        compose.onNodeWithText("Location from map").assertExists()
        compose.onNodeWithTag("newStopRemove").assertExists()
        compose.onNodeWithTag("newStopChooseAgain").assertExists()
        compose.onNodeWithText("Tap the map once to place the new stop.").assertDoesNotExist()
    }

    private fun setForm(
        draft: com.coremapmm.fieldsurveyor.survey.NewStopDraft,
        gps: GpsFix?,
        nextStop: OrderedStopRow?,
    ) {
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    NewStopForm(
                        draft = draft,
                        onDraft = {},
                        gps = gps,
                        previousStop = previous,
                        nextStop = nextStop,
                        sequences = listOf(4, 5),
                        onChooseOnMap = {},
                    )
                }
            }
        }
    }
}
