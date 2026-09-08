package com.coremapmm.fieldsurveyor.ui.report

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.coremapmm.fieldsurveyor.survey.AnomalyKind
import com.coremapmm.fieldsurveyor.survey.AnomalyMapping
import com.coremapmm.fieldsurveyor.survey.GpsFix
import com.coremapmm.fieldsurveyor.survey.NewStopReportFlow
import com.coremapmm.fieldsurveyor.ui.settings.tr

private val CoreMapGreen = Color(0xFF1B7F3A)
private val CoreMapGreenContainer = Color(0xFFE3F5E9)

@Composable
internal fun ReportTypeSelector(
    selected: AnomalyKind?,
    onSelect: (AnomalyKind) -> Unit,
    modifier: Modifier = Modifier,
) {
    val kinds = AnomalyMapping.reportIssueKinds()
    Column(
        modifier = modifier.fillMaxWidth().testTag("report_type_selector"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        kinds.chunked(3).forEach { row ->
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                row.forEach { kind ->
                    ReportTypeChip(
                        kind = kind,
                        selected = selected == kind,
                        onClick = { onSelect(kind) },
                        modifier = Modifier.weight(1f),
                    )
                }
                repeat(3 - row.size) {
                    Surface(modifier = Modifier.weight(1f), color = Color.Transparent) {}
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReportTypeChip(
    kind: AnomalyKind,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val label = tr(AnomalyMapping.displayLabel(kind))
    Surface(
        onClick = onClick,
        modifier = modifier
            .heightIn(min = 48.dp)
            .testTag("report_type_${kind.name}"),
        shape = RoundedCornerShape(12.dp),
        color = if (selected) CoreMapGreenContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
        contentColor = if (selected) CoreMapGreen else MaterialTheme.colorScheme.onSurface,
        border = if (selected) {
            BorderStroke(1.5.dp, CoreMapGreen)
        } else {
            null
        },
    ) {
        Text(
            text = label,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 6.dp, vertical = 10.dp),
            style = MaterialTheme.typography.labelMedium,
            textAlign = TextAlign.Center,
            maxLines = 2,
            softWrap = true,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
internal fun ProposedLocationControls(
    proposed: GpsFix?,
    picking: Boolean,
    gps: GpsFix?,
    onUseMyLocation: () -> Unit,
    onChooseOnMap: () -> Unit,
    onRemove: () -> Unit,
    onChooseAgain: () -> Unit,
    pickingHint: String = "Tap the map once.",
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().testTag("proposed_location_controls"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (proposed == null) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = onUseMyLocation,
                    enabled = gps != null,
                    modifier = Modifier
                        .weight(1f)
                        .heightIn(min = 48.dp)
                        .testTag("newStopUseMyLocation"),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
                ) {
                    Text(
                        tr("Use my location"),
                        style = MaterialTheme.typography.labelMedium,
                        maxLines = 2,
                        softWrap = true,
                        textAlign = TextAlign.Center,
                    )
                }
                OutlinedButton(
                    onClick = onChooseOnMap,
                    modifier = Modifier
                        .weight(1f)
                        .heightIn(min = 48.dp)
                        .testTag("newStopChooseOnMap"),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
                ) {
                    Text(
                        tr("Choose on map"),
                        style = MaterialTheme.typography.labelMedium,
                        maxLines = 2,
                        softWrap = true,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        } else {
            Text(
                tr(NewStopReportFlow.locationSelectedLabel(proposed)),
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("location_selected_label"),
            )
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(
                    onClick = onRemove,
                    modifier = Modifier
                        .heightIn(min = 48.dp)
                        .testTag("newStopRemove"),
                ) { Text(tr("Remove")) }
                TextButton(
                    onClick = onChooseAgain,
                    modifier = Modifier
                        .heightIn(min = 48.dp)
                        .testTag("newStopChooseAgain"),
                ) { Text(tr("Choose again")) }
            }
        }
        if (picking) {
            Text(
                tr(pickingHint),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.testTag("location_pick_hint"),
            )
        }
    }
}
