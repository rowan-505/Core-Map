package com.coremapmm.fieldsurveyor.ui.survey

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import com.coremapmm.fieldsurveyor.survey.AnomalyKind
import com.coremapmm.fieldsurveyor.survey.AnomalyMapping
import com.coremapmm.fieldsurveyor.survey.DirectionSwitchPolicy
import com.coremapmm.fieldsurveyor.survey.StopSequenceDisplay
import com.coremapmm.fieldsurveyor.survey.SurveyLocationStatus
import com.coremapmm.fieldsurveyor.ui.components.StatusPill
import com.coremapmm.fieldsurveyor.ui.settings.tr

private val StartGreen = Color(0xFF1B7F3A)
private val StartGreenContainer = Color(0xFFE3F5E9)
private val StopRed = Color(0xFFC62828)
private val GpsMint = Color(0xFFE8F5E9)

/**
 * Pure sticky-banner copy rules. Maximum two content rows in the fixed header.
 */
internal object SurveyStickyBannerModel {
    const val START_STOP_WIDTH_DP = 88f
    const val START_STOP_HEIGHT_DP = 44f
    const val FINISH_WIDTH_DP = 76f
    const val DIRECTION_HEIGHT_DP = 36f
    const val TARGET_HEADER_HEIGHT_DP = 88f
    const val MAX_VISIBLE_OPTION_CHIPS = 2
    const val SELECT_A_STOP = "Select a stop"
    const val NEW_STOP_MAP_POSITION = "New stop · Map position selected"
    /** @deprecated Use [SELECT_A_STOP] for empty sticky row. */
    const val NO_REPORT_TYPE = SELECT_A_STOP
    /** @deprecated Use [SELECT_A_STOP] for empty sticky row. */
    const val NO_STOP = SELECT_A_STOP
    const val SINGLE_OPTION_ONLY = true

    fun routeTitle(routeCode: String?, variantCode: String?): String {
        if (routeCode.isNullOrBlank() || variantCode.isNullOrBlank()) {
            return "Select a D0/D1 variant"
        }
        return "$routeCode · $variantCode"
    }

    fun stopLine(
        stop: OrderedStopRow?,
        sequences: List<Int>,
        displayName: String?,
    ): String {
        if (stop == null) return SELECT_A_STOP
        val sequence = StopSequenceDisplay.uiLabel(stop.stopSequence, sequences)
        val name = displayName?.trim().orEmpty().ifBlank { "—" }
        return "$sequence $name"
    }

    fun selectedKinds(kind: AnomalyKind?): List<AnomalyKind> =
        if (kind == null) emptyList() else listOf(kind)

    fun reportSummary(
        selectedKinds: List<AnomalyKind>,
        newStopHasMapPosition: Boolean,
        maxVisible: Int = MAX_VISIBLE_OPTION_CHIPS,
        singleOptionOnly: Boolean = SINGLE_OPTION_ONLY,
    ): StickyReportSummary {
        val kinds = if (singleOptionOnly) selectedKinds.take(1) else selectedKinds
        if (kinds.isEmpty()) {
            return StickyReportSummary.Empty(SELECT_A_STOP)
        }
        val primary = kinds.first()
        if (primary == AnomalyKind.NEW_STOP && newStopHasMapPosition) {
            return StickyReportSummary.Special(NEW_STOP_MAP_POSITION)
        }
        val labels = kinds.map { AnomalyMapping.displayLabel(it) }
        val visible = labels.take(maxVisible.coerceAtLeast(0))
        val overflow = (labels.size - visible.size).coerceAtLeast(0)
        return StickyReportSummary.Chips(visible, overflow)
    }

    /** Row-2 summary: `#n name · ReportType` or a single empty hint. */
    fun secondaryLine(stopLine: String, reportSummary: StickyReportSummary): String {
        val emptyStop = stopLine == SELECT_A_STOP || stopLine == NO_STOP
        val reportLabel = when (reportSummary) {
            is StickyReportSummary.Empty -> null
            is StickyReportSummary.Special -> reportSummary.label
            is StickyReportSummary.Chips -> reportSummary.labels.firstOrNull()
        }
        return when {
            emptyStop && reportLabel == null -> SELECT_A_STOP
            emptyStop -> reportLabel!!
            reportLabel == null -> stopLine
            else -> "$stopLine · $reportLabel"
        }
    }

    fun pendingSyncLabel(pendingCount: Int): String? =
        if (pendingCount > 0) "$pendingCount pending" else null
}

internal sealed class StickyReportSummary {
    data class Empty(val label: String) : StickyReportSummary()
    data class Special(val label: String) : StickyReportSummary()
    data class Chips(val labels: List<String>, val overflowCount: Int) : StickyReportSummary()
}

