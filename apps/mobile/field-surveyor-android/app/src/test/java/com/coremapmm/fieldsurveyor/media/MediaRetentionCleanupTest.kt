package com.coremapmm.fieldsurveyor.media

import com.coremapmm.fieldsurveyor.data.LocalReportMediaEntity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class MediaRetentionCleanupTest {
    @Test
    fun doesNotDeleteBeforeRetention() {
        assertFalse(MediaRetention.canDeleteSyncedLocalFile(100L, 100L + MediaRetention.KEEP_AFTER_SYNC_MS - 1))
        assertTrue(MediaRetention.canDeleteSyncedLocalFile(100L, 100L + MediaRetention.KEEP_AFTER_SYNC_MS))
    }

    @Test
    fun deletesOnlySyncedFilesPastRetention() = runBlocking {
        val dao = MemoryMediaDao()
        val dir = File.createTempFile("retain", "dir").also {
            it.delete()
            it.mkdirs()
        }
        val keep = File(dir, "keep.jpg").apply { writeBytes(byteArrayOf(1)) }
        val drop = File(dir, "drop.jpg").apply { writeBytes(byteArrayOf(2)) }
        val orphan = File(dir, "orphan.jpg").apply {
            writeBytes(byteArrayOf(3))
            setLastModified(1L)
        }
        dao.insert(
            LocalReportMediaEntity(
                mediaPublicId = "a",
                reportClientPublicId = "r",
                localPath = keep.absolutePath,
                mimeType = LocalReportMediaEntity.MIME_JPEG,
                byteSize = 1,
                syncState = LocalReportMediaEntity.STATE_LOCAL,
                remoteAssetPublicId = null,
                createdAtEpochMs = 1,
                updatedAtEpochMs = 1,
            ),
        )
        dao.insert(
            LocalReportMediaEntity(
                mediaPublicId = "b",
                reportClientPublicId = "r",
                localPath = drop.absolutePath,
                mimeType = LocalReportMediaEntity.MIME_JPEG,
                byteSize = 1,
                syncState = LocalReportMediaEntity.STATE_SYNCED,
                remoteAssetPublicId = "asset",
                createdAtEpochMs = 1,
                updatedAtEpochMs = 1,
            ),
        )
        MediaRetentionCleanup(dao, dir).run(nowMs = 1L + MediaRetention.KEEP_AFTER_SYNC_MS)
        assertTrue(keep.isFile)
        assertFalse(drop.isFile)
        assertFalse(orphan.isFile)
        assertEquals(2, dao.rows.size)
    }
}
