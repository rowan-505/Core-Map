package com.coremapmm.fieldsurveyor.survey

import android.content.Context

data class SurveySelection(
    val routePublicId: String,
    val routeCode: String,
    val variantPublicId: String,
    val variantCode: String,
    val selectedStopPublicId: String?,
)

/** Small durable UI/session marker. Survey GPS points are never persisted here. */
class SurveySelectionStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun load(): SurveySelection? {
        val variant = prefs.getString(KEY_VARIANT, null) ?: return null
        val route = prefs.getString(KEY_ROUTE, null) ?: return null
        val code = prefs.getString(KEY_ROUTE_CODE, null) ?: return null
        val d = prefs.getString(KEY_VARIANT_CODE, null) ?: return null
        return SurveySelection(
            routePublicId = route,
            routeCode = code,
            variantPublicId = variant,
            variantCode = d,
            selectedStopPublicId = prefs.getString(KEY_STOP, null),
        )
    }

    fun save(selection: SurveySelection) {
        prefs.edit()
            .putString(KEY_ROUTE, selection.routePublicId)
            .putString(KEY_ROUTE_CODE, selection.routeCode)
            .putString(KEY_VARIANT, selection.variantPublicId)
            .putString(KEY_VARIANT_CODE, selection.variantCode)
            .putString(KEY_STOP, selection.selectedStopPublicId)
            .apply()
    }

    fun isSurveyActive(): Boolean = prefs.getBoolean(KEY_SURVEY_ACTIVE, false)

    fun setSurveyActive(active: Boolean) {
        // A foreground-service/process restart must observe this transition immediately.
        prefs.edit().putBoolean(KEY_SURVEY_ACTIVE, active).commit()
    }

    fun activeSessionId(): String? = prefs.getString(KEY_ACTIVE_SESSION_ID, null)

    fun setActiveSessionId(id: String?) {
        prefs.edit().apply {
            if (id == null) remove(KEY_ACTIVE_SESSION_ID) else putString(KEY_ACTIVE_SESSION_ID, id)
        }.commit()
    }

    companion object {
        const val PREFS = "field_survey_ui"
        private const val KEY_ROUTE = "route_public_id"
        private const val KEY_ROUTE_CODE = "route_code"
        private const val KEY_VARIANT = "variant_public_id"
        private const val KEY_VARIANT_CODE = "variant_code"
        private const val KEY_STOP = "stop_public_id"
        private const val KEY_ACTIVE_SESSION_ID = "active_session_client_id"
        private const val KEY_SURVEY_ACTIVE = "survey_active"
    }
}
