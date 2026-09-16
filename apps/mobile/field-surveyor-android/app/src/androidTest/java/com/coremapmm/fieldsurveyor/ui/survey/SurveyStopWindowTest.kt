package com.coremapmm.fieldsurveyor.ui.survey

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import com.coremapmm.fieldsurveyor.ui.settings.FieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.LocalFieldLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SurveyStopWindowTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun stripShowsAllOrderedStopsWithSequenceAndName() {
        val stops = listOf(
            OrderedStopRow(1, "a", "S1", null, "Sule", 16.80, 96.15, "d0"),
            OrderedStopRow(2, "b", "S2", null, "Hledan", 16.81, 96.16, "d0"),
            OrderedStopRow(3, "c", "S3", null, "Insein", 16.82, 96.17, "d0"),
        )
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    SurveyStopStrip(
                        stops = stops,
                        selectedStopPublicId = "b",
                        reportedStopIds = setOf("c"),
                        onSelect = {},
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
        compose.onNodeWithTag("survey_stop_strip").assertIsDisplayed()
        compose.onAllNodesWithTag("survey_stop_card_0", useUnmergedTree = true).assertCountEquals(1)
        compose.onNodeWithText("#1").assertIsDisplayed()
        compose.onNodeWithText("#2").assertIsDisplayed()
        compose.onNodeWithText("#3").assertIsDisplayed()
        compose.onNodeWithText("Sule").assertIsDisplayed()
        compose.onNodeWithText("Hledan").assertIsDisplayed()
        compose.onNodeWithText("Insein").assertIsDisplayed()
        compose.onNodeWithContentDescription("#2, Hledan, selected").assertIsDisplayed()
        compose.onNodeWithText("#0").assertDoesNotExist()
        compose.onNodeWithText("Previous").assertDoesNotExist()
        compose.onNodeWithText("Current").assertDoesNotExist()
        compose.onNodeWithText("Next").assertDoesNotExist()
    }

    @Test
    fun tapSelectsStopWithoutMarkingCorrect() {
        var selected: String? = "a"
        val stops = listOf(
            OrderedStopRow(1, "a", null, null, "One", 16.80, 96.15, "d0"),
            OrderedStopRow(2, "b", null, null, "Two", 16.81, 96.16, "d0"),
        )
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    var current by remember { mutableStateOf(selected) }
                    SurveyStopStrip(
                        stops = stops,
                        selectedStopPublicId = current,
                        reportedStopIds = emptySet(),
                        onSelect = {
                            selected = it
                            current = it
                        },
                    )
                }
            }
        }
        compose.onNodeWithText("Two").performClick()
        compose.waitForIdle()
        assertEquals("b", selected)
        compose.onNodeWithContentDescription("#2, Two, selected").assertIsDisplayed()
    }

    @Test
    fun missingNamesShowUnnamedStopWithoutTechnicalIds() {
        val stops = listOf(
            OrderedStopRow(1, "uuid-hidden", "CODE-1", null, null, 16.80, 96.15, "d0"),
        )
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    SurveyStopStrip(
                        stops = stops,
                        selectedStopPublicId = "uuid-hidden",
                        reportedStopIds = emptySet(),
                        onSelect = {},
                    )
                }
            }
        }
        compose.onNodeWithText("Unnamed stop").assertIsDisplayed()
        compose.onNodeWithText("uuid-hidden").assertDoesNotExist()
        compose.onNodeWithText("CODE-1").assertDoesNotExist()
    }

    @Test
    fun longRouteRendersLazyCardsForSelectedVariantOnly() {
        val d0 = (1..30).map {
            OrderedStopRow(it, "d0-$it", null, null, "D0 $it", 16.8, 96.1, "d0")
        }
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    SurveyStopStrip(
                        stops = d0,
                        selectedStopPublicId = "d0-15",
                        reportedStopIds = emptySet(),
                        onSelect = {},
                    )
                }
            }
        }
        compose.onNodeWithTag("survey_stop_strip").assertIsDisplayed()
        compose.onNodeWithText("D0 15").assertIsDisplayed()
        compose.onNodeWithText("D1 1").assertDoesNotExist()
        assertFalse(d0.any { it.variantPublicId != "d0" })
    }

    @Test
    fun d1IsolationDoesNotShowD0Names() {
        val d1 = listOf(
            OrderedStopRow(1, "d1-a", null, null, "D1 First", 16.80, 96.15, "d1"),
            OrderedStopRow(2, "d1-b", null, null, "D1 Second", 16.81, 96.16, "d1"),
        )
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    SurveyStopStrip(
                        stops = d1,
                        selectedStopPublicId = "d1-a",
                        reportedStopIds = emptySet(),
                        onSelect = {},
                    )
                }
            }
        }
        compose.onNodeWithText("D1 First").assertIsDisplayed()
        compose.onNodeWithText("D0 First").assertDoesNotExist()
    }
}
