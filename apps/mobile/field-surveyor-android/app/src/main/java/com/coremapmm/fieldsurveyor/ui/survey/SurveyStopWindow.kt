package com.coremapmm.fieldsurveyor.ui.survey

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import com.coremapmm.fieldsurveyor.survey.SurveyStopCardModel
import com.coremapmm.fieldsurveyor.survey.SurveyStopCardState
import com.coremapmm.fieldsurveyor.survey.SurveyStopStripModel
import com.coremapmm.fieldsurveyor.ui.settings.tr

private val SelectedGreen = Color(0xFF1B7F3A)
private val SelectedGreenContainer = Color(0xFFE3F5E9)
private val ReportAmber = Color(0xFFE65100)

@Composable
internal fun SurveyStopStrip(
    stops: List<OrderedStopRow>,
    selectedStopPublicId: String?,
    reportedStopIds: Set<String>,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    listState: LazyListState = rememberLazyListState(),
) {
    val preferMyanmar = true
    val cards = remember(stops, selectedStopPublicId, reportedStopIds) {
        SurveyStopStripModel.cards(
            stops = stops,
            selectedStopPublicId = selectedStopPublicId,
            reportedStopIds = reportedStopIds,
            preferMyanmar = preferMyanmar,
        )
    }
    val selectedIndex = SurveyStopStripModel.selectedIndex(cards)
    val density = LocalDensity.current
    val spacingDp = 8.dp
    val cardWidthDp = SurveyStopStripModel.CARD_WIDTH_DP.dp

    BoxWithConstraints(modifier.fillMaxWidth()) {
        val viewportPx = with(density) { maxWidth.roundToPx() }
        val itemPx = with(density) { cardWidthDp.roundToPx() }
        val spacingPx = with(density) { spacingDp.roundToPx() }

        LaunchedEffect(selectedIndex, cards.size, viewportPx) {
            if (selectedIndex < 0 || cards.isEmpty()) return@LaunchedEffect
            val startOffset = SurveyStopStripModel.centerItemStartOffset(viewportPx, itemPx)
            listState.animateScrollToItem(selectedIndex, scrollOffset = -startOffset)
            val itemInfo = listState.layoutInfo.visibleItemsInfo.firstOrNull { it.index == selectedIndex }
            if (itemInfo != null) {
                val viewportCenter =
                    (listState.layoutInfo.viewportStartOffset + listState.layoutInfo.viewportEndOffset) / 2
                val itemCenter = itemInfo.offset + itemInfo.size / 2
                listState.animateScrollBy((itemCenter - viewportCenter).toFloat())
            }
        }

        LazyRow(
            state = listState,
            modifier = Modifier
                .fillMaxWidth()
                .testTag("survey_stop_strip"),
            contentPadding = PaddingValues(horizontal = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(spacingDp),
        ) {
            itemsIndexed(
                items = cards,
                key = { _, card -> card.stopPublicId },
            ) { index, card ->
                SurveyStopStripCard(
                    card = card,
                    onClick = { onSelect(card.stopPublicId) },
                    modifier = Modifier
                        .width(cardWidthDp)
                        .testTag("survey_stop_card_$index"),
                )
            }
        }
    }
}

@Composable
private fun SurveyStopStripCard(
    card: SurveyStopCardModel,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val description = buildString {
        append(card.sequenceLabel)
        append(", ")
        append(card.displayName)
        if (card.selected) append(", selected")
        if (card.hasReport) append(", has report")
    }
    val container = when (card.state) {
        SurveyStopCardState.SELECTED -> SelectedGreenContainer
        SurveyStopCardState.REPORTED -> Color(0xFFFFF3E0)
        SurveyStopCardState.NEUTRAL -> MaterialTheme.colorScheme.surface
    }
    val content = when (card.state) {
        SurveyStopCardState.SELECTED -> SelectedGreen
        SurveyStopCardState.REPORTED -> ReportAmber
        SurveyStopCardState.NEUTRAL -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val border = when (card.state) {
        SurveyStopCardState.SELECTED -> BorderStroke(2.dp, SelectedGreen)
        SurveyStopCardState.REPORTED -> BorderStroke(1.5.dp, ReportAmber)
        SurveyStopCardState.NEUTRAL -> BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    }
    Surface(
        onClick = onClick,
        modifier = modifier
            .height(SurveyStopStripModel.CARD_HEIGHT_DP.dp)
            .semantics { contentDescription = description },
        shape = RoundedCornerShape(10.dp),
        color = container,
        contentColor = content,
        border = border,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    card.sequenceLabel,
                    style = MaterialTheme.typography.labelMedium,
                    maxLines = 1,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (card.hasReport) {
                        Text(
                            "!",
                            style = MaterialTheme.typography.labelSmall,
                            color = ReportAmber,
                            modifier = Modifier.testTag("survey_stop_report"),
                        )
                    }
                }
            }
            Text(
                tr(card.displayName),
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** Prefer Myanmar names in every language mode; never expose technical stop IDs. */
@Composable
internal fun stopDisplayName(stop: OrderedStopRow): String {
    return SurveyStopStripModel.displayName(stop.nameMy, stop.nameEn, preferMyanmar = true)
}

// Kept for sticky-banner / form helpers that still show sequence labels.
internal object StopWindowDisplay {
    fun sequenceLabel(stop: OrderedStopRow?, sequences: List<Int>): String {
        if (stop == null) return "—"
        return com.coremapmm.fieldsurveyor.survey.StopSequenceDisplay.uiLabel(stop.stopSequence, sequences)
    }
}
