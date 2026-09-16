package com.coremapmm.fieldsurveyor.survey

enum class RouteIssueKind {
    PATH_WRONG,
    MISSING_SEGMENT,
    OTHER,
}

object SurveyReportFlow {
    const val DUPLICATE_WARNING =
        "This session already has the same report type for this target."

    fun requiresStop(kind: AnomalyKind): Boolean = when (kind) {
        AnomalyKind.MOVED, AnomalyKind.MISSING, AnomalyKind.DATA, AnomalyKind.NEW_STOP -> true
        AnomalyKind.ROUTE, AnomalyKind.OTHER -> false
    }

    fun saveError(
        running: Boolean,
        kind: AnomalyKind,
        hasStop: Boolean,
        mapPick: GpsFix?,
        note: String,
        routeIssue: RouteIssueKind?,
        proposedStopName: String = "",
    ): String? {
        if (!running) {
            return "Start Survey first. That keeps GPS on and the screen awake."
        }
        return when (kind) {
            AnomalyKind.MOVED -> when {
                !hasStop -> "Select the stop that moved."
                mapPick == null -> "Choose a new location for the stop."
                else -> null
            }
            AnomalyKind.MISSING -> if (hasStop) null else "Select the missing stop."
            AnomalyKind.NEW_STOP -> when {
                !hasStop -> "Select the previous stop on this variant."
                proposedStopName.trim().isEmpty() -> "Enter the proposed stop name."
                mapPick == null -> "Choose a location for the new stop."
                !NewStopReportFlow.validCoordinates(mapPick.lat, mapPick.lng) ->
                    "Choose a valid map location."
                else -> null
            }
            AnomalyKind.DATA -> when {
                !hasStop -> "Select the stop with wrong data."
                note.trim().isEmpty() -> "Enter a short explanation."
                else -> null
            }
            AnomalyKind.ROUTE -> when {
                note.trim().isEmpty() -> "Enter a route explanation."
                else -> null
            }
            AnomalyKind.OTHER -> when {
                note.trim().isEmpty() -> "Enter an explanation."
                else -> null
            }
        }
    }

    fun composedNote(note: String, routeIssue: RouteIssueKind?): String {
        val trimmed = note.trim()
        val prefix = when (routeIssue) {
            RouteIssueKind.PATH_WRONG -> "path wrong"
            RouteIssueKind.MISSING_SEGMENT -> "missing segment"
            RouteIssueKind.OTHER -> "other route issue"
            null -> null
        }
        return when {
            prefix == null -> trimmed
            trimmed.isEmpty() -> prefix
            else -> "$prefix · $trimmed"
        }.take(4000)
    }

    fun targetPublicId(
        kind: AnomalyKind,
        stopPublicId: String?,
        routePublicId: String,
        variantPublicId: String,
    ): String? {
        return when {
            kind == AnomalyKind.NEW_STOP -> stopPublicId
            else -> when (AnomalyMapping.targetEntityType(kind, stopPublicId != null)) {
                "stop" -> stopPublicId
                "route" -> routePublicId
                else -> variantPublicId
            }
        }
    }

    fun isDuplicate(
        existing: List<ReportFingerprint>,
        sessionId: String?,
        reportTypeCode: String,
        targetPublicId: String?,
    ): Boolean {
        if (sessionId.isNullOrBlank() || targetPublicId.isNullOrBlank()) {
            return false
        }
        return existing.any {
            it.sessionId == sessionId &&
                it.reportTypeCode == reportTypeCode &&
                it.targetPublicId == targetPublicId
        }
    }

    fun duplicateWarning(
        existing: List<ReportFingerprint>,
        sessionId: String?,
        kind: AnomalyKind,
        stopPublicId: String?,
        routePublicId: String,
        variantPublicId: String,
    ): String? {
        val target = targetPublicId(kind, stopPublicId, routePublicId, variantPublicId)
        return if (isDuplicate(existing, sessionId, AnomalyMapping.reportTypeCode(kind), target)) {
            DUPLICATE_WARNING
        } else {
            null
        }
    }
}

data class ReportFingerprint(
    val sessionId: String,
    val reportTypeCode: String,
    val targetPublicId: String,
)

object StopSelectionAdvance {
    fun nextStopPublicId(stops: List<com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow>, selectedStopPublicId: String?): String? {
        if (selectedStopPublicId.isNullOrBlank()) return null
        val ordered = StopContext.ordered(stops)
        val index = ordered.indexOfFirst { it.stopPublicId == selectedStopPublicId }
        if (index < 0) return null
        return ordered.getOrNull(index + 1)?.stopPublicId
    }
}

object SurveyCaptureFacts {
    /**
     * UI-only capture summary. Never includes raw coordinates, technical IDs,
     * or snapshot hashes — those stay in report payloads only.
     */
    fun lines(
        epochMs: Long,
        gps: GpsFix?,
        routeCode: String?,
        variantCode: String?,
        snapshotRevision: String?,
    ): List<String> {
        val time = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US)
            .format(java.util.Date(epochMs))
        return listOf("Captured $time")
    }
}

object StopSequenceDisplay {
    fun isZeroBased(sequences: Iterable<Int>): Boolean {
        val values = sequences.filter { it >= 0 }
        return values.isNotEmpty() && values.minOrNull() == 0
    }

    fun uiNumber(sequence: Int, sequences: Iterable<Int>): Int {
        val shifted = if (isZeroBased(sequences)) sequence + 1 else sequence
        return shifted.coerceAtLeast(1)
    }

    fun uiLabel(sequence: Int, sequences: Iterable<Int>): String = "#${uiNumber(sequence, sequences)}"
}

object StopProgress {
    fun label(stops: List<com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow>, selectedStopPublicId: String?): String {
        val ordered = StopContext.ordered(stops)
        if (ordered.isEmpty()) return "— of 0"
        val index = ordered.indexOfFirst { it.stopPublicId == selectedStopPublicId }
        if (index < 0) return "— of ${ordered.size}"
        return "#${index + 1} of ${ordered.size}"
    }
}
