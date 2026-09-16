package com.coremapmm.fieldsurveyor.survey

import android.app.Activity
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView

/** Screen stays awake only while survey tracking is Active. No permanent wake lock. */
object SurveyKeepScreenOn {
    fun enabled(trackingActive: Boolean): Boolean = trackingActive
}

@Composable
fun SurveyKeepScreenOnEffect(trackingActive: Boolean) {
    val view = LocalView.current
    DisposableEffect(trackingActive) {
        val window = (view.context as? Activity)?.window
        val enabled = SurveyKeepScreenOn.enabled(trackingActive)
        view.keepScreenOn = enabled
        if (enabled) {
            window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        onDispose {
            view.keepScreenOn = false
            window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }
}
