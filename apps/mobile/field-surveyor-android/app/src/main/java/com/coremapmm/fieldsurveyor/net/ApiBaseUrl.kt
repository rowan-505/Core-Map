package com.coremapmm.fieldsurveyor.net

import android.content.Context
import android.os.Build
import com.coremapmm.fieldsurveyor.BuildConfig
import com.coremapmm.fieldsurveyor.ui.settings.FieldPreferences

/**
 * Resolves the Fastify origin for the field app.
 *
 * Release always uses the baked production URL.
 * Debug prefers a saved override, then USB tunnel (127.0.0.1) on real phones,
 * or the emulator loopback (10.0.2.2). That avoids baking a Mac LAN IP that
 * breaks every time Wi-Fi changes.
 */
object ApiBaseUrl {
    const val USB_TUNNEL = "http://127.0.0.1:3001"
    const val EMULATOR_LOOPBACK = "http://10.0.2.2:3001"

    fun resolve(context: Context): String {
        if (!BuildConfig.DEBUG) {
            return BuildConfig.API_BASE_URL.trimEnd('/')
        }
        val override = FieldPreferences(context).debugApiBaseUrl()?.trim().orEmpty()
        if (override.isNotEmpty()) {
            return normalize(override)
        }
        return if (isEmulator()) {
            EMULATOR_LOOPBACK
        } else {
            USB_TUNNEL
        }
    }

    fun normalize(raw: String): String = raw.trim().trimEnd('/')

    fun isEmulator(): Boolean {
        val fingerprint = Build.FINGERPRINT.lowercase()
        val model = Build.MODEL.lowercase()
        val product = Build.PRODUCT.lowercase()
        val hardware = Build.HARDWARE.lowercase()
        val manufacturer = Build.MANUFACTURER.lowercase()
        return fingerprint.startsWith("generic") ||
            fingerprint.startsWith("unknown") ||
            model.contains("google_sdk") ||
            model.contains("emulator") ||
            model.contains("android sdk built for") ||
            manufacturer.contains("genymotion") ||
            hardware.contains("goldfish") ||
            hardware.contains("ranchu") ||
            product.contains("sdk") ||
            product.contains("emulator") ||
            product.contains("simulator")
    }

    fun looksLikeUsbTunnel(url: String): Boolean {
        val lower = url.lowercase()
        return lower.contains("127.0.0.1") || lower.contains("localhost")
    }

    fun looksLikeEmulatorLoopback(url: String): Boolean = url.lowercase().contains("10.0.2.2")
}
