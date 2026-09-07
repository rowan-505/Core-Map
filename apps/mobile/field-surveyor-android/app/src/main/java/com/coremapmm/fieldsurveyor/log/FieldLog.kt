package com.coremapmm.fieldsurveyor.log

import android.util.Log
import com.coremapmm.fieldsurveyor.BuildConfig

/**
 * Structured log lines. Never attach tokens, passwords, emails, or coordinates.
 */
object FieldLog {
    private const val TAG = "CoreMapField"
    private val blockedKeys = setOf(
        "token",
        "accesstoken",
        "refreshtoken",
        "authorization",
        "password",
        "email",
        "lat",
        "lng",
        "latitude",
        "longitude",
        "dsn",
        "mediaurl",
        "signedurl",
        "secret",
        "key",
    )

    fun event(name: String, attrs: Map<String, String> = emptyMap()) {
        val safe = sanitize(attrs)
        val suffix = if (safe.isEmpty()) "" else " " + safe.entries.joinToString(" ") { "${it.key}=${it.value}" }
        Log.i(TAG, "event=$name$suffix")
    }

    fun error(name: String, attrs: Map<String, String> = emptyMap(), throwable: Throwable? = null) {
        val safe = sanitize(attrs).toMutableMap()
        throwable?.let { safe["error_type"] = it.javaClass.simpleName.take(80) }
        val suffix = if (safe.isEmpty()) "" else " " + safe.entries.joinToString(" ") { "${it.key}=${it.value}" }
        // Throwable messages and stack output can include signed URLs or request data.
        Log.w(TAG, "event=$name$suffix")
    }

    fun sanitize(attrs: Map<String, String>): Map<String, String> {
        return attrs.filterKeys { key ->
            val normalized = key.lowercase().replace("_", "").replace("-", "")
            blockedKeys.none { blocked -> normalized.contains(blocked) }
        }.mapValues { (_, value) ->
            value.take(120)
        }
    }

    fun debugOnly(message: String) {
        if (BuildConfig.DEBUG) {
            Log.d(TAG, message)
        }
    }
}
