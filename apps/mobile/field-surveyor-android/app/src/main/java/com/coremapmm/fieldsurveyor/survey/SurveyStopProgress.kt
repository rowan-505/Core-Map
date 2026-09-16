package com.coremapmm.fieldsurveyor.survey

import org.json.JSONObject

enum class SurveyStopCardState {
    NEUTRAL,
    SELECTED,
    REPORTED,
}

data class SurveyStopCardModel(
    val stopPublicId: String,
    val sequenceLabel: String,
    val displayName: String,
    val selected: Boolean,
    val hasReport: Boolean,
) {
    val state: SurveyStopCardState
        get() = when {
            selected -> SurveyStopCardState.SELECTED
            hasReport -> SurveyStopCardState.REPORTED
            else -> SurveyStopCardState.NEUTRAL
        }
}

object SurveyStopStripModel {
    const val UNNAMED_STOP = "Unnamed stop"
    const val CARD_WIDTH_DP = 116f
    const val CARD_HEIGHT_DP = 68f

    /** Always prefer Myanmar; fall back to English only when Myanmar is missing. */
    fun displayName(nameMy: String?, nameEn: String?, preferMyanmar: Boolean = true): String {
        val myanmar = nameMy?.trim().orEmpty()
        val english = nameEn?.trim().orEmpty()
        // preferMyanmar is retained for call-site compatibility; names are always Myanmar-first.
        return myanmar.ifBlank { english }.ifBlank { UNNAMED_STOP }
    }

    fun cards(
        stops: List<com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow>,
        selectedStopPublicId: String?,
        reportedStopIds: Set<String>,
        preferMyanmar: Boolean = true,
    ): List<SurveyStopCardModel> {
        val ordered = StopContext.ordered(stops)
        val sequences = ordered.map { it.stopSequence }
        return ordered.map { stop ->
            SurveyStopCardModel(
                stopPublicId = stop.stopPublicId,
                sequenceLabel = StopSequenceDisplay.uiLabel(stop.stopSequence, sequences),
                displayName = displayName(stop.nameMy, stop.nameEn, preferMyanmar),
                selected = stop.stopPublicId == selectedStopPublicId,
                hasReport = stop.stopPublicId in reportedStopIds,
            )
        }
    }

    /** Index of the selected card, or -1 when none. */
    fun selectedIndex(cards: List<SurveyStopCardModel>): Int =
        cards.indexOfFirst { it.selected }

    /**
     * Offset passed to [androidx.compose.foundation.lazy.LazyListState.animateScrollToItem]
     * so the item start sits near the horizontal center of the viewport.
     */
    fun centerItemStartOffset(viewportWidthPx: Int, itemWidthPx: Int): Int {
        if (viewportWidthPx <= 0 || itemWidthPx <= 0) return 0
        return ((viewportWidthPx - itemWidthPx) / 2).coerceAtLeast(0)
    }

    /** Absolute scroll distance from the list start to place [itemIndex] near center. */
    fun centerScrollOffset(
        itemIndex: Int,
        itemCount: Int,
        viewportWidthPx: Int,
        itemWidthPx: Int,
        spacingPx: Int = 0,
    ): Int {
        if (itemIndex < 0 || itemCount <= 0 || viewportWidthPx <= 0 || itemWidthPx <= 0) {
            return 0
        }
        val stride = itemWidthPx + spacingPx
        val itemStart = itemIndex * stride
        val desiredStart = itemStart - centerItemStartOffset(viewportWidthPx, itemWidthPx)
        return desiredStart.coerceAtLeast(0)
    }

    fun reportedStopIdsFromPayloads(payloadJsonList: List<String>): Set<String> {
        return payloadJsonList.mapNotNull { reportedStopPublicId(it) }.toSet()
    }

    fun reportedStopPublicId(payloadJson: String): String? {
        return runCatching {
            val root = JSONObject(payloadJson)
            val target = root.optJSONObject("target")
            val entityType = target?.optString("entityType").orEmpty()
            val targetId = target?.optString("publicId")?.ifBlank { null }
            if (entityType == "stop" && targetId != null) {
                return targetId
            }
            val context = root.optJSONObject("context") ?: return null
            context.optString("stopPublicId").ifBlank { null }
                ?: context.optString("previousStopPublicId").ifBlank { null }
        }.getOrNull()
    }
}