@Composable
internal fun SurveyStickySummaryBanner(
    routeTitle: String,
    oppositeVariantCode: String?,
    directionSwitchEnabled: Boolean,
    showDirectionSwitch: Boolean,
    onDirectionSwitch: () -> Unit,
    running: Boolean,
    sessionTransitionBusy: Boolean = false,
    onStart: () -> Unit,
    onStop: () -> Unit,
    variantFinished: Boolean,
    finishEnabled: Boolean,
    onToggleFinished: () -> Unit,
    stopLine: String,
    gpsLabel: String,
    gpsStatus: SurveyLocationStatus,
    reportSummary: StickyReportSummary,
    pendingSyncLabel: String?,
    dragModifier: Modifier,
    onHandleToggle: () -> Unit,
) {
    val secondary = SurveyStickyBannerModel.secondaryLine(stopLine, reportSummary)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .testTag("survey_fixed_header"),
    ) {
        Column(
            dragModifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 2.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier
                    .size(width = 40.dp, height = 14.dp)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onHandleToggle,
                    )
                    .testTag("survey_sheet_handle"),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier
                        .size(width = 36.dp, height = 3.dp)
                        .background(
                            MaterialTheme.colorScheme.onSurfaceVariant,
                            RoundedCornerShape(100.dp),
                        ),
                )
            }

            // Row 1: route · D0/D1 · Start/Stop · Finish (dashboard work status)
            Row(
                Modifier.fillMaxWidth().testTag("survey_sticky_row_route"),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    tr(routeTitle),
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontSize = 17.sp,
                        fontWeight = FontWeight.SemiBold,
                        lineHeight = 20.sp,
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).testTag("survey_sticky_route_title"),
                )
                if (showDirectionSwitch) {
                    OutlinedButton(
                        onClick = onDirectionSwitch,
                        enabled = directionSwitchEnabled,
                        modifier = Modifier
                            .height(SurveyStickyBannerModel.DIRECTION_HEIGHT_DP.dp)
                            .testTag("survey_direction_switch"),
                        border = BorderStroke(1.dp, StartGreen),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = StartGreen,
                        ),
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                    ) {
                        Text(
                            DirectionSwitchPolicy.buttonLabel(oppositeVariantCode),
                            style = MaterialTheme.typography.labelSmall,
                            maxLines = 1,
                        )
                    }
                }
                if (running) {
                    Button(
                        onClick = onStop,
                        enabled = !sessionTransitionBusy,
                        modifier = Modifier
                            .width(SurveyStickyBannerModel.START_STOP_WIDTH_DP.dp)
                            .height(SurveyStickyBannerModel.START_STOP_HEIGHT_DP.dp)
                            .testTag("survey_end_or_start"),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = StopRed,
                            contentColor = Color.White,
                        ),
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
                    ) {
                        Text(
                            tr("Stop"),
                            style = MaterialTheme.typography.labelMedium,
                            maxLines = 1,
                            textAlign = TextAlign.Center,
                        )
                    }
                } else {
                    Button(
                        onClick = onStart,
                        enabled = !sessionTransitionBusy,
                        modifier = Modifier
                            .width(SurveyStickyBannerModel.START_STOP_WIDTH_DP.dp)
                            .height(SurveyStickyBannerModel.START_STOP_HEIGHT_DP.dp)
                            .testTag("survey_end_or_start"),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = StartGreen,
                            contentColor = Color.White,
                            disabledContainerColor = StartGreenContainer,
                            disabledContentColor = StartGreen,
                        ),
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
                    ) {
                        Text(
                            tr("Start"),
                            style = MaterialTheme.typography.labelMedium,
                            maxLines = 1,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
                OutlinedButton(
                    onClick = onToggleFinished,
                    enabled = finishEnabled,
                    modifier = Modifier
                        .widthIn(min = SurveyStickyBannerModel.FINISH_WIDTH_DP.dp)
                        .height(SurveyStickyBannerModel.START_STOP_HEIGHT_DP.dp)
                        .testTag("survey_sticky_finish"),
                    border = BorderStroke(
                        1.dp,
                        if (variantFinished) StartGreen else MaterialTheme.colorScheme.outline,
                    ),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = if (variantFinished) StartGreen else MaterialTheme.colorScheme.onSurface,
                    ),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                ) {
                    Text(
                        tr(if (variantFinished) "✓ Finished" else "Finish"),
                        style = MaterialTheme.typography.labelMedium,
                        maxLines = 1,
                        textAlign = TextAlign.Center,
                    )
                }
            }

            // Row 2: stop · report · GPS (and optional pending)
            Row(
                Modifier.fillMaxWidth().testTag("survey_sticky_row_stop"),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    tr(secondary),
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontSize = 13.sp,
                        lineHeight = 16.sp,
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).testTag("survey_sticky_stop_line"),
                )
                pendingSyncLabel?.let { label ->
                    Text(
                        tr(label),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        modifier = Modifier.testTag("survey_sticky_pending_sync"),
                    )
                }
                StatusPill(
                    tr(gpsLabel),
                    positive = gpsStatus == SurveyLocationStatus.Live,
                    warning = gpsStatus == SurveyLocationStatus.Degraded ||
                        gpsStatus == SurveyLocationStatus.Stale,
                    blockingError = gpsStatus == SurveyLocationStatus.Disabled ||
                        gpsStatus == SurveyLocationStatus.PermissionDenied ||
                        gpsStatus == SurveyLocationStatus.Unavailable,
                    modifier = Modifier
                        .background(GpsMint, RoundedCornerShape(8.dp))
                        .testTag("survey_gps_status"),
                )
            }
        }
    }
}
