package com.coremapmm.fieldsurveyor.auth

import com.coremapmm.fieldsurveyor.BuildConfig
import com.coremapmm.fieldsurveyor.log.FieldLog
import java.io.IOException

object FieldHttpError {
    fun formatUnreachable(error: IOException, baseUrl: String, action: String = "API"): String {
        val cause = error.message?.trim().orEmpty().ifBlank { error.javaClass.simpleName }
        return "Cannot reach CoreMap $action at $baseUrl ($cause)"
    }

    fun unreachable(error: IOException, baseUrl: String, action: String = "API"): AuthException {
        val message = formatUnreachable(error, baseUrl, action)
        FieldLog.error(
            "http_unreachable",
            mapOf("action" to action),
            if (BuildConfig.DEBUG) error else null,
        )
        return AuthException(message)
    }
}
