package com.coremapmm.fieldsurveyor.ui.survey

import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.coremapmm.fieldsurveyor.survey.SurveyNotifyEvent
import com.coremapmm.fieldsurveyor.survey.SurveyNotifyTone
import com.coremapmm.fieldsurveyor.ui.settings.LocalFieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.translateFieldText
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val SuccessGreen = Color(0xFF1B7F3A)
private val SuccessOnGreen = Color(0xFFFFFFFF)
private val WarningAmber = Color(0xFFF9A825)
private val WarningOnAmber = Color(0xFF212121)
private val FailureRed = Color(0xFFC62828)
private val FailureOnRed = Color(0xFFFFFFFF)
private val InfoSurface = Color(0xFF37474F)
private val InfoOnSurface = Color(0xFFFFFFFF)

/**
 * Compact floating snackbar over the upper map edge.
 * Newer events replace the current one immediately (no queue overlap).
 */
@Composable
fun BoxScope.SurveyNotifyHost(
    event: SurveyNotifyEvent?,
    onConsumed: (Long) -> Unit,
    onAction: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val hostState = remember { SnackbarHostState() }
    var activeTone by remember { mutableStateOf(SurveyNotifyTone.INFO) }
    val language = LocalFieldLanguage.current
    val scope = rememberCoroutineScope()
    var showJob by remember { mutableStateOf<Job?>(null) }

    LaunchedEffect(event?.id) {
        val next = event ?: return@LaunchedEffect
        // Consume first so parent state clears, but show on a scope job that
        // is not cancelled when [event] becomes null.
        onConsumed(next.id)
        showJob?.cancel()
        hostState.currentSnackbarData?.dismiss()
        showJob = scope.launch {
            activeTone = next.tone
            val dismissJob = launch {
                delay(next.durationMs)
                hostState.currentSnackbarData?.dismiss()
            }
            try {
                val result = hostState.showSnackbar(
                    message = translateFieldText(next.message, language),
                    actionLabel = next.actionLabel?.let { translateFieldText(it, language) },
                    withDismissAction = false,
                    duration = SnackbarDuration.Indefinite,
                )
                if (result == SnackbarResult.ActionPerformed) {
                    next.actionKey?.let(onAction)
                }
            } finally {
                dismissJob.cancel()
            }
        }
    }

    SnackbarHost(
        hostState = hostState,
        modifier = modifier
            .align(Alignment.TopCenter)
            .padding(start = 16.dp, end = 16.dp, top = 10.dp)
            .fillMaxWidth(0.9f)
            .widthIn(max = 420.dp)
            .testTag("survey_notify_host"),
    ) { data ->
        val container = when (activeTone) {
            SurveyNotifyTone.SUCCESS -> SuccessGreen
            SurveyNotifyTone.WARNING, SurveyNotifyTone.OFFLINE -> WarningAmber
            SurveyNotifyTone.FAILURE -> FailureRed
            SurveyNotifyTone.INFO -> InfoSurface
        }
        val content = when (activeTone) {
            SurveyNotifyTone.SUCCESS -> SuccessOnGreen
            SurveyNotifyTone.WARNING, SurveyNotifyTone.OFFLINE -> WarningOnAmber
            SurveyNotifyTone.FAILURE -> FailureOnRed
            SurveyNotifyTone.INFO -> InfoOnSurface
        }
        Snackbar(
            modifier = Modifier
                .heightIn(min = 44.dp, max = 52.dp)
                .semantics {
                    contentDescription = data.visuals.message
                    liveRegion = LiveRegionMode.Polite
                }
                .testTag("survey_notify_snackbar"),
            shape = RoundedCornerShape(12.dp),
            containerColor = container.copy(alpha = 0.92f),
            contentColor = content,
            actionContentColor = content,
            action = data.visuals.actionLabel?.let { label ->
                {
                    TextButton(onClick = { data.performAction() }) {
                        Text(label)
                    }
                }
            },
        ) {
            Text(data.visuals.message, maxLines = 1)
        }
    }
}
