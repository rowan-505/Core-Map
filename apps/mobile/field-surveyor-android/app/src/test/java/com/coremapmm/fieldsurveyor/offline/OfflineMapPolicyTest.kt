package com.coremapmm.fieldsurveyor.offline

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OfflineMapPolicyTest {
    private val manifest = YangonMapManifest(
        version = "v1",
        byteSize = 100L,
        sha256 = "a".repeat(64),
        url = "https://example.invalid/basemap.pmtiles",
    )

    @Test
    fun anyNetworkAllowsDownload() {
        assertTrue(OfflineMapPolicy.canDownload(metered = false, allowMetered = false))
        assertTrue(OfflineMapPolicy.canDownload(metered = true, allowMetered = false))
        assertTrue(OfflineMapPolicy.canDownload(metered = true, allowMetered = true))
    }

    @Test
    fun storagePreflightKeepsCurrentFileBytes() {
        val needed = OfflineMapPolicy.neededBytes(expectedBytes = 100, tmpAlready = 20, keepingCurrentBytes = 100)
        assertEquals(80 + 100 + OfflineMapPolicy.STORAGE_HEADROOM_BYTES, needed)
        assertFalse(OfflineMapPolicy.hasStorage(usableBytes = needed - 1, needed = needed))
        assertTrue(OfflineMapPolicy.hasStorage(usableBytes = needed, needed = needed))
    }

    @Test
    fun skipUnchangedRequiresMatchingVersionSizeAndChecksum() {
        assertTrue(
            OfflineMapPolicy.skipUnchanged(true, "v1", 100L, "a".repeat(64), manifest),
        )
        assertFalse(
            OfflineMapPolicy.skipUnchanged(true, "v0", 100L, "a".repeat(64), manifest),
        )
        assertFalse(
            OfflineMapPolicy.skipUnchanged(true, "v1", 99L, "a".repeat(64), manifest),
        )
        assertFalse(
            OfflineMapPolicy.skipUnchanged(true, "v1", 100L, "b".repeat(64), manifest),
        )
    }

    @Test
    fun cancelKeepsPartialForResume() {
        assertTrue(OfflineMapPolicy.CANCELLED_MESSAGE.contains("resume"))
        assertEquals("bytes=20-", OfflineMapPolicy.rangeHeader(20L))
    }
}
