package com.coremapmm.fieldsurveyor.media

import com.coremapmm.fieldsurveyor.data.LocalReportMediaDao
import com.coremapmm.fieldsurveyor.data.LocalReportMediaEntity
import java.io.File

object MediaRetention {
    const val KEEP_AFTER_SYNC_MS = 7L * 24 * 60 * 60 * 1000

    fun canDeleteSyncedLocalFile(updatedAtEpochMs: Long, nowMs: Long): Boolean =
        nowMs - updatedAtEpochMs >= KEEP_AFTER_SYNC_MS
}

class MediaRetentionCleanup(
    private val dao: LocalReportMediaDao,
    private val mediaDir: File,
) {
    suspend fun run(nowMs: Long) {
        val cutoff = nowMs - MediaRetention.KEEP_AFTER_SYNC_MS
        dao.listSyncedReadyForCleanup(cutoff).forEach { row ->
            File(row.localPath).delete()
        }
        val known = dao.allLocalPaths().toHashSet()
        mediaDir.listFiles()?.forEach { file ->
            if (file.absolutePath !in known && MediaRetention.canDeleteSyncedLocalFile(file.lastModified(), nowMs)) {
                file.delete()
            }
        }
    }
}
