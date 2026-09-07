package com.coremapmm.fieldsurveyor.offline

import com.coremapmm.fieldsurveyor.media.MediaChecksum
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import okio.ForwardingSource
import okio.buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

class YangonBasemapStoreTest {
    private lateinit var server: MockWebServer
    private lateinit var root: File
    private val payloadV1 = "yangon-map-v1-payload".toByteArray()
    private val payloadV2 = "yangon-map-v2-payload-xx".toByteArray()

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        root = File.createTempFile("yangon-root", "").also {
            it.delete()
            it.mkdirs()
        }
    }

    @After
    fun tearDown() {
        server.shutdown()
        root.deleteRecursively()
    }

    @Test
    fun incompleteFileWithoutMarkerIsNotReady() {
        val file = File.createTempFile("yangon", ".pmtiles")
        file.writeBytes(ByteArray(64))
        assertFalse(YangonBasemapStore.isComplete(file, minReadyBytes = 4))
        file.delete()
        File(file.path + ".ok").delete()
    }

    @Test
    fun markerMustMatchLength() {
        val file = File.createTempFile("yangon", ".pmtiles")
        file.writeBytes(ByteArray(64))
        File(file.path + ".ok").writeText("999")
        assertFalse(YangonBasemapStore.isComplete(file, minReadyBytes = 4))
        file.delete()
        File(file.path + ".ok").delete()
    }

    @Test
    fun checksumFailureKeepsLastValidMap() = runBlocking {
        val sha = MediaChecksum.sha256Hex(writeTemp(payloadV1))
        seedLocal(payloadV1, "v1", sha)
        val fixture = startTiles(payloadV2, "v2", sha256 = "0".repeat(64))
        val store = store(fixture.url)
        try {
            store.ensure(allowMetered = false) { _, _ -> }
            throw AssertionError("expected checksum failure")
        } catch (error: IOException) {
            assertTrue(error.message!!.contains("checksum"))
        }
        assertEquals("yangon-map-v1-payload", store.localFile().readText())
        assertEquals("v1", store.localVersion())
        assertTrue(store.isReady())
    }

    @Test
    fun interruptedDownloadResumesWithRange() = runBlocking {
        val oldSha = MediaChecksum.sha256Hex(writeTemp(payloadV1))
        val newSha = MediaChecksum.sha256Hex(writeTemp(payloadV2))
        seedLocal(payloadV1, "v1", oldSha)
        val fixture = startTiles(payloadV2, "v2", newSha)
        var cutOnce = true
        val client = OkHttpClient.Builder()
            .retryOnConnectionFailure(false)
            .readTimeout(5, TimeUnit.SECONDS)
            .addNetworkInterceptor { chain ->
                val request = chain.request()
                val response = chain.proceed(request)
                val body = response.body ?: return@addNetworkInterceptor response
                if (
                    !cutOnce ||
                    !request.url.encodedPath.endsWith("basemap.pmtiles") ||
                    request.header("Range") != null
                ) {
                    return@addNetworkInterceptor response
                }
                cutOnce = false
                val limited = object : okhttp3.ResponseBody() {
                    override fun contentType() = body.contentType()
                    override fun contentLength() = body.contentLength()
                    override fun source(): okio.BufferedSource {
                        return object : ForwardingSource(body.source()) {
                            var copied = 0L
                            override fun read(sink: Buffer, byteCount: Long): Long {
                                if (copied >= 6L) throw IOException("interrupted")
                                val read = super.read(sink, minOf(byteCount, 6L - copied))
                                if (read > 0L) copied += read
                                return read
                            }
                        }.buffer()
                    }
                }
                response.newBuilder().body(limited).build()
            }
            .build()
        val store = store(fixture.url, client)
        try {
            store.ensure(allowMetered = false) { _, _ -> }
            throw AssertionError("expected interrupt")
        } catch (error: IOException) {
            assertTrue(error.message!!.contains("interrupted"))
        }
        assertEquals("yangon-map-v1-payload", store.localFile().readText())
        val tmp = File(store.localFile().path + ".tmp")
        assertTrue(tmp.isFile)
        assertTrue(tmp.length() in 1L..6L)
        store.ensure(allowMetered = false) { _, _ -> }
        assertEquals("yangon-map-v2-payload-xx", store.localFile().readText())
        assertEquals("v2", store.localVersion())
        assertTrue(fixture.rangeRequests >= 1)
    }

    @Test
    fun lowStorageDoesNotReplaceMap() = runBlocking {
        val sha = MediaChecksum.sha256Hex(writeTemp(payloadV1))
        seedLocal(payloadV1, "v1", sha)
        val nextSha = MediaChecksum.sha256Hex(writeTemp(payloadV2))
        val fixture = startTiles(payloadV2, "v2", nextSha)
        val store = store(fixture.url, usable = 1024L)
        try {
            store.ensure(allowMetered = false) { _, _ -> }
            throw AssertionError("expected storage failure")
        } catch (error: IOException) {
            assertTrue(error.message!!.contains("storage"))
        }
        assertEquals("yangon-map-v1-payload", store.localFile().readText())
        assertEquals(0, fixture.tileGets)
    }

    @Test
    fun unchangedVersionDoesNotRedownload() = runBlocking {
        val sha = MediaChecksum.sha256Hex(writeTemp(payloadV1))
        seedLocal(payloadV1, "v1", sha)
        val fixture = startTiles(payloadV1, "v1", sha)
        val store = store(fixture.url)
        store.ensure(allowMetered = false) { _, _ -> }
        assertEquals(0, fixture.tileGets)
        assertEquals("v1", store.localVersion())
    }

    @Test
    fun stalePackageDownloadsNewVersion() = runBlocking {
        val oldSha = MediaChecksum.sha256Hex(writeTemp(payloadV1))
        val newSha = MediaChecksum.sha256Hex(writeTemp(payloadV2))
        seedLocal(payloadV1, "v1", oldSha)
        val fixture = startTiles(payloadV2, "v2", newSha)
        val store = store(fixture.url)
        store.ensure(allowMetered = false) { _, _ -> }
        assertTrue(fixture.tileGets >= 1)
        assertEquals("yangon-map-v2-payload-xx", store.localFile().readText())
        assertEquals("v2", store.localVersion())
    }

    @Test
    fun mobileDataIsBlockedWithoutOverride() = runBlocking {
        val sha = MediaChecksum.sha256Hex(writeTemp(payloadV2))
        val fixture = startTiles(payloadV2, "v2", sha)
        val store = store(fixture.url, metered = true)
        try {
            store.ensure(allowMetered = false) { _, _ -> }
            throw AssertionError("expected metered block")
        } catch (error: IOException) {
            assertEquals(OfflineMapPolicy.METERED_MESSAGE, error.message)
        }
        assertFalse(store.localFile().exists())
        assertEquals(0, fixture.tileGets)
    }

    @Test
    fun mobileDataOverrideDownloads() = runBlocking {
        val sha = MediaChecksum.sha256Hex(writeTemp(payloadV1))
        val fixture = startTiles(payloadV1, "v1", sha)
        val store = store(fixture.url, metered = true)
        store.ensure(allowMetered = true) { _, _ -> }
        assertTrue(store.isReady())
        assertTrue(fixture.tileGets >= 1)
    }

    private fun store(
        url: String,
        client: OkHttpClient = OkHttpClient.Builder().retryOnConnectionFailure(false).build(),
        metered: Boolean = false,
        usable: Long = Long.MAX_VALUE,
    ): YangonBasemapStore {
        return YangonBasemapStore(
            rootDir = root,
            downloadUrl = url,
            http = client,
            minReadyBytes = 4,
            isMetered = { metered },
            usableSpaceBytes = { usable },
        )
    }

    private fun seedLocal(bytes: ByteArray, version: String, sha256: String) {
        val store = store("https://example.invalid/basemaps/yangon/v1/basemap.pmtiles")
        val file = store.localFile()
        file.writeBytes(bytes)
        YangonBasemapStore.writeCompleteMarker(file, version, sha256)
    }

    private fun writeTemp(bytes: ByteArray): File {
        val file = File.createTempFile("hash", ".bin", root)
        file.writeBytes(bytes)
        return file
    }

    private fun startTiles(payload: ByteArray, version: String, sha256: String): TileFixture {
        val tileUrl = server.url("/basemaps/yangon/v1/basemap.pmtiles").toString()
        val fixture = TileFixture(tileUrl)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty()
                if (path.endsWith("/manifest.json")) {
                    val body =
                        """{"version":"$version","byteSize":${payload.size},"sha256":"$sha256","url":"$tileUrl"}"""
                    return MockResponse().setBody(body)
                }
                if (path.contains("basemap.pmtiles")) {
                    fixture.tileGets += 1
                    val range = request.getHeader("Range")
                    if (range != null && range.startsWith("bytes=")) {
                        fixture.rangeRequests += 1
                        val start = range.removePrefix("bytes=").substringBefore('-').toLong().toInt()
                        val slice = payload.copyOfRange(start.coerceAtLeast(0), payload.size)
                        return MockResponse()
                            .setResponseCode(206)
                            .setHeader("Content-Range", "bytes $start-${payload.size - 1}/${payload.size}")
                            .setBody(Buffer().write(slice))
                    }
                    return MockResponse().setBody(Buffer().write(payload))
                }
                return MockResponse().setResponseCode(404)
            }
        }
        return fixture
    }

    private class TileFixture(val url: String) {
        var tileGets: Int = 0
        var rangeRequests: Int = 0
    }
}
