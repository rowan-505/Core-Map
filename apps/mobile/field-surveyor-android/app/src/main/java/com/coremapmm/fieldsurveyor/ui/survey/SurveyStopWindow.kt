package com.coremapmm.fieldsurveyor.ui.survey

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import com.coremapmm.fieldsurveyor.survey.StopSequenceDisplay
import com.coremapmm.fieldsurveyor.survey.StopWindow
import com.coremapmm.fieldsurveyor.ui.settings.FieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.LocalFieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.tr

private val CurrentStopGreen = Color(0xFF1B7F3A)
private val CurrentStopGreenContainer = Color(0xFFE3F5E9)

internal object StopWindowDisplay {
    fun sequenceLabel(stop: OrderedStopRow?, sequences: List<Int>): String {
        if (stop == null) return "—"
        return StopSequenceDisplay.uiLabel(stop.stopSequence, sequences)
    }

    fun accessibilityLabel(title: String, stop: OrderedStopRow?, sequences: List<Int>, name: String?): String {
        if (stop == null) return "$title, empty"
        return "$title, ${sequenceLabel(stop, sequences)}, ${name ?: "—"}"
    }
}

@Composable
internal fun StopWindowRow(
    window: StopWindow,
    sequences: List<Int>,
    onSelect: (String) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        StopChoiceButton(
            title = "Previous",
            stop = window.previous,
            selected = false,
            sequences = sequences,
            modifier = Modifier.weight(1f),
            onClick = { window.previous?.let { onSelect(it.stopPublicId) } },
        )
        StopChoiceButton(
            title = "Current",
            stop = window.current,
            selected = true,
            sequences = sequences,
            modifier = Modifier.weight(1f),
            onClick = { window.current?.let { onSelect(it.stopPublicId) } },
        )
        StopChoiceButton(
            title = "Next",
            stop = window.next,
            selected = false,
            sequences = sequences,
            modifier = Modifier.weight(1f),
            onClick = { window.next?.let { onSelect(it.stopPublicId) } },
        )
    }
}

@Composable
private fun StopChoiceButton(
    title: String,
    stop: OrderedStopRow?,
    selected: Boolean,
    sequences: List<Int>,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val name = stop?.let { stopDisplayName(it) }
    val sequenceText = StopWindowDisplay.sequenceLabel(stop, sequences)
    val description = StopWindowDisplay.accessibilityLabel(tr(title), stop, sequences, name)
    val colors = when {
        selected && stop != null -> ButtonDefaults.outlinedButtonColors(
            containerColor = CurrentStopGreenContainer,
            contentColor = CurrentStopGreen,
        )
        stop != null -> ButtonDefaults.outlinedButtonColors(
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        else -> ButtonDefaults.outlinedButtonColors(
            disabledContainerColor = MaterialTheme.colorScheme.surface,
            disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    OutlinedButton(
        onClick = onClick,
        enabled = stop != null,
        modifier = modifier
            .heightIn(min = 64.dp)
            .semantics { contentDescription = description },
        shape = RoundedCornerShape(12.dp),
        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 6.dp),
        colors = colors,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
            modifier = Modifier.padding(vertical = 1.dp),
        ) {
            Text(
                tr(title),
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                if (stop == null) "—" else sequenceText,
                style = MaterialTheme.typography.labelMedium,
                maxLines = 1,
            )
            if (stop != null) {
                Text(
                    name ?: "—",
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

@Composable
internal fun stopDisplayName(stop: OrderedStopRow): String {
    val name = if (LocalFieldLanguage.current == FieldLanguage.MYANMAR) {
        stop.nameMy ?: stop.nameEn
    } else {
        stop.nameEn ?: stop.nameMy
    }
    return name ?: stop.stopCode ?: "—"
}
