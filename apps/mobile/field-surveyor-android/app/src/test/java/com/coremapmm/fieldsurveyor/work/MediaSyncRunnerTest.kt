package com.coremapmm.fieldsurveyor.work

import com.coremapmm.fieldsurveyor.data.LocalReportMediaEntity
import com.coremapmm.fieldsurveyor.data.MediaApiResult
import com.coremapmm.fieldsurveyor.data.MediaUploadIntent
import com.coremapmm.fieldsurveyor.media.MediaChecksum
import com.coremapmm.fieldsurveyor.media.MemoryMediaDao
import com.coremapmm.fieldsurveyor.work.OutboxHttpResult
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class MediaSyncRunnerTest {
    @Test
    fun fullHappyPathPutsThenCompletesThenAttaches() = runBlocking {
        val dao = MemoryMediaDao()
        val file = jpegFile()
        dao.insert(mediaRow(file))
        val log = mutableListOf<String>()
        val result = runner(dao, log).syncOne()
        assertEquals(OutboxRunResult.Processed, result)
        assertEquals(LocalReportMediaEntity.STATE_SYNCED, dao.rows.values.single().syncState)
        assertEquals(listOf("upload", "put", "complete", "attach"), log)
        assertEquals("asset-1", dao.rows.values.single().remoteAssetPublicId)
        assertTrue(file.isFile)
    }

    @Test
    fun reportsStayIndependentWhenParentNotSynced() = runBlocking {
        val dao = MemoryMediaDao().also { it.parentSynced = { false } }
        dao.insert(mediaRow(jpegFile()))
        val result = runner(dao).syncOne()
        assertEquals(OutboxRunResult.Idle, result)
        assertEquals(LocalReportMediaEntity.STATE_LOCAL, dao.rows.values.single().syncState)
    }

    @Test
    fun reportSyncedMediaStaysPendingUntilMediaWorker() = runBlocking {
        val dao = MemoryMediaDao().also { it.parentSynced = { true } }
        val file = jpegFile()
        dao.insert(mediaRow(file))
        assertEquals(LocalReportMediaEntity.STATE_LOCAL, dao.rows.values.single().syncState)
        assertTrue(file.isFile)
        assertEquals("LOCAL", dao.nextEligible(Long.MIN_VALUE)?.syncState)
    }

    @Test
    fun expiredPutClearsRemoteIdAndRetries() = runBlocking {
        val dao = MemoryMediaDao()
        val file = jpegFile()
        dao.insert(mediaRow(file))
        var puts = 0
        val first = runner(
            dao,
            put = {
                puts += 1
                OutboxHttpResult.Transient(403, "expired")
            },
        ).syncOne()
        assertEquals(OutboxRunResult.RetryLater, first)
        assertNull(dao.rows.values.single().remoteAssetPublicId)
        assertTrue(file.isFile)
        val second = runner(dao).syncOne()
        assertEquals(OutboxRunResult.Processed, second)
        assertEquals(1, puts)
        assertEquals(LocalReportMediaEntity.STATE_SYNCED, dao.rows.values.single().syncState)
    }

    @Test
    fun interruptedPutKeepsLocalFileAndRetriesWithNewKey() = runBlocking {
        val dao = MemoryMediaDao()
        val file = jpegFile()
        dao.insert(mediaRow(file))
        val keys = mutableListOf<String>()
        val first = runner(
            dao,
            createUpload = {
                keys += "asset-a"
                MediaApiResult.Ok(intent("asset-a"))
            },
            put = { OutboxHttpResult.Transient(null, "timeout") },
        ).syncOne()
        assertEquals(OutboxRunResult.RetryLater, first)
        assertTrue(file.isFile)
        assertNull(dao.rows.values.single().remoteAssetPublicId)
        val second = runner(
            dao,
            createUpload = {
                keys += "asset-b"
                MediaApiResult.Ok(intent("asset-b"))
            },
        ).syncOne()
        assertEquals(OutboxRunResult.Processed, second)
        assertEquals(listOf("asset-a", "asset-b"), keys)
        assertEquals("asset-b", dao.rows.values.single().remoteAssetPublicId)
    }

    @Test
    fun activeUploadLeasePreventsDuplicateClaim() = runBlocking {
        val dao = MemoryMediaDao()
        dao.insert(mediaRow(jpegFile()))
        val first = dao.claimNext(1L)!!
        val second = dao.claimNext(2L)
        assertNull(second)
        dao.setRemoteAssetIfAbsent(first.mediaPublicId, "winner", 3L)
        assertEquals("winner", dao.rows.values.single().remoteAssetPublicId)
    }

    @Test
    fun interruptedPutThenCompleteNotFoundRequestsNewUpload() = runBlocking {
        val dao = MemoryMediaDao()
        val row = mediaRow(jpegFile()).copy(remoteAssetPublicId = "old-asset")
        dao.insert(row)
        var uploads = 0
        val result = runner(
            dao,
            complete = { id ->
                if (id == "old-asset") MediaApiResult.NeedNewUpload("OBJECT_NOT_FOUND") else MediaApiResult.Ok(Unit)
            },
            createUpload = {
                uploads += 1
                MediaApiResult.Ok(intent("new-asset"))
            },
        ).syncOne()
        assertEquals(OutboxRunResult.Processed, result)
        assertEquals(1, uploads)
        assertEquals("new-asset", dao.rows.values.single().remoteAssetPublicId)
    }

    @Test
    fun cancelledClaimRevertsToRetrySoAnotherWorkerCanContinue() = runBlocking {
        val dao = MemoryMediaDao()
        dao.insert(mediaRow(jpegFile()))
        val job = launch {
            runner(
                dao,
                accessToken = { awaitCancellation() },
            ).syncOne()
        }
        while (dao.rows.values.single().syncState != LocalReportMediaEntity.STATE_SYNCING) {
            kotlinx.coroutines.yield()
        }
        job.cancelAndJoin()
        assertEquals(LocalReportMediaEntity.STATE_RETRY, dao.rows.values.single().syncState)
        val retry = runner(dao, nowMs = { 20L }).syncOne()
        assertEquals(OutboxRunResult.Processed, retry)
        assertEquals(LocalReportMediaEntity.STATE_SYNCED, dao.rows.values.single().syncState)
    }

    @Test
    fun alreadyAttachedConflictReconcilesLocalStateToSynced() = runBlocking {
        val dao = MemoryMediaDao()
        dao.insert(mediaRow(jpegFile()).copy(remoteAssetPublicId = "asset-ready"))
        val result = runner(
            dao,
            createUpload = { error("should not create") },
            put = { error("should not put") },
            attach = { MediaApiResult.Http(OutboxHttpResult.Permanent(409, "already attached")) },
        ).syncOne()
        assertEquals(OutboxRunResult.Processed, result)
        assertEquals(LocalReportMediaEntity.STATE_SYNCED, dao.rows.values.single().syncState)
        assertEquals("asset-ready", dao.rows.values.single().remoteAssetPublicId)
    }

    @Test
    fun alreadyCompletedAssetReconcilesWithoutNewUpload() = runBlocking {
        val dao = MemoryMediaDao()
        dao.insert(
            mediaRow(jpegFile()).copy(
                remoteAssetPublicId = "asset-ready",
                syncState = LocalReportMediaEntity.STATE_RETRY,
            ),
        )
        val log = mutableListOf<String>()
        val result = runner(
            dao,
            log,
            createUpload = { error("should not create") },
            put = { error("should not put") },
        ).syncOne()
        assertEquals(OutboxRunResult.Processed, result)
        assertEquals(listOf("complete", "attach"), log)
        assertEquals(LocalReportMediaEntity.STATE_SYNCED, dao.rows.values.single().syncState)
    }

    @Test
    fun restartCompletesExistingRemoteWithoutSecondPut() = runBlocking {
        val dao = MemoryMediaDao()
        dao.insert(mediaRow(jpegFile()).copy(remoteAssetPublicId = "asset-ready", syncState = LocalReportMediaEntity.STATE_SYNCING))
        val log = mutableListOf<String>()
        runner(
            dao,
            log,
            createUpload = { error("should not create") },
            put = { error("should not put") },
            nowMs = { com.coremapmm.fieldsurveyor.data.SyncClaimPolicy.LEASE_MS + 2L },
        ).syncOne()
        assertEquals(listOf("complete", "attach"), log)
        assertEquals(LocalReportMediaEntity.STATE_SYNCED, dao.rows.values.single().syncState)
    }

    @Test
    fun deletedLocalFileIsPermanentAndDoesNotDeleteReportRow() = runBlocking {
        val dao = MemoryMediaDao()
        val file = jpegFile()
        dao.insert(mediaRow(file))
        assertTrue(file.delete())
        val result = runner(dao).syncOne()
        assertEquals(OutboxRunResult.Processed, result)
        assertEquals(LocalReportMediaEntity.STATE_PERMANENT_ERROR, dao.rows.values.single().syncState)
        assertEquals("Local file missing", dao.rows.values.single().lastError)
    }

    @Test
    fun createUploadUsesStoredMimeType() = runBlocking {
        val dao = MemoryMediaDao()
        val file = File.createTempFile("clip", ".m4a").apply { writeBytes(ByteArray(32) { 1 }) }
        dao.insert(mediaRow(file).copy(mimeType = LocalReportMediaEntity.MIME_AAC, checksumSha256 = MediaChecksum.sha256Hex(file)))
        var mime = ""
        var checksum = ""
        val result = MediaSyncRunner(
            hasSession = { true },
            accessToken = { "token" },
            media = dao,
            createUpload = { _, nextMime, _, nextChecksum ->
                mime = nextMime
                checksum = nextChecksum
                MediaApiResult.Ok(intent("asset-1").copy(contentType = nextMime))
            },
            putObject = { _, _ -> OutboxHttpResult.Success(200) },
            complete = { _, _ -> MediaApiResult.Ok(Unit) },
            attach = { _, _, _ -> MediaApiResult.Ok(Unit) },
            nowMs = { 10L },
        ).syncOne()
        assertEquals(OutboxRunResult.Processed, result)
        assertEquals(LocalReportMediaEntity.MIME_AAC, mime)
        assertEquals(MediaChecksum.sha256Hex(file), checksum)
    }

    private fun runner(
        dao: MemoryMediaDao,
        log: MutableList<String> = mutableListOf(),
        accessToken: suspend () -> String = { "token" },
        createUpload: () -> MediaApiResult<MediaUploadIntent> = {
            log += "upload"
            MediaApiResult.Ok(intent("asset-1"))
        },
        put: () -> OutboxHttpResult = {
            log += "put"
            OutboxHttpResult.Success(200)
        },
        complete: (String) -> MediaApiResult<Unit> = {
            log += "complete"
            MediaApiResult.Ok(Unit)
        },
        attach: () -> MediaApiResult<Unit> = {
            log += "attach"
            MediaApiResult.Ok(Unit)
        },
        nowMs: () -> Long = { 10L },
    ) = MediaSyncRunner(
        hasSession = { true },
        accessToken = accessToken,
        media = dao,
        createUpload = { _, _, _, _ -> createUpload() },
        putObject = { _, _ -> put() },
        complete = { _, id -> complete(id) },
        attach = { _, _, _ -> attach() },
        nowMs = nowMs,
    )

    private fun intent(id: String) = MediaUploadIntent(
        id,
        "https://example.invalid/put/$id",
        "image/jpeg",
        "32",
    )

    private fun jpegFile(): File = File.createTempFile("photo", ".jpg").apply { writeBytes(ByteArray(32) { 1 }) }

    private fun mediaRow(file: File) = LocalReportMediaEntity(
        mediaPublicId = "media-1",
        reportClientPublicId = "report-1",
        localPath = file.absolutePath,
        mimeType = LocalReportMediaEntity.MIME_JPEG,
        byteSize = file.length(),
        pixelWidth = 1600,
        pixelHeight = 1200,
        checksumSha256 = MediaChecksum.sha256Hex(file),
        durationMs = null,
        syncState = LocalReportMediaEntity.STATE_LOCAL,
        remoteAssetPublicId = null,
        createdAtEpochMs = 1L,
        updatedAtEpochMs = 1L,
    )
}
