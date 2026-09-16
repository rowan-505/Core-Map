package com.coremapmm.fieldsurveyor.offline

import android.content.Context
import android.net.ConnectivityManager
import com.coremapmm.fieldsurveyor.media.MediaChecksum
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean

class YangonBasemapStore(
    private val rootDir: File,
    private val downloadUrl: String,
    private val http: OkHttpClient,
    private val minReadyBytes: Long = MIN_READY_BYTES,
    private val isMetered: () -> Boolean = { false },
    private val usableSpaceBytes: () -> Long = {
        File(rootDir, "basemap").apply { mkdirs() }.usableSpace
    },
) {
    constructor(context: Context, downloadUrl: String, http: OkHttpClient) : this(
        rootDir = context.applicationContext.filesDir,
        downloadUrl = downloadUrl,
        http = http,
        isMetered = {
            val manager = context.applicationContext.getSystemService(ConnectivityManager::class.java)
            manager?.isActiveNetworkMetered == true
        },
    )

    private val cancelled = AtomicBoolean(false)
    @Volatile private var activeCall: Call? = null

    fun cancelDownload() {
        cancelled.set(true)
        activeCall?.cancel()
    }

    fun localFile(): File = File(File(rootDir, "basemap").apply { mkdirs() }, FILE_NAME)

    fun isReady(): Boolean = isComplete(localFile(), minReadyBytes)

    fun sizeBytes(): Long = localFile().takeIf { it.isFile }?.length() ?: 0L

    fun localVersion(): String? {
        val marker = File(localFile().path + ".ok")
        if (!marker.isFile) return null
        return OfflineMapPolicy.parseMarker(marker.readText()).second
    }

    suspend fun probeManifest(): YangonMapManifest = withContext(Dispatchers.IO) {
        loadManifest()
    }

    suspend fun ensure(
        allowMetered: Boolean = true,
        onProgress: (downloaded: Long, total: Long) -> Unit,
    ) {
        withContext(Dispatchers.IO) {
            cancelled.set(false)
            val dest = localFile()
            val marker = File(dest.path + ".ok")
            val tmp = File(dest.path + ".tmp")
            val manifest = loadManifest()
            val localSha = OfflineMapPolicy.parseMarker(marker.takeIf { it.isFile }?.readText().orEmpty()).third
            if (
                OfflineMapPolicy.skipUnchanged(
                    localComplete = isComplete(dest, minReadyBytes),
                    localVersion = localVersion(),
                    localBytes = dest.takeIf { it.isFile }?.length() ?: 0L,
                    localSha256 = localSha,
                    manifest = manifest,
                )
            ) {
                writeCompleteMarker(dest, manifest.version, localSha ?: manifest.sha256)
                onProgress(dest.length(), dest.length())
                return@withContext
            }
            if (!OfflineMapPolicy.canDownload(isMetered(), allowMetered)) {
                throw IOException(OfflineMapPolicy.METERED_MESSAGE)
            }
            val expected = if (manifest.byteSize > 0L) manifest.byteSize else 0L
            val tmpAlready = tmp.takeIf { it.isFile }?.length() ?: 0L
            val keeping = dest.takeIf { it.isFile }?.length() ?: 0L
            val needed = OfflineMapPolicy.neededBytes(
                expectedBytes = if (expected > 0L) expected else minReadyBytes,
                tmpAlready = tmpAlready,
                keepingCurrentBytes = keeping,
            )
            if (!OfflineMapPolicy.hasStorage(usableSpaceBytes(), needed)) {
                throw IOException(OfflineMapPolicy.STORAGE_MESSAGE)
            }
            downloadToTmp(manifest.url, tmp, expected, onProgress)
            val actualSha = MediaChecksum.sha256Hex(tmp)
            if (!manifest.sha256.isNullOrBlank() && actualSha != manifest.sha256) {
                tmp.delete()
                throw IOException(OfflineMapPolicy.CHECKSUM_MESSAGE)
            }
            if (expected > 0L && tmp.length() != expected) {
                tmp.delete()
                throw IOException("Yangon map file was incomplete")
            }
            if (tmp.length() < minReadyBytes) {
                tmp.delete()
                throw IOException("Yangon map file was incomplete")
            }
            if (!OfflineMapPolicy.replaceAtomically(tmp, dest)) {
                throw IOException("Could not replace Yangon map")
            }
            writeCompleteMarker(dest, manifest.version, actualSha)
            onProgress(dest.length(), dest.length())
        }
    }

    private fun loadManifest(): YangonMapManifest {
        val manifestRequest = Request.Builder().url(YangonMapManifestParser.manifestUrl(downloadUrl)).get().build()
        runCatching {
            http.newCall(manifestRequest).execute().use { response ->
                if (response.isSuccessful) {
                    val body = response.body?.string().orEmpty()
                    if (body.isNotBlank()) {
                        return YangonMapManifestParser.parse(body, downloadUrl)
                    }
                }
            }
        }
        val head = Request.Builder().url(downloadUrl).head().build()
        runCatching {
            http.newCall(head).execute().use { response ->
                val size = response.header("Content-Length")?.toLongOrNull() ?: -1L
                return YangonMapManifestParser.fromHead(size, downloadUrl)
            }
        }
        return YangonMapManifestParser.fromHead(-1L, downloadUrl)
    }

    private fun downloadToTmp(
        url: String,
        tmp: File,
        expected: Long,
        onProgress: (Long, Long) -> Unit,
    ) {
        tmp.parentFile?.mkdirs()
        var offset = tmp.takeIf { it.isFile }?.length() ?: 0L
        var attempts = 0
        while (attempts < 2) {
            attempts += 1
            if (cancelled.get()) {
                throw IOException(OfflineMapPolicy.CANCELLED_MESSAGE)
            }
            val builder = Request.Builder().url(url).get()
            OfflineMapPolicy.rangeHeader(offset)?.let { builder.header("Range", it) }
            val call = http.newCall(builder.build())
            activeCall = call
            try {
                call.execute().use { response ->
                    val code = response.code
                    if (code == 416) {
                        tmp.delete()
                        offset = 0L
                        return@use
                    }
                    if (code == 200 && offset > 0L) {
                        tmp.delete()
                        offset = 0L
                    }
                    if (code != 200 && code != 206) {
                        throw IOException("Yangon map download failed ($code)")
                    }
                    val append = OfflineMapPolicy.appendPartial(code) && offset > 0L && tmp.isFile
                    val body = response.body ?: throw IOException("Empty Yangon map response")
                    val total = when {
                        expected > 0L -> expected
                        code == 206 -> offset + body.contentLength().coerceAtLeast(0L)
                        else -> body.contentLength()
                    }
                    FileOutputStream(tmp, append).use { output ->
                        var copied = if (append) offset else 0L
                        var lastReported = -1L
                        body.byteStream().use { input ->
                            val buffer = ByteArray(256 * 1024)
                            while (true) {
                                if (cancelled.get()) {
                                    throw IOException(OfflineMapPolicy.CANCELLED_MESSAGE)
                                }
                                val read = input.read(buffer)
                                if (read < 0) break
                                output.write(buffer, 0, read)
                                copied += read
                                if (lastReported < 0L || copied - lastReported >= 1_000_000L) {
                                    lastReported = copied
                                    onProgress(copied, total)
                                }
                            }
                        }
                        onProgress(copied, total)
                    }
                    return
                }
            } catch (error: IOException) {
                if (cancelled.get()) {
                    throw IOException(OfflineMapPolicy.CANCELLED_MESSAGE)
                }
                throw error
            } finally {
                if (activeCall === call) {
                    activeCall = null
                }
            }
            if (offset != 0L) {
                break
            }
        }
        throw IOException("Yangon map download failed")
    }

    companion object {
        const val FILE_NAME = "yangon.pmtiles"
        /** Floor so tiny/corrupt files never count as ready. Yangon v2 is ~119 MB. */
        const val MIN_READY_BYTES = 80_000_000L

        fun isComplete(file: File, minReadyBytes: Long = MIN_READY_BYTES): Boolean {
            return OfflineMapPolicy.isComplete(file, File(file.path + ".ok"), minReadyBytes)
        }

        fun writeCompleteMarker(file: File, version: String = "v2", sha256: String? = null) {
            File(file.path + ".ok").writeText(OfflineMapPolicy.markerText(file.length(), version, sha256))
        }
    }
}
