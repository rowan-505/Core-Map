package com.coremapmm.fieldsurveyor.ui.survey

import android.content.res.Configuration
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import com.coremapmm.fieldsurveyor.survey.StopContext
import com.coremapmm.fieldsurveyor.survey.StopSequenceDisplay
import com.coremapmm.fieldsurveyor.ui.settings.FieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.LocalFieldLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
        compose.onNodeWithText("Previous").assertIsDisplayed()
        compose.onNodeWithText("Current").assertIsDisplayed()
        compose.onNodeWithText("Next").assertIsDisplayed()
        compose.onNodeWithText("#1").assertIsDisplayed()
        compose.onNodeWithText("#2").assertIsDisplayed()
        compose.onNodeWithText("#3").assertIsDisplayed()
        compose.onNodeWithText("Sule").assertIsDisplayed()
        compose.onNodeWithText("Hledan").assertIsDisplayed()
        compose.onNodeWithText("Insein").assertIsDisplayed()
        compose.onNodeWithContentDescription("Previous, #1, Sule").assertIsDisplayed()
        compose.onNodeWithContentDescription("Current, #2, Hledan").assertIsDisplayed()
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

    @Test
    fun finalStopEmptyNextShowsDash() {
        val stops = listOf(
            OrderedStopRow(10, "a", null, null, "Alpha", 16.80, 96.15, "d0"),
            OrderedStopRow(20, "b", null, null, "Beta", 16.81, 96.16, "d0"),
        )
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    StopWindowRow(StopContext.window(stops, "b"), stops.map { it.stopSequence }, onSelect = {})
                }
            }
        }
        compose.onNodeWithContentDescription("Next, empty").assertIsDisplayed()
        compose.onNodeWithText("#20").assertIsDisplayed()
        compose.onNodeWithText("#0").assertDoesNotExist()
    }

    @Test
    fun sparseNonContiguousSequencesKeepStoredValuesAndNeverShowHashZero() {
        val stops = listOf(
            OrderedStopRow(2, "a", null, null, "Two", 16.80, 96.15, "d0"),
            OrderedStopRow(7, "b", null, null, "Seven", 16.81, 96.16, "d0"),
            OrderedStopRow(15, "c", null, null, "Fifteen", 16.82, 96.17, "d0"),
        )
        val sequences = stops.map { it.stopSequence }
        assertEquals("#2", StopSequenceDisplay.uiLabel(2, sequences))
        assertEquals("#7", StopSequenceDisplay.uiLabel(7, sequences))
        assertEquals("#15", StopSequenceDisplay.uiLabel(15, sequences))
        assertEquals(2, stops[0].stopSequence)
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    StopWindowRow(StopContext.window(stops, "b"), sequences, onSelect = {})
                }
            }
        }
        compose.onNodeWithText("#2").assertIsDisplayed()
        compose.onNodeWithText("#7").assertIsDisplayed()
        compose.onNodeWithText("#15").assertIsDisplayed()
        compose.onNodeWithText("#0").assertDoesNotExist()
    }

    @Test
    fun directionIsolationShowsOnlySelectedVariantWindow() {
        val d1 = listOf(
            OrderedStopRow(1, "d1-a", null, null, "D1 First", 16.80, 96.15, "d1"),
            OrderedStopRow(2, "d1-b", null, null, "D1 Second", 16.81, 96.16, "d1"),
        )
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    StopWindowRow(StopContext.window(d1, "d1-a"), d1.map { it.stopSequence }, onSelect = {})
                }
            }
        }
        compose.onNodeWithText("D1 First").assertIsDisplayed()
        compose.onNodeWithText("D1 Second").assertIsDisplayed()
        compose.onNodeWithText("D0 First").assertDoesNotExist()
    }

    @Test
    fun longBurmeseNamesRemainVisibleWithoutHashZero() {
        val longName = "ဗိုလ်တထောင်ဘူတာရုံအနီးရှိအဓိကလမ်းထောင့်မှတ်တိုင်ကြီး"
        val stops = listOf(
            OrderedStopRow(1, "a", null, longName, null, 16.80, 96.15, "d0"),
            OrderedStopRow(2, "b", null, "လက်ရှိမှတ်တိုင်", null, 16.81, 96.16, "d0"),
            OrderedStopRow(3, "c", null, "နောက်မှတ်တိုင်", null, 16.82, 96.17, "d0"),
        )
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.MYANMAR) {
                MaterialTheme {
                    StopWindowRow(StopContext.window(stops, "b"), stops.map { it.stopSequence }, onSelect = {})
                }
            }
        }
        compose.onNodeWithText("လက်ရှိမှတ်တိုင်").assertIsDisplayed()
        compose.onNodeWithText("#0").assertDoesNotExist()
        assertFalse(StopWindowDisplay.sequenceLabel(stops[0], stops.map { it.stopSequence }) == "#0")
    }

    @Test
    fun largeFontScaleStillShowsTitlesAndSequences() {
        val stops = listOf(
            OrderedStopRow(1, "a", null, null, "One", 16.80, 96.15, "d0"),
            OrderedStopRow(2, "b", null, null, "Two", 16.81, 96.16, "d0"),
            OrderedStopRow(3, "c", null, null, "Three", 16.82, 96.17, "d0"),
        )
        compose.setContent {
            val base = LocalConfiguration.current
            val scaled = Configuration(base).apply { fontScale = 1.6f }
            CompositionLocalProvider(
                LocalFieldLanguage provides FieldLanguage.ENGLISH,
                LocalConfiguration provides scaled,
            ) {
                MaterialTheme {
                    StopWindowRow(StopContext.window(stops, "b"), stops.map { it.stopSequence }, onSelect = {})
                }
            }
        }
        compose.onNodeWithText("Previous").assertIsDisplayed()
        compose.onNodeWithText("Current").assertIsDisplayed()
        compose.onNodeWithText("Next").assertIsDisplayed()
        compose.onNodeWithText("#2").assertIsDisplayed()
        compose.onNodeWithText("#0").assertDoesNotExist()
    }
}
