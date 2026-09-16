package com.coremapmm.fieldsurveyor.ui.survey

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coremapmm.fieldsurveyor.survey.ReportSaveReset
import com.coremapmm.fieldsurveyor.ui.settings.FieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.LocalFieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.tr
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReportSaveResetUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun successShowsOnlyLocalSaveBanners() {
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    Column(Modifier.testTag("banners")) {
                        Text(tr(ReportSaveReset.successBanner(true)), Modifier.testTag("online_banner"))
                        Text(tr(ReportSaveReset.successBanner(false)), Modifier.testTag("offline_banner"))
                        Text(tr(ReportSaveReset.END_OF_ROUTE), Modifier.testTag("end_of_route"))
                    }
                }
            }
        }
        compose.onNodeWithText("Report saved").assertIsDisplayed()
        compose.onNodeWithText("Saved offline — sync pending").assertIsDisplayed()
        compose.onNodeWithText("Last stop on this direction.").assertIsDisplayed()
        compose.onNodeWithText("✓ Captured").assertDoesNotExist()
    }

    @Test
    fun roomFailureKeepsDraftCleanupGuarded() {
        assertFalse(ReportSaveReset.shouldClearDraftMedia(false))
        assertTrue(ReportSaveReset.shouldClearDraftMedia(true))
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    Text(
                        tr(ReportSaveReset.ROOM_SAVE_FAILED),
                        Modifier.testTag("room_error"),
                    )
                }
            }
        }
        compose.onNodeWithTag("room_error").assertIsDisplayed()
        compose.onNodeWithText("Could not save").assertIsDisplayed()
    }

    @Test
    fun compactInitialStageIsMapPeek() {
        assertTrue(SurveySheetStage.MAP.visibleFraction < SurveySheetStage.STOPS.visibleFraction)
        assertFalse(SurveySheetLayout.showsScrollableForm(SurveySheetStage.MAP))
        assertTrue(SurveySheetLayout.showsScrollableForm(SurveySheetStage.STOPS))
    }
}
