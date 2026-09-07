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
        AnomalyKind.MOVED, AnomalyKind.MISSING, AnomalyKind.DATA -> true
        AnomalyKind.ROUTE, AnomalyKind.OTHER -> false
    }

    fun saveError(
        running: Boolean,
        kind: AnomalyKind,
        hasStop: Boolean,
        mapPick: GpsFix?,
        note: String,
        routeIssue: RouteIssueKind?,
    ): String? {
        if (!running) {
            return "Start Survey first. That keeps GPS on and the screen awake."
        }
        return when (kind) {
            AnomalyKind.MOVED -> when {
                !hasStop -> "Select the stop that moved."
                mapPick == null -> "Tap the map where the stop really is."
                else -> null
            }
            AnomalyKind.MISSING -> if (hasStop) null else "Select the missing stop."
            AnomalyKind.DATA -> if (hasStop) null else "Select the stop with wrong data."
            AnomalyKind.ROUTE -> if (routeIssue == null) "Choose a route issue." else null
            AnomalyKind.OTHER -> null
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
        return when (AnomalyMapping.targetEntityType(kind, stopPublicId != null)) {
            "stop" -> stopPublicId
            "route" -> routePublicId
            else -> variantPublicId
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

object CorrectStopAction {
    fun nextStopPublicId(stops: List<com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow>, selectedStopPublicId: String?): String? {
        if (selectedStopPublicId.isNullOrBlank()) return null
        val index = stops.indexOfFirst { it.stopPublicId == selectedStopPublicId }
        if (index < 0) return null
        return stops.getOrNull(index + 1)?.stopPublicId
    }
}

object SurveyCaptureFacts {
    fun lines(
        epochMs: Long,
        gps: GpsFix?,
        routeCode: String?,
        variantCode: String?,
        snapshotRevision: String?,
    ): List<String> {
        val time = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US)
            .format(java.util.Date(epochMs))
        val coords = gps?.let {
            val acc = it.accuracyM?.let { meters -> " · ±${meters.toInt()} m" } ?: " · ±? m"
            String.format(java.util.Locale.US, "%.5f, %.5f%s", it.lat, it.lng, acc)
        } ?: "No GPS fix yet"
        val route = listOfNotNull(routeCode, variantCode).joinToString(" · ").ifBlank { "No route" }
        val revision = snapshotRevision?.takeIf { it.isNotBlank() } ?: "No snapshot"
        return listOf("Captured $time", coords, "$route · $revision")
    }
}

object StopProgress {
    fun label(stops: List<com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow>, selectedStopPublicId: String?): String {
        if (stops.isEmpty()) return "#0 of 0"
        val index = stops.indexOfFirst { it.stopPublicId == selectedStopPublicId }
        val current = if (index < 0) 0 else index + 1
        return "#$current of ${stops.size}"
    }
}
