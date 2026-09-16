package com.coremapmm.fieldsurveyor.ui.survey

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.platform.testTag
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coremapmm.fieldsurveyor.survey.SurveyNotify
import com.coremapmm.fieldsurveyor.survey.SurveyNotifyCopy
import com.coremapmm.fieldsurveyor.survey.SurveyNotifyEvent
import com.coremapmm.fieldsurveyor.survey.SurveyNotifyTone
import com.coremapmm.fieldsurveyor.ui.settings.FieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.LocalFieldLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SurveyNotifyHostComposeTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setHost(initial: SurveyNotifyEvent) {
        var event by mutableStateOf<SurveyNotifyEvent?>(initial)
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    Box(Modifier.fillMaxSize().testTag("survey_notify_root")) {
                        SurveyNotifyHost(
                            event = event,
                            onConsumed = { event = null },
                        )
                    }
                }
            }
        }
    }

    @Test
    fun notificationIsAnUpperOverlayRatherThanABottomSheetChild() {
        setHost(SurveyNotify.warning("Start the survey first.", id = 9))
        compose.waitUntil(timeoutMillis = 3_000) {
            compose.onAllNodesWithText("Start the survey first.").fetchSemanticsNodes().isNotEmpty()
        }
        val root = compose.onNodeWithTag("survey_notify_root").fetchSemanticsNode().boundsInRoot
        val host = compose.onNodeWithTag("survey_notify_host").fetchSemanticsNode().boundsInRoot
        assertTrue(host.top < root.height / 4f)
        assertTrue(host.width <= root.width * 0.91f)
    }

    @Test
    fun showsSuccessReportSavedOnce() {
        setHost(SurveyNotify.success(SurveyNotifyCopy.REPORT_SAVED, id = 1))
        compose.waitUntil(timeoutMillis = 3_000) {
            compose.onAllNodesWithText(SurveyNotifyCopy.REPORT_SAVED)
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose.onNodeWithText(SurveyNotifyCopy.REPORT_SAVED).assertIsDisplayed()
        compose.onNodeWithTag("survey_notify_host").assertIsDisplayed()
        assertEquals(1_500L, SurveyNotifyCopy.SUCCESS_MS)
    }

    @Test
    fun showsOfflineSavePending() {
        setHost(SurveyNotify.offline(id = 2))
        compose.waitUntil(timeoutMillis = 3_000) {
            compose.onAllNodesWithText(SurveyNotifyCopy.SAVED_OFFLINE)
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose.onNodeWithText(SurveyNotifyCopy.SAVED_OFFLINE).assertIsDisplayed()
    }

    @Test
    fun showsFailureWithRetryAction() {
        setHost(SurveyNotify.afterRoomFailure(id = 3))
        compose.waitUntil(timeoutMillis = 3_000) {
            compose.onAllNodesWithText(SurveyNotifyCopy.SAVE_FAILED)
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose.onNodeWithText(SurveyNotifyCopy.SAVE_FAILED).assertIsDisplayed()
        compose.onNodeWithText(SurveyNotifyCopy.RETRY).assertIsDisplayed()
        assertEquals(3_000L, SurveyNotifyCopy.FAILURE_MS)
    }

    @Test
    fun startSurveyFirstIsAmberWarning() {
        val event = SurveyNotify.warning("Start the survey first.", id = 4)
        assertEquals(SurveyNotifyTone.WARNING, event.tone)
        assertEquals(2_000L, event.durationMs)
        setHost(event)
        compose.waitUntil(timeoutMillis = 3_000) {
            compose.onAllNodesWithText("Start the survey first.")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose.onNodeWithText("Start the survey first.").assertIsDisplayed()
        assertTrue(SurveyNotifyCopy.WARNING_MS == 2_000L)
    }
}
