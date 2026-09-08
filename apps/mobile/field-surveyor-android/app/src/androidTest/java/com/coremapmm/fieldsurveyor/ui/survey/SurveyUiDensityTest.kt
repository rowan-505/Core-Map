package com.coremapmm.fieldsurveyor.ui.survey

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coremapmm.fieldsurveyor.data.transport.RouteSelectionRow
import com.coremapmm.fieldsurveyor.data.transport.RouteSyncUi
import com.coremapmm.fieldsurveyor.data.transport.RouteSyncUiState
import com.coremapmm.fieldsurveyor.survey.AnomalyKind
import com.coremapmm.fieldsurveyor.survey.AnomalyMapping
import com.coremapmm.fieldsurveyor.survey.NearbyRouteState
import com.coremapmm.fieldsurveyor.ui.components.StatusPill
import com.coremapmm.fieldsurveyor.ui.report.ReportTypeSelector
import com.coremapmm.fieldsurveyor.ui.routes.NearbyRecommendPanel
import com.coremapmm.fieldsurveyor.ui.routes.RouteSyncStatusRow
import com.coremapmm.fieldsurveyor.ui.settings.FieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.LocalFieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.tr
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SurveyUiDensityTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun routeListShowsCodeDirectionAndStopCountWithoutIds() {
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    Column(Modifier.testTag("route_list")) {
                        Text("13 · D0")
                        Text("Sule → Hledan")
                        Text("8 stops")
                    }
                }
            }
        }
        compose.onNodeWithTag("route_list").assertIsDisplayed()
        compose.onNodeWithText("13 · D0").assertIsDisplayed()
        compose.onNodeWithText("8 stops").assertIsDisplayed()
        assertTrue(RouteSelectionRow("r", "13", "v", "D0", "A", "B", 8).routeCode == "13")
    }

    @Test
    fun syncSuccessAndFailureWithCacheShowDistinctLabels() {
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    Column {
                        RouteSyncStatusRow(
                            state = RouteSyncUiState.UpToDate(19, "rev-hidden"),
                            onTryAgain = {},
                            modifier = Modifier.testTag("sync_success"),
                        )
                        RouteSyncStatusRow(
                            state = RouteSyncUiState.FailedWithCache(19, "rev-hidden"),
                            onTryAgain = {},
                            modifier = Modifier.testTag("sync_fail_cache"),
                        )
                        RouteSyncStatusRow(
                            state = RouteSyncUiState.OfflineWithCache(19, "rev-hidden"),
                            onTryAgain = {},
                            modifier = Modifier.testTag("sync_offline_cache"),
                        )
                    }
                }
            }
        }
        compose.onNodeWithText(RouteSyncUi.LABEL_UP_TO_DATE).assertIsDisplayed()
        compose.onNodeWithText(RouteSyncUi.LABEL_FAILED_WITH_CACHE).assertIsDisplayed()
        compose.onNodeWithText(RouteSyncUi.LABEL_OFFLINE_WITH_CACHE).assertIsDisplayed()
        compose.onNodeWithText("rev-hidden").assertDoesNotExist()
        assertTrue(RouteSyncUi.hasUsableCache(RouteSyncUiState.FailedWithCache(19, "rev-hidden")))
    }

    @Test
    fun halfAndFullSurveySheetAnchorsExposeForm() {
        compose.setContent {
            var stage by remember { mutableStateOf(SurveySheetStage.STOPS) }
            Box(Modifier.fillMaxSize()) {
                FourStageSurveySheet(
                    stage = stage,
                    onStageChange = { stage = it },
                    header = { drag, _ ->
                        Text(
                            "20 · D0",
                            modifier = drag.testTag("sheet_title"),
                        )
                        androidx.compose.material3.TextButton(
                            onClick = { stage = SurveySheetLayout.toggleHalfFull(stage) },
                            modifier = Modifier.testTag("sheet_toggle"),
                        ) { Text("Toggle") }
                    },
                    content = { visible ->
                        Text("stage=${visible.name}", modifier = Modifier.testTag("sheet_stage"))
                        if (SurveySheetLayout.showsScrollableForm(visible)) {
                            LazyColumn(Modifier.weight(1f).testTag("sheet_form")) {
                                item { Text(EvidenceUi.SECTION_TITLE) }
                                item { Text(EvidenceUi.SAVE, modifier = Modifier.testTag("save_action")) }
                            }
                        }
                    },
                    modifier = Modifier.fillMaxSize().testTag("survey_sheet_host"),
                )
            }
        }
        compose.onNodeWithTag("sheet_form").assertIsDisplayed()
        compose.onNodeWithText("stage=STOPS").assertIsDisplayed()
        compose.onNodeWithTag("sheet_toggle").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("stage=FULL").assertIsDisplayed()
        compose.onNodeWithTag("save_action").assertIsDisplayed()
        compose.onNodeWithTag("sheet_toggle").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("stage=STOPS").assertIsDisplayed()
    }

    @Test
    fun everyReportTypeChipIsPresent() {
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    ReportTypeSelector(selected = null, onSelect = {})
                }
            }
        }
        AnomalyMapping.reportIssueKinds().forEach { kind ->
            compose.onNodeWithTag("report_type_${kind.name}").assertIsDisplayed()
            compose.onNodeWithTag("report_type_${kind.name}").assertIsEnabled()
        }
        assertEquals(6, AnomalyMapping.reportIssueKinds().size)
        assertTrue(AnomalyKind.NEW_STOP in AnomalyMapping.reportIssueKinds())
    }

    @Test
    fun evidenceSectionShowsCompactActionsAndSummary() {
        assertEquals("1 photo · 12-sec voice", EvidenceUi.summary(1, 12_000L))
        assertEquals("2 photos", EvidenceUi.summary(2, null))
        assertNull(EvidenceUi.summary(0, null))
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    Column(Modifier.testTag("evidence_block")) {
                        Text(tr(EvidenceUi.SECTION_TITLE))
                        Text(tr(EvidenceUi.summary(1, 12_000L)!!), Modifier.testTag("evidence_summary"))
                        Text(tr(EvidenceUi.PHOTO), Modifier.testTag("evidence_photo"))
                        Text(tr(EvidenceUi.HOLD_TO_RECORD), Modifier.testTag("evidence_voice"))
                        Text(tr(EvidenceUi.SAVE), Modifier.testTag("save_action"))
                    }
                }
            }
        }
        compose.onNodeWithText("Evidence · Optional").assertIsDisplayed()
        compose.onNodeWithText("1 photo · 12-sec voice").assertIsDisplayed()
        compose.onNodeWithText("Photo").assertIsDisplayed()
        compose.onNodeWithText("Hold to record").assertIsDisplayed()
        compose.onNodeWithText("Save").assertIsDisplayed()
    }

    @Test
    fun keyboardOpenKeepsImePaddingAndSaveVisible() {
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    Column(
                        Modifier
                            .fillMaxSize()
                            .imePadding()
                            .testTag("keyboard_form"),
                    ) {
                        BasicTextField(
                            value = "note",
                            onValueChange = {},
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("note_field"),
                        )
                        Text(
                            EvidenceUi.SAVE,
                            modifier = Modifier
                                .heightIn(min = 48.dp)
                                .testTag("save_action"),
                        )
                    }
                }
            }
        }
        compose.onNodeWithTag("note_field").assertIsDisplayed()
        compose.onNodeWithTag("save_action").assertIsDisplayed()
    }

    @Test
    fun longBurmeseLabelsAndLargeFontRemainReadable() {
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.MYANMAR) {
                MaterialTheme {
                    Column(Modifier.testTag("long_labels")) {
                        Text(tr("Evidence · Optional"), fontSize = 22.sp, maxLines = 3)
                        Text(tr("Update failed · Using saved routes"), fontSize = 22.sp, maxLines = 3)
                        Text(tr("Hold to record"), fontSize = 22.sp, maxLines = 2)
                        StatusPill(tr("Couldn't download routes"), blockingError = true)
                    }
                }
            }
        }
        compose.onNodeWithText("အထောက်အထား · မထည့်လည်းရသည်").assertIsDisplayed()
        compose.onNodeWithText("အပ်ဒိတ်မအောင်မြင် · သိမ်းထားသောလမ်းကြောင်းများ သုံးနေသည်").assertIsDisplayed()
        compose.onNodeWithText("ဖိထားပြီး အသံဖမ်းပါ").assertIsDisplayed()
        compose.onNodeWithText("လမ်းကြောင်းများ ရယူ၍မရပါ").assertIsDisplayed()
    }

    @Test
    fun offlineNearbyStateIsCompact() {
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    NearbyRecommendPanel(
                        state = NearbyRouteState.NoLocation,
                        onSelect = {},
                    )
                }
            }
        }
        compose.onNodeWithText("No location yet").assertIsDisplayed()
        compose.onNodeWithText("coordinate", substring = true).assertDoesNotExist()
    }
}
