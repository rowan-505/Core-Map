package com.coremapmm.fieldsurveyor.ui.settings

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

enum class FieldLanguage { MYANMAR, ENGLISH }
enum class FieldThemeMode { LIGHT, DARK }

class FieldPreferences(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

    var language by mutableStateOf(
        preferences.getString(KEY_LANGUAGE, null)
            ?.let { runCatching { FieldLanguage.valueOf(it) }.getOrNull() }
            ?: DEFAULT_LANGUAGE,
    )
        private set

    var themeMode by mutableStateOf(
        preferences.getString(KEY_THEME, null)
            ?.let { runCatching { FieldThemeMode.valueOf(it) }.getOrNull() }
            ?: DEFAULT_THEME,
    )
        private set

    /** Debug-only Fastify origin override. Empty means auto (USB tunnel or emulator). */
    fun debugApiBaseUrl(): String? =
        preferences.getString(KEY_DEBUG_API_BASE_URL, null)?.trim()?.takeIf { it.isNotEmpty() }

    fun updateLanguage(value: FieldLanguage) {
        language = value
        preferences.edit().putString(KEY_LANGUAGE, value.name).apply()
    }

    fun updateThemeMode(value: FieldThemeMode) {
        themeMode = value
        preferences.edit().putString(KEY_THEME, value.name).apply()
    }

    fun updateDebugApiBaseUrl(value: String?) {
        val normalized = value?.trim().orEmpty()
        preferences.edit().apply {
            if (normalized.isEmpty()) {
                remove(KEY_DEBUG_API_BASE_URL)
            } else {
                putString(KEY_DEBUG_API_BASE_URL, normalized)
            }
        }.apply()
    }

    companion object {
        const val FILE_NAME = "field_display_preferences"
        val DEFAULT_LANGUAGE = FieldLanguage.MYANMAR
        val DEFAULT_THEME = FieldThemeMode.LIGHT
        private const val KEY_LANGUAGE = "language"
        private const val KEY_THEME = "theme"
        private const val KEY_DEBUG_API_BASE_URL = "debug_api_base_url"
    }
}
