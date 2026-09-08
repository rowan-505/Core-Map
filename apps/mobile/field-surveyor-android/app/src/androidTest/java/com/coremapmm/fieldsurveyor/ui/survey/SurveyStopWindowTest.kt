package com.coremapmm.fieldsurveyor.ui.survey

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import com.coremapmm.fieldsurveyor.survey.StopContext
import com.coremapmm.fieldsurveyor.ui.settings.FieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.LocalFieldLanguage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SurveyStopWindowTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun threeBoxesShowSequenceAndNameWithoutIconsOrHashZero() {
        val stops = listOf(
            OrderedStopRow(1, "a", "S1", null, "Sule", 16.80, 96.15, "d0"),
            OrderedStopRow(2, "b", "S2", null, "Hledan", 16.81, 96.16, "d0"),
            OrderedStopRow(3, "c", "S3", null, "Insein", 16.82, 96.17, "d0"),
        )
        val window = StopContext.window(stops, "b")
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    StopWindowRow(window, stops.map { it.stopSequence }, onSelect = {})
                }
            }
        }
        compose.onNodeWithText("#1").assertIsDisplayed()
        compose.onNodeWithText("#2").assertIsDisplayed()
        compose.onNodeWithText("#3").assertIsDisplayed()
        compose.onNodeWithText("Sule").assertIsDisplayed()
        compose.onNodeWithText("Hledan").assertIsDisplayed()
        compose.onNodeWithText("Insein").assertIsDisplayed()
        compose.onNodeWithContentDescription("Previous, #1, Sule").assertIsDisplayed()
        compose.onNodeWithContentDescription("Selected, #2, Hledan").assertIsDisplayed()
        compose.onNodeWithContentDescription("Next, #3, Insein").assertIsDisplayed()
        compose.onNodeWithText("#0").assertDoesNotExist()
    }

    @Test
    fun firstStopEmptyPreviousShowsSingleDash() {
        val stops = listOf(
            OrderedStopRow(1, "a", "S1", null, "Sule", 16.80, 96.15, "d0"),
            OrderedStopRow(2, "b", "S2", null, "Hledan", 16.81, 96.16, "d0"),
        )
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    StopWindowRow(StopContext.window(stops, "a"), stops.map { it.stopSequence }, onSelect = {})
                }
            }
        }
        compose.onNodeWithContentDescription("Previous, empty").assertIsDisplayed()
        compose.onAllNodesWithText("—").assertCountEquals(1)
        compose.onNodeWithText("#1").assertIsDisplayed()
        compose.onNodeWithText("#0").assertDoesNotExist()
    }
}
