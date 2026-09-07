package com.coremapmm.fieldsurveyor.net

import com.coremapmm.fieldsurveyor.BuildConfig
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
    fun addsRequestIdAndDoesNotClearOnLogin401() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401))
        server.start()
        try {
            val cleared = AtomicBoolean(false)
            val client = FieldHttp.client { cleared.set(true) }
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
    fun field401ClearsSessionCallback() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401))
        server.start()
        try {
            val cleared = AtomicBoolean(false)
            val client = FieldHttp.client { cleared.set(true) }
            client.newCall(Request.Builder().url(server.url("/field/bootstrap")).build()).execute().close()
            assertTrue(cleared.get())
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
