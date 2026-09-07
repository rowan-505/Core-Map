package com.coremapmm.fieldsurveyor.crash

import android.app.Application
import com.coremapmm.fieldsurveyor.BuildConfig
import com.coremapmm.fieldsurveyor.log.FieldLog
import io.sentry.Sentry
import io.sentry.android.core.SentryAndroid

object FieldCrash {
    fun install(app: Application) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        if (BuildConfig.SENTRY_DSN.isNotBlank()) {
            try {
                SentryAndroid.init(app) { options ->
                    options.dsn = BuildConfig.SENTRY_DSN
                    options.isSendDefaultPii = false
                    options.isAttachScreenshot = false
                    options.isAttachViewHierarchy = false
                    options.isAttachAnrThreadDump = false
                    options.enableAllAutoBreadcrumbs(false)
                    options.maxBreadcrumbs = 0
                    options.setBeforeSend { event, _ ->
                        event.user = null
                        event.request = null
                        event.breadcrumbs = null
                        event.exceptions?.forEach { exception -> exception.value = exception.type }
                        event
                    }
                    options.environment = if (BuildConfig.DEBUG) "debug" else "release"
                }
            } catch (_: Exception) {
                FieldLog.error("sentry_init_failed")
            }
        }
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            FieldLog.error("uncaught", mapOf("thread" to thread.name), error)
            if (BuildConfig.SENTRY_DSN.isNotBlank()) {
                Sentry.captureException(error)
            }
            previous?.uncaughtException(thread, error)
        }
    }
}
