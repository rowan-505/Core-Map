package com.coremapmm.fieldsurveyor.net

import com.coremapmm.fieldsurveyor.log.FieldLog
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import java.util.UUID
import java.util.concurrent.TimeUnit

object FieldHttp {
    const val CONNECT_TIMEOUT_SECONDS = 20L
    const val READ_TIMEOUT_SECONDS = 120L
    const val WRITE_TIMEOUT_SECONDS = 20L
    const val CALL_TIMEOUT_SECONDS = 90L
    const val DOWNLOAD_CONNECT_TIMEOUT_SECONDS = 30L
    const val DOWNLOAD_READ_TIMEOUT_SECONDS = 60L
    const val DOWNLOAD_CALL_TIMEOUT_MINUTES = 180L
    const val REQUEST_ID_HEADER = "x-request-id"

    fun client(onUnauthorized: () -> Unit = {}): OkHttpClient {
        return OkHttpClient.Builder()
            .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(WRITE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .addInterceptor(RequestIdInterceptor)
            .addInterceptor(HttpEventInterceptor)
            .addInterceptor(UnauthorizedInterceptor(onUnauthorized))
            .build()
    }

    /** Large Yangon PMTiles (~730 MB), bounded while allowing slow field networks. */
    fun downloadClient(): OkHttpClient {
        return OkHttpClient.Builder()
            .connectTimeout(DOWNLOAD_CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(DOWNLOAD_READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .callTimeout(DOWNLOAD_CALL_TIMEOUT_MINUTES, TimeUnit.MINUTES)
            .addInterceptor(RequestIdInterceptor)
            .build()
    }
}

private object RequestIdInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val request = if (original.header(FieldHttp.REQUEST_ID_HEADER).isNullOrBlank()) {
            original.newBuilder()
                .header(FieldHttp.REQUEST_ID_HEADER, UUID.randomUUID().toString())
                .build()
        } else {
            original
        }
        return chain.proceed(request)
    }
}

internal object HttpLogPolicy {
    fun path(method: String, encodedPath: String): String =
        if (method.equals("PUT", ignoreCase = true)) "[media-redacted]" else encodedPath
}

private object HttpEventInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val started = System.nanoTime()
        val response = chain.proceed(request)
        val elapsedMs = (System.nanoTime() - started) / 1_000_000L
        FieldLog.event(
            "http",
            mapOf(
                "method" to request.method,
                "host" to request.url.host,
                "path" to HttpLogPolicy.path(request.method, request.url.encodedPath),
                "status" to response.code.toString(),
                "ms" to elapsedMs.toString(),
            ),
        )
        return response
    }
}

private class UnauthorizedInterceptor(
    private val onUnauthorized: () -> Unit,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val response = chain.proceed(request)
        val path = request.url.encodedPath
        val authRoute = path == "/auth/login" || path == "/auth/refresh" || path == "/auth/logout"
        if (response.code == 401 && !authRoute) {
            onUnauthorized()
        }
        return response
    }
}
