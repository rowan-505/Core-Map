package com.coremapmm.fieldsurveyor.survey

enum class AnomalyKind {
    MOVED,
    MISSING,
    DATA,
    ROUTE,
    OTHER,
    NEW_STOP,
}

object AnomalyMapping {
    fun reportTypeCode(kind: AnomalyKind): String {
        return when (kind) {
            AnomalyKind.MOVED -> "wrong_location"
            AnomalyKind.MISSING -> "missing_item"
            AnomalyKind.DATA -> "wrong_info"
            AnomalyKind.ROUTE -> "transport_issue"
            AnomalyKind.OTHER -> "other_map_issue"
            AnomalyKind.NEW_STOP -> "new_stop"
        }
    }

    fun targetEntityType(kind: AnomalyKind, hasSelectedStop: Boolean): String {
        return when (kind) {
            AnomalyKind.ROUTE -> "route"
            AnomalyKind.MOVED, AnomalyKind.MISSING, AnomalyKind.DATA -> "stop"
            AnomalyKind.NEW_STOP -> "variant"
            AnomalyKind.OTHER -> if (hasSelectedStop) "stop" else "variant"
        }
    }

    /** Selector order: Moved, Missing, Wrong data, Route, New stop, Other. */
    fun reportIssueKinds(): List<AnomalyKind> = listOf(
        AnomalyKind.MOVED,
        AnomalyKind.MISSING,
        AnomalyKind.DATA,
        AnomalyKind.ROUTE,
        AnomalyKind.NEW_STOP,
        AnomalyKind.OTHER,
    )

    fun displayLabel(kind: AnomalyKind): String = when (kind) {
        AnomalyKind.MOVED -> "Moved"
        AnomalyKind.MISSING -> "Missing"
        AnomalyKind.DATA -> "Wrong data"
        AnomalyKind.ROUTE -> "Route"
        AnomalyKind.NEW_STOP -> "New stop"
        AnomalyKind.OTHER -> "Other"
    }
}
