package com.coremapmm.fieldsurveyor.ui.survey

import androidx.compose.animation.core.animate
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlinx.coroutines.launch

/**
 * Survey sheet anchors:
 * - [MAP] 1/6 compact peek
 * - [STOPS] 3/6 half map + scrollable form
 * - [FULL] 6/6 full form
 */
enum class SurveySheetStage(val visibleFraction: Float) {
    MAP(1f / 6f),
    STOPS(3f / 6f),
    FULL(1f),
}

internal object SurveySheetLayout {
    const val HEADER_DRAG_HEIGHT_DP = 48f

    fun heightPx(stage: SurveySheetStage, maxHeightPx: Float): Float =
        maxHeightPx * stage.visibleFraction

    fun offset(stage: SurveySheetStage, heightPx: Float): Float =
        heightPx * (1f - stage.visibleFraction)

    fun fractionForHeight(heightPx: Float, maxHeightPx: Float): Float {
        if (maxHeightPx <= 0f) return SurveySheetStage.MAP.visibleFraction
        return (heightPx / maxHeightPx).coerceIn(
            SurveySheetStage.MAP.visibleFraction,
            SurveySheetStage.FULL.visibleFraction,
        )
    }

    fun nearest(offsetPx: Float, heightPx: Float, velocityPx: Float = 0f): SurveySheetStage {
        val projected = (offsetPx + velocityPx * 0.08f).coerceIn(0f, heightPx)
        return SurveySheetStage.entries.minBy { abs(offset(it, heightPx) - projected) }
    }

    fun nearestByHeight(heightPx: Float, maxHeightPx: Float, velocityPx: Float = 0f): SurveySheetStage {
        val projected = (heightPx + (-velocityPx) * 0.08f).coerceIn(
            this.heightPx(SurveySheetStage.MAP, maxHeightPx),
            maxHeightPx,
        )
        return SurveySheetStage.entries.minBy { abs(this.heightPx(it, maxHeightPx) - projected) }
    }

    fun toggleHalfFull(stage: SurveySheetStage): SurveySheetStage = when (stage) {
        SurveySheetStage.FULL -> SurveySheetStage.STOPS
        SurveySheetStage.STOPS -> SurveySheetStage.FULL
        SurveySheetStage.MAP -> SurveySheetStage.STOPS
    }

    fun showsScrollableForm(stage: SurveySheetStage): Boolean =
        stage == SurveySheetStage.STOPS || stage == SurveySheetStage.FULL

    fun mapVisibleFraction(stage: SurveySheetStage): Float = 1f - stage.visibleFraction
}

/** Pure gesture policy — keeps form scroll and sheet drag separated. */
internal object SurveySheetGesturePolicy {
    fun formScrollChangesAnchor(): Boolean = false

    fun mapGestureDragsSheet(): Boolean = false

    fun sheetGesturePansMap(): Boolean = false

    fun keyboardChangesSheetHeight(): Boolean = false

    fun onlyHeaderDragsSheet(): Boolean = true

    fun headerDragHeightDp(): Float = SurveySheetLayout.HEADER_DRAG_HEIGHT_DP

    fun preservesFormStateAcrossAnchors(): Boolean = true

    fun preservesScrollAcrossAnchors(): Boolean = true
}

@Composable
fun FourStageSurveySheet(
    stage: SurveySheetStage,
    onStageChange: (SurveySheetStage) -> Unit,
    header: @Composable (dragModifier: Modifier, onHandleToggle: () -> Unit) -> Unit,
    content: @Composable ColumnScope.(SurveySheetStage) -> Unit,
    modifier: Modifier = Modifier,
    onVisibleFractionChange: (Float) -> Unit = {},
) {
    BoxWithConstraints(modifier) {
        val density = LocalDensity.current
        val maxHeightPx = with(density) { maxHeight.toPx() }.coerceAtLeast(1f)
        val scope = rememberCoroutineScope()
        var heightPx by remember(maxHeightPx) {
            mutableFloatStateOf(SurveySheetLayout.heightPx(stage, maxHeightPx))
        }

        fun settle(next: SurveySheetStage) {
            val target = SurveySheetLayout.heightPx(next, maxHeightPx)
            scope.launch {
                animate(heightPx, target) { value, _ ->
                    heightPx = value
                    onVisibleFractionChange(SurveySheetLayout.fractionForHeight(value, maxHeightPx))
                }
                onStageChange(next)
            }
        }

        LaunchedEffect(stage, maxHeightPx) {
            val target = SurveySheetLayout.heightPx(stage, maxHeightPx)
            if (abs(heightPx - target) > 1f) {
                animate(heightPx, target) { value, _ ->
                    heightPx = value
                    onVisibleFractionChange(SurveySheetLayout.fractionForHeight(value, maxHeightPx))
                }
            } else {
                onVisibleFractionChange(stage.visibleFraction)
            }
        }

        val dragState = rememberDraggableState { delta ->
            // Dragging the header down shrinks the sheet; up expands it.
            heightPx = (heightPx - delta).coerceIn(
                SurveySheetLayout.heightPx(SurveySheetStage.MAP, maxHeightPx),
                maxHeightPx,
            )
            onVisibleFractionChange(SurveySheetLayout.fractionForHeight(heightPx, maxHeightPx))
        }
        val visibleStage = SurveySheetLayout.nearestByHeight(heightPx, maxHeightPx)
        val sheetHeightDp = with(density) { heightPx.toDp() }

        Surface(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .height(sheetHeightDp)
                .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
                .testTag("survey_sheet"),
            color = MaterialTheme.colorScheme.surfaceContainer,
            tonalElevation = 2.dp,
            shadowElevation = 8.dp,
        ) {
            Column(Modifier.fillMaxWidth()) {
                header(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = SurveySheetLayout.HEADER_DRAG_HEIGHT_DP.dp)
                        .height(SurveySheetLayout.HEADER_DRAG_HEIGHT_DP.dp)
                        .testTag("survey_sheet_drag_header")
                        .draggable(
                            state = dragState,
                            orientation = Orientation.Vertical,
                            onDragStopped = { velocity ->
                                settle(SurveySheetLayout.nearestByHeight(heightPx, maxHeightPx, velocity))
                            },
                        ),
                ) {
                    settle(SurveySheetLayout.toggleHalfFull(stage))
                }
                content(visibleStage)
            }
        }
    }
}
