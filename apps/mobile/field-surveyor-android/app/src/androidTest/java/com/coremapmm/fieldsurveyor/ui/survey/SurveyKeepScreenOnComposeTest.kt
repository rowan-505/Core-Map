package com.coremapmm.fieldsurveyor.ui.survey

import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coremapmm.fieldsurveyor.survey.SurveyKeepScreenOnEffect
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SurveyKeepScreenOnComposeTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun windowKeepScreenOn(): Boolean {
        val flags = compose.activity.window.attributes.flags
        return flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON != 0
    }

    @Test
    fun finishReleasesKeepScreenOn() {
        compose.setContent {
            var running by remember { mutableStateOf(true) }
            SurveyKeepScreenOnEffect(trackingActive = running)
            Button(
                onClick = { running = false },
                modifier = Modifier.testTag("finish_stop"),
            ) {
                Text("Finish")
            }
        }
        compose.waitForIdle()
        assertTrue(windowKeepScreenOn())

        compose.onNodeWithTag("finish_stop").performClick()
        compose.waitForIdle()
        assertFalse(windowKeepScreenOn())
    }

    @Test
    fun normalStopReleasesKeepScreenOn() {
        compose.setContent {
            var running by remember { mutableStateOf(true) }
            SurveyKeepScreenOnEffect(trackingActive = running)
            Button(
                onClick = { running = false },
                modifier = Modifier.testTag("stop"),
            ) {
                Text("Stop")
            }
        }
        compose.waitForIdle()
        assertTrue(windowKeepScreenOn())

        compose.onNodeWithTag("stop").performClick()
        compose.waitForIdle()
        assertFalse(windowKeepScreenOn())
    }

    @Test
    fun leavingSurveyScreenClearsKeepScreenOn() {
        val showSurvey = mutableStateOf(true)
        compose.setContent {
            if (showSurvey.value) {
                SurveyKeepScreenOnEffect(trackingActive = true)
                Button(
                    onClick = { showSurvey.value = false },
                    modifier = Modifier.testTag("leave_survey"),
                ) {
                    Text("Leave")
                }
            }
        }
        compose.waitForIdle()
        assertTrue(windowKeepScreenOn())

        compose.onNodeWithTag("leave_survey").performClick()
        compose.waitForIdle()
        assertFalse(windowKeepScreenOn())
    }
}
