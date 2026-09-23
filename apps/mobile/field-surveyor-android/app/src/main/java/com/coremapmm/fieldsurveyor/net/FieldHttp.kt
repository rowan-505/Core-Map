package com.coremapmm.fieldsurveyor.net

import com.coremapmm.fieldsurveyor.log.FieldLog
import okhttp3.Authenticator
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
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

    /**
     * Shared API client.
     *
     * [apiBaseUrl] scopes session recovery to the CoreMap origin only. R2
     * presigned PUT 401s must never clear Keystore credentials.
     *
     * On CoreMap API 401 (non-auth routes): [recoverAccessToken] runs once; if
     * it returns a new Bearer token the request is retried. If recovery fails,
     * [onUnauthorized] clears local credentials.
     */
    fun client(
        apiBaseUrl: String = "",
        recoverAccessToken: () -> String? = { null },
        onUnauthorized: () -> Unit = {},
    ): OkHttpClient {
        val apiOrigin = ApiOrigin.fromBaseUrl(apiBaseUrl)
        return OkHttpClient.Builder()
            .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(WRITE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .addInterceptor(RequestIdInterceptor)
            .addInterceptor(HttpEventInterceptor)
            .authenticator(ApiSessionAuthenticator(apiOrigin, recoverAccessToken))
            .addInterceptor(UnauthorizedInterceptor(apiOrigin, onUnauthorized))
            .build()
    }

    /** Yangon PMTiles download (~120 MB for v2), bounded while allowing slow field networks. */
    fun downloadClient(): OkHttpClient {
        return OkHttpClient.Builder()
            .connectTimeout(DOWNLOAD_CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(DOWNLOAD_READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .callTimeout(DOWNLOAD_CALL_TIMEOUT_MINUTES, TimeUnit.MINUTES)
            .addInterceptor(RequestIdInterceptor)
            .build()
    }
}

/** Scheme-independent host+port match for the configured Fastify origin. */
internal data class ApiOrigin(val host: String, val port: Int) {
    companion object {
        fun fromBaseUrl(apiBaseUrl: String): ApiOrigin? {
            val trimmed = apiBaseUrl.trim()
            if (trimmed.isEmpty()) return null
            val url = trimmed.toHttpUrlOrNull() ?: return null
            return ApiOrigin(url.host.lowercase(), url.port)
        }

        fun matches(api: ApiOrigin?, requestUrl: HttpUrl): Boolean {
            if (api == null) return false
            return api.host == requestUrl.host.lowercase() && api.port == requestUrl.port
        }

        fun isAuthRoute(encodedPath: String): Boolean {
            return encodedPath == "/auth/login" ||
                encodedPath == "/auth/refresh" ||
                encodedPath == "/auth/logout"
        }
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

/** One refresh + retry for CoreMap API Bearer 401s. Skips R2 and auth routes. */
internal class ApiSessionAuthenticator(
    private val apiOrigin: ApiOrigin?,
    private val recoverAccessToken: () -> String?,
) : Authenticator {
    override fun authenticate(route: Route?, response: Response): Request? {
        if (responseCount(response) >= 2) {
            return null
        }
        if (!ApiOrigin.matches(apiOrigin, response.request.url)) {
            return null
        }
        if (ApiOrigin.isAuthRoute(response.request.url.encodedPath)) {
            return null
        }
        val failedAuth = response.request.header("Authorization")
        val newToken = recoverAccessToken() ?: return null
        val newHeader = "Bearer $newToken"
        if (newHeader == failedAuth) {
            return null
        }
        return response.request.newBuilder()
            .header("Authorization", newHeader)
            .build()
    }

    private fun responseCount(response: Response): Int {
        var count = 1
        var prior = response.priorResponse
        while (prior != null) {
            count++
            prior = prior.priorResponse
        }
        return count
    }
}

/** Clears credentials only for a final CoreMap API 401. Never for R2 hosts. */
internal class UnauthorizedInterceptor(
    private val apiOrigin: ApiOrigin?,
    private val onUnauthorized: () -> Unit,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val response = chain.proceed(request)
        if (response.code != 401) {
            return response
        }
        if (!ApiOrigin.matches(apiOrigin, request.url)) {
            return response
        }
        if (ApiOrigin.isAuthRoute(request.url.encodedPath)) {
            return response
        }
        onUnauthorized()
        return response
    }
}
