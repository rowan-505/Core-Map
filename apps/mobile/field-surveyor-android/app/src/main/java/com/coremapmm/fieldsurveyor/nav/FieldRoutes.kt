package com.coremapmm.fieldsurveyor.nav

object FieldRoutes {
    const val Login = "login"
    const val Setup = "setup"
    const val Routes = "routes"
    const val Survey = "survey"
    const val Settings = "settings"
    const val Profile = "settings_profile"
    const val Outbox = "settings_outbox"
    const val Infra = "settings_infra"
    const val History = "settings_history"
    const val HistoryDetail = "settings_history/{clientSessionId}"
    fun historyDetail(clientSessionId: String) = "settings_history/$clientSessionId"

    val mainTabs = listOf(Routes, Survey, Settings)

    fun settingsSection(route: String?): Boolean {
        return route == Settings || route == Profile || route == Outbox || route == Infra ||
            route == History || route?.startsWith("settings_history/") == true
    }
}
