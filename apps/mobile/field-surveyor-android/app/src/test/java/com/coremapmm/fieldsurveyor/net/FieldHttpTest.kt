package com.coremapmm.fieldsurveyor.net

import com.coremapmm.fieldsurveyor.BuildConfig
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class FieldHttpTest {
    @Test
    fun apiClientHasFiniteTimeouts() {
        assertEquals(20L, FieldHttp.CONNECT_TIMEOUT_SECONDS)
        assertEquals(120L, FieldHttp.READ_TIMEOUT_SECONDS)
        assertEquals(20L, FieldHttp.WRITE_TIMEOUT_SECONDS)
        assertEquals(90L, FieldHttp.CALL_TIMEOUT_SECONDS)
        val download = FieldHttp.downloadClient()
        assertTrue(download.connectTimeoutMillis > 0)
        assertTrue(download.readTimeoutMillis > 0)
        assertTrue(download.callTimeoutMillis > 0)
    }

    @Test
    fun mediaUploadPathIsRedactedFromLogs() {
        assertEquals("[media-redacted]", HttpLogPolicy.path("PUT", "/private/signed/object.jpg"))
        assertEquals("/field/bootstrap", HttpLogPolicy.path("GET", "/field/bootstrap"))
    }

    @Test
    fun apiOriginHelpers() {
        val origin = ApiOrigin.fromBaseUrl("https://api.coremapmm.com")!!
        assertEquals("api.coremapmm.com", origin.host)
        assertEquals(443, origin.port)
        assertTrue(ApiOrigin.matches(origin, "https://api.coremapmm.com/field/bootstrap".toHttpUrl()))
        assertFalse(ApiOrigin.matches(origin, "https://r2.cloudflarestorage.com/object".toHttpUrl()))
        assertTrue(ApiOrigin.isAuthRoute("/auth/login"))
        assertFalse(ApiOrigin.isAuthRoute("/field/bootstrap"))
    }

    @Test
    fun addsRequestIdAndDoesNotClearOnLogin401() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401))
        server.start()
        try {
            val cleared = AtomicBoolean(false)
            val client = FieldHttp.client(
                apiBaseUrl = server.url("/").toString().trimEnd('/'),
                onUnauthorized = { cleared.set(true) },
            )
            client.newCall(
                Request.Builder().url(server.url("/auth/login")).post(ByteArray(0).toRequestBody(null)).build(),
            ).execute().close()
            val recorded = server.takeRequest()
            assertFalse(recorded.getHeader(FieldHttp.REQUEST_ID_HEADER).isNullOrBlank())
            assertFalse(cleared.get())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun field401ClearsSessionWhenRecoveryFails() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401))
        server.start()
        try {
            val cleared = AtomicBoolean(false)
            val client = FieldHttp.client(
                apiBaseUrl = server.url("/").toString().trimEnd('/'),
                recoverAccessToken = { null },
                onUnauthorized = { cleared.set(true) },
            )
            client.newCall(
                Request.Builder()
                    .url(server.url("/field/bootstrap"))
                    .header("Authorization", "Bearer expired")
                    .build(),
            ).execute().close()
            assertTrue(cleared.get())
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun r2Host401DoesNotClearSession() {
        val apiServer = MockWebServer()
        val r2Server = MockWebServer()
        apiServer.start()
        r2Server.enqueue(MockResponse().setResponseCode(401))
        r2Server.start()
        try {
            val cleared = AtomicBoolean(false)
            val client = FieldHttp.client(
                apiBaseUrl = apiServer.url("/").toString().trimEnd('/'),
                onUnauthorized = { cleared.set(true) },
            )
            // Presigned R2 PUT uses a different host on the shared client (via newBuilder).
            client.newCall(
                Request.Builder()
                    .url(r2Server.url("/object.jpg"))
                    .put(ByteArray(4).toRequestBody(null))
                    .build(),
            ).execute().close()
            assertFalse(cleared.get())
        } finally {
            apiServer.shutdown()
            r2Server.shutdown()
        }
    }

    @Test
    fun field401RetriesOnceWithRecoveredToken() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"ok":true}"""))
        server.start()
        try {
            val cleared = AtomicBoolean(false)
            val recoverCalls = AtomicInteger(0)
            val token = AtomicReference("fresh-token")
            val client = FieldHttp.client(
                apiBaseUrl = server.url("/").toString().trimEnd('/'),
                recoverAccessToken = {
                    recoverCalls.incrementAndGet()
                    token.get()
                },
                onUnauthorized = { cleared.set(true) },
            )
            val response = client.newCall(
                Request.Builder()
                    .url(server.url("/field/bootstrap"))
                    .header("Authorization", "Bearer expired")
                    .build(),
            ).execute()
            assertEquals(200, response.code)
            response.close()
            assertEquals(1, recoverCalls.get())
            assertFalse(cleared.get())
            assertEquals("Bearer expired", server.takeRequest().getHeader("Authorization"))
            assertEquals("Bearer fresh-token", server.takeRequest().getHeader("Authorization"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun buildConfigDoesNotEmbedServiceRoleOrPlaceholder() {
        val blob = BuildConfig.API_BASE_URL + BuildConfig.YANGON_PMTILES_URL + BuildConfig.SENTRY_DSN
        assertFalse(blob.contains("service_role"))
        assertFalse(blob.contains("supabase.co/rest"))
        assertNotEquals("https://api.invalid.coremap.local", BuildConfig.API_BASE_URL)
        if (BuildConfig.BUILD_TYPE == "release") {
            assertEquals("https://api.coremapmm.com", BuildConfig.API_BASE_URL)
            assertTrue(BuildConfig.API_BASE_URL.startsWith("https://"))
        }
    }
}
