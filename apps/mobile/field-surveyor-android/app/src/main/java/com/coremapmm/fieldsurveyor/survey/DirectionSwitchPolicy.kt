package com.coremapmm.fieldsurveyor.survey

enum class DirectionSwitchAction {
    SWITCH_NOW,
    CONFIRM_AND_SWITCH,
    DISABLED,
}

data class LocalSessionSnapshot(
    val routePublicId: String,
    val routeCode: String,
    val variantPublicId: String,
    val variantCode: String,
)

object DirectionSwitchPolicy {
    fun action(running: Boolean, enabled: Boolean): DirectionSwitchAction {
        if (!enabled) return DirectionSwitchAction.DISABLED
        return if (running) DirectionSwitchAction.CONFIRM_AND_SWITCH else DirectionSwitchAction.SWITCH_NOW
    }

    fun buttonLabel(oppositeCode: String?): String =
        if (oppositeCode.isNullOrBlank()) "⇄ —" else "⇄ $oppositeCode"

    fun restoredSelection(
        active: LocalSessionSnapshot?,
        stored: SurveySelection?,
    ): SurveySelection? {
        if (active != null) {
            val stop = stored?.selectedStopPublicId?.takeIf {
                stored.variantPublicId == active.variantPublicId
            }
            return SurveySelection(
                routePublicId = active.routePublicId,
                routeCode = active.routeCode,
                variantPublicId = active.variantPublicId,
                variantCode = active.variantCode,
                selectedStopPublicId = stop,
            )
        }
        return stored
    }
}
