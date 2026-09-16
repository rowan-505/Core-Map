package com.coremapmm.fieldsurveyor.ui.survey

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coremapmm.fieldsurveyor.survey.AnomalyKind
import com.coremapmm.fieldsurveyor.survey.SurveyLocationStatus
import com.coremapmm.fieldsurveyor.ui.settings.FieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.LocalFieldLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SurveyStickyBannerComposeTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun stickyBannerShowsFinishNextToStartWithoutReportTotals() {
        var started = false
        var finishToggled = false
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    SurveyStickySummaryBanner(
                        routeTitle = "YBS-1 · D0",
                        oppositeVariantCode = "D1",
                        directionSwitchEnabled = true,
                        showDirectionSwitch = true,
                        onDirectionSwitch = {},
                        running = false,
                        onStart = { started = true },
                        onStop = {},
                        variantFinished = false,
                        finishEnabled = true,
                        onToggleFinished = { finishToggled = true },
                        stopLine = "#1 Sule",
                        gpsLabel = "Weak GPS · ±40m",
                        gpsStatus = SurveyLocationStatus.Degraded,
                        reportSummary = SurveyStickyBannerModel.reportSummary(
                            SurveyStickyBannerModel.selectedKinds(AnomalyKind.MOVED),
                            newStopHasMapPosition = false,
                        ),
                        pendingSyncLabel = SurveyStickyBannerModel.pendingSyncLabel(3),
                        dragModifier = Modifier.testTag("banner_drag"),
                        onHandleToggle = {},
                    )
                }
            }
        }
        compose.onNodeWithTag("survey_fixed_header").assertIsDisplayed()
        compose.onNodeWithText("YBS-1 · D0").assertIsDisplayed()
        compose.onNodeWithText("#1 Sule · Moved").assertIsDisplayed()
        compose.onNodeWithText("Weak GPS · ±40m").assertIsDisplayed()
        compose.onNodeWithTag("survey_sticky_row_report").assertDoesNotExist()
        compose.onNodeWithText("3 pending").assertIsDisplayed()
        compose.onNodeWithText("Start").assertIsDisplayed()
        compose.onNodeWithTag("survey_sticky_finish").assertIsDisplayed()
        compose.onNodeWithText("Finish").assertIsDisplayed()
        compose.onNodeWithText("0 pending").assertDoesNotExist()
        compose.onNodeWithText("reports", substring = true).assertDoesNotExist()
        compose.onNodeWithText("End survey").assertDoesNotExist()
        compose.onNodeWithTag("survey_end_or_start").assertIsEnabled().performClick()
        compose.waitForIdle()
        assertEquals(true, started)
        compose.onNodeWithTag("survey_sticky_finish").performClick()
        compose.waitForIdle()
        assertTrue(finishToggled)
    }

    @Test
    fun newStopMapPositionAndEmptyPendingAreHidden() {
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    SurveyStickySummaryBanner(
                        routeTitle = "YBS-13 · D1",
                        oppositeVariantCode = "D0",
                        directionSwitchEnabled = true,
                        showDirectionSwitch = true,
                        onDirectionSwitch = {},
                        running = true,
                        onStart = {},
                        onStop = {},
                        variantFinished = true,
                        finishEnabled = true,
                        onToggleFinished = {},
                        stopLine = "#2 Hledan",
                        gpsLabel = "GPS ±8m",
                        gpsStatus = SurveyLocationStatus.Live,
                        reportSummary = SurveyStickyBannerModel.reportSummary(
                            listOf(AnomalyKind.NEW_STOP),
                            newStopHasMapPosition = true,
                        ),
                        pendingSyncLabel = SurveyStickyBannerModel.pendingSyncLabel(0),
                        dragModifier = Modifier,
                        onHandleToggle = {},
                    )
                }
            }
        }
        compose.onNodeWithText("YBS-13 · D1").assertIsDisplayed()
        compose.onNodeWithText("#2 Hledan · New stop · Map position selected").assertIsDisplayed()
        compose.onNodeWithText("Stop").assertIsDisplayed()
        compose.onNodeWithText("✓ Finished").assertIsDisplayed()
        compose.onNodeWithTag("survey_sticky_pending_sync").assertDoesNotExist()
        compose.onNodeWithText("0 pending").assertDoesNotExist()
    }

    @Test
    fun stickyHeaderStaysPinnedWhileFormScrollsAtHalfSheet() {
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    var stage by remember { mutableStateOf(SurveySheetStage.STOPS) }
                    Box(Modifier.fillMaxSize()) {
                        FourStageSurveySheet(
                            stage = stage,
                            onStageChange = { stage = it },
                            header = { drag, onToggle ->
                                SurveyStickySummaryBanner(
                                    routeTitle = "YBS-1 · D0",
                                    oppositeVariantCode = "D1",
                                    directionSwitchEnabled = true,
                                    showDirectionSwitch = true,
                                    onDirectionSwitch = {},
                                    running = false,
                                    onStart = {},
                                    onStop = {},
                                    variantFinished = false,
                                    finishEnabled = true,
                                    onToggleFinished = {},
                                    stopLine = SurveyStickyBannerModel.NO_STOP,
                                    gpsLabel = "Finding GPS…",
                                    gpsStatus = SurveyLocationStatus.Acquiring,
                                    reportSummary = StickyReportSummary.Empty(
                                        SurveyStickyBannerModel.NO_REPORT_TYPE,
                                    ),
                                    pendingSyncLabel = null,
                                    dragModifier = drag,
                                    onHandleToggle = onToggle,
                                )
                            },
                            content = { visible ->
                                if (SurveySheetLayout.showsScrollableForm(visible)) {
                                    LazyColumn(Modifier.weight(1f).testTag("sticky_form_list")) {
                                        items((1..24).toList()) { Text("Form row $it") }
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                }
            }
        }
        compose.onNodeWithTag("survey_fixed_header").assertIsDisplayed()
        compose.onNodeWithTag("sticky_form_list").assertIsDisplayed()
        compose.onNodeWithText("Select a stop").assertIsDisplayed()
        compose.onNodeWithText("Form row 1").assertIsDisplayed()
        assertFalse(SurveySheetGesturePolicy.formScrollChangesAnchor())
        compose.onNodeWithTag("survey_sticky_row_report").assertDoesNotExist()
        compose.onNodeWithTag("survey_sticky_finish").assertIsDisplayed()
    }
}
