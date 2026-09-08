package com.coremapmm.fieldsurveyor.ui.survey

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SurveySheetBehaviorTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun halfSheetExposesScrollableFormWithoutNestedVerticalScroll() {
        compose.setContent {
            var stage by remember { mutableStateOf(SurveySheetStage.STOPS) }
            val listState = rememberSaveable(saver = LazyListState.Saver) { LazyListState() }
            Box(Modifier.fillMaxSize()) {
                FourStageSurveySheet(
                    stage = stage,
                    onStageChange = { stage = it },
                    header = { drag, onToggle ->
                        Text(
                            "Header",
                            modifier = drag
                                .clickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = null,
                                    onClick = onToggle,
                                )
                                .testTag("drag_header"),
                        )
                    },
                    content = { visible ->
                        if (SurveySheetLayout.showsScrollableForm(visible)) {
                            LazyColumn(
                                state = listState,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .weight(1f)
                                    .testTag("form_list"),
                            ) {
                                items((1..20).toList()) { index ->
                                    Text("Field $index")
                                }
                                item { Text("Save action") }
                            }
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
        compose.onNodeWithTag("form_list").assertIsDisplayed()
        compose.onNodeWithText("Field 1").assertIsDisplayed()
        compose.onNodeWithTag("survey_sheet_drag_header").assertIsDisplayed()
    }

    @Test
    fun handleTapTogglesHalfAndFullWithoutClearingState() {
        var note = "kept-note"
        compose.setContent {
            var stage by rememberSaveable { mutableStateOf(SurveySheetStage.STOPS.name) }
            val current = SurveySheetStage.valueOf(stage)
            FourStageSurveySheet(
                stage = current,
                onStageChange = { stage = it.name },
                header = { drag, onToggle ->
                    Text(
                        "Route 20 · D0",
                        modifier = drag.clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = onToggle,
                        ),
                    )
                },
                content = { visible ->
                    Text("stage=${visible.name}")
                    Text(note)
                },
                modifier = Modifier.fillMaxSize(),
            )
        }
        compose.onNodeWithText("Route 20 · D0").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("stage=FULL").assertIsDisplayed()
        compose.onNodeWithText("kept-note").assertIsDisplayed()
        assertTrue(note == "kept-note")
        compose.onNodeWithText("Route 20 · D0").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("stage=STOPS").assertIsDisplayed()
    }

    @Test
    fun processRecreationRestoresSheetStageName() {
        val restored = SurveySheetStage.valueOf(SurveySheetStage.STOPS.name)
        assertEquals(SurveySheetStage.STOPS, restored)
        assertEquals(
            SurveySheetStage.FULL,
            SurveySheetLayout.toggleHalfFull(restored),
        )
    }
}
