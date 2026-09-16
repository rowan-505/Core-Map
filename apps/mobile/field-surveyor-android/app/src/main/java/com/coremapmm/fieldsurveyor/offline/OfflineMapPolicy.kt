package com.coremapmm.fieldsurveyor.offline

import org.json.JSONObject
import java.io.File

data class YangonMapManifest(
    val version: String,
    val byteSize: Long,
    val sha256: String?,
    val url: String,
)

object YangonMapManifestParser {
    /** Used when manifest.json is missing and HEAD has no Content-Length (Yangon v2 ≈ 119 MB). */
    const val FALLBACK_BYTES = 120_000_000L

    fun manifestUrl(downloadUrl: String): String {
        val slash = downloadUrl.lastIndexOf('/')
        return if (slash <= 0) downloadUrl else downloadUrl.substring(0, slash) + "/manifest.json"
    }

    fun versionFromUrl(downloadUrl: String): String {
        val parts = downloadUrl.trimEnd('/').split('/')
        val versionPart = parts.getOrNull(parts.size - 2).orEmpty()
        return versionPart.ifBlank { "v1" }
    }

    fun parse(json: String, fallbackUrl: String): YangonMapManifest {
        val root = JSONObject(json)
        return YangonMapManifest(
            version = root.optString("version").ifBlank { versionFromUrl(fallbackUrl) },
            byteSize = root.optLong("byteSize", 0L).takeIf { it > 0L } ?: FALLBACK_BYTES,
            sha256 = root.optString("sha256").trim().lowercase().takeIf { it.length == 64 },
            url = root.optString("url").ifBlank { fallbackUrl },
        )
    }

    fun fromHead(byteSize: Long, downloadUrl: String): YangonMapManifest {
        return YangonMapManifest(
            version = versionFromUrl(downloadUrl),
            byteSize = if (byteSize > 0L) byteSize else FALLBACK_BYTES,
            sha256 = null,
            url = downloadUrl,
        )
    }
}

object OfflineMapPolicy {
    const val STORAGE_HEADROOM_BYTES = 8L * 1024 * 1024
    const val METERED_MESSAGE = "Network is required for this map download."
    const val STORAGE_MESSAGE = "Not enough storage for this map."
    const val CHECKSUM_MESSAGE = "Map checksum did not match. Kept the last valid map."
    const val CANCELLED_MESSAGE = "Map download cancelled. Partial file kept for resume."

    /** Downloads are allowed on Wi-Fi and cellular. */
    fun canDownload(@Suppress("UNUSED_PARAMETER") metered: Boolean, @Suppress("UNUSED_PARAMETER") allowMetered: Boolean): Boolean =
        true

    fun neededBytes(expectedBytes: Long, tmpAlready: Long, keepingCurrentBytes: Long): Long {
        val remaining = (expectedBytes - tmpAlready).coerceAtLeast(0L)
        return remaining + keepingCurrentBytes + STORAGE_HEADROOM_BYTES
    }

    fun hasStorage(usableBytes: Long, needed: Long): Boolean = usableBytes >= needed

    fun skipUnchanged(
        localComplete: Boolean,
        localVersion: String?,
        localBytes: Long,
        localSha256: String?,
        manifest: YangonMapManifest,
    ): Boolean {
        if (!localComplete) return false
        if (manifest.byteSize > 0L && localBytes != manifest.byteSize) return false
        if (localVersion != null && localVersion != manifest.version) return false
        if (!manifest.sha256.isNullOrBlank() && localSha256 != manifest.sha256) return false
        return localVersion == manifest.version || localBytes == manifest.byteSize
    }

    fun rangeHeader(tmpBytes: Long): String? = if (tmpBytes > 0L) "bytes=$tmpBytes-" else null

    fun appendPartial(httpCode: Int): Boolean = httpCode == 206

    fun restartPartial(httpCode: Int): Boolean = httpCode == 200 || httpCode == 416

    fun markerText(bytes: Long, version: String, sha256: String?): String {
        return buildString {
            append(bytes)
            append('\n')
            append("version=").append(version)
            if (!sha256.isNullOrBlank()) {
                append('\n')
                append("sha256=").append(sha256)
            }
        }
    }

    fun parseMarker(text: String): Triple<Long?, String?, String?> {
        val lines = text.trim().lines()
        val bytes = lines.firstOrNull()?.toLongOrNull()
        var version: String? = null
        var sha: String? = null
        lines.drop(1).forEach { line ->
            when {
                line.startsWith("version=") -> version = line.removePrefix("version=").trim()
                line.startsWith("sha256=") -> sha = line.removePrefix("sha256=").trim().lowercase()
            }
        }
        return Triple(bytes, version, sha)
    }

    fun isComplete(file: File, marker: File, minReadyBytes: Long): Boolean {
        if (!file.isFile || file.length() < minReadyBytes || !marker.isFile) {
            return false
        }
        val (bytes, _, _) = parseMarker(marker.readText())
        return bytes == file.length()
    }

    fun replaceAtomically(verified: File, dest: File): Boolean {
        if (!verified.isFile) return false
        if (dest.exists() && verified.canonicalFile == dest.canonicalFile) return true
        val parent = dest.parentFile ?: return false
        parent.mkdirs()
        val staged = File(parent, dest.name + ".new")
        if (verified.canonicalFile != staged.canonicalFile) {
            verified.copyTo(staged, overwrite = true)
            if (verified.exists() && verified.canonicalFile != dest.canonicalFile) {
                verified.delete()
            }
        }
        val backup = File(parent, dest.name + ".bak")
        backup.delete()
        if (dest.exists() && !dest.renameTo(backup)) {
            staged.delete()
            return false
        }
        if (!staged.renameTo(dest)) {
            if (backup.exists()) {
                backup.renameTo(dest)
            }
            staged.delete()
            return false
        }
        backup.delete()
        return dest.isFile
    }
}
