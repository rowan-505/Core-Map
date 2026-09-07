package com.coremapmm.fieldsurveyor.work

import com.coremapmm.fieldsurveyor.auth.AuthException
import com.coremapmm.fieldsurveyor.data.LocalReportMediaDao
import com.coremapmm.fieldsurveyor.data.LocalReportMediaEntity
import com.coremapmm.fieldsurveyor.data.MediaApiResult
import com.coremapmm.fieldsurveyor.data.MediaUploadIntent
import com.coremapmm.fieldsurveyor.log.FieldLog
import com.coremapmm.fieldsurveyor.media.MediaChecksum
import java.io.File
import kotlin.coroutines.cancellation.CancellationException

/**
 * Syncs one local JPEG or AAC clip: parent report must already be SYNCED.
 * Bytes go Android → R2. The API only sees JSON + HEAD.
 */
class MediaSyncRunner(
    private val hasSession: () -> Boolean,
    private val accessToken: suspend () -> String,
    private val media: LocalReportMediaDao,
    private val createUpload: (String, String, Long, String) -> MediaApiResult<MediaUploadIntent>,
    private val putObject: (MediaUploadIntent, File) -> OutboxHttpResult,
    private val complete: (String, String) -> MediaApiResult<Unit>,
    private val attach: (String, String, String) -> MediaApiResult<Unit>,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
) {
    suspend fun syncOne(): OutboxRunResult {
        if (!hasSession()) {
            return OutboxRunResult.Idle
        }
        val row = media.claimNext(nowMs()) ?: return OutboxRunResult.Idle
        FieldLog.event(
            "media_claim",
            mapOf(
                "media_id" to row.mediaPublicId,
                "report_id" to row.reportClientPublicId,
                "from_state" to row.syncState,
                "remote_set" to (row.remoteAssetPublicId != null).toString(),
            ),
        )
        try {
            val file = File(row.localPath)
            if (!file.isFile || file.length() != row.byteSize) {
                return finish(row, LocalReportMediaEntity.STATE_PERMANENT_ERROR, "Local file missing", OutboxRunResult.Processed)
            }
            if (row.checksumSha256.isNotBlank() && MediaChecksum.sha256Hex(file) != row.checksumSha256) {
                return finish(row, LocalReportMediaEntity.STATE_PERMANENT_ERROR, "Local file checksum mismatch", OutboxRunResult.Processed)
            }
            val token = accessToken()
            return when (val step = ensureReadyAsset(token, row, file)) {
                is AssetStep.Stop -> step.result
                is AssetStep.Ready -> when (val attached = attach(token, row.reportClientPublicId, step.assetId)) {
                    is MediaApiResult.Ok -> finish(row, LocalReportMediaEntity.STATE_SYNCED, null, OutboxRunResult.Processed)
                    is MediaApiResult.NeedNewUpload -> failTransient(row, attached.message)
                    is MediaApiResult.Http -> if (alreadyAttached(attached.result)) {
                        finish(row, LocalReportMediaEntity.STATE_SYNCED, null, OutboxRunResult.Processed)
                    } else {
                        applyHttp(row, attached.result)
                    }
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: AuthException) {
            return finish(row, LocalReportMediaEntity.STATE_RETRY, error.message, if (error.statusCode == 401) {
                OutboxRunResult.Idle
            } else {
                OutboxRunResult.RetryLater
            })
        } catch (error: Exception) {
            return applyHttp(row, OutboxSyncPolicy.classifyThrowable(error))
        } finally {
            releaseInterruptedClaim(row)
        }
    }

    private suspend fun releaseInterruptedClaim(row: LocalReportMediaEntity) {
        val current = media.findById(row.mediaPublicId) ?: return
        if (current.syncState != LocalReportMediaEntity.STATE_SYNCING) {
            return
        }
        finish(row, LocalReportMediaEntity.STATE_RETRY, "sync interrupted", OutboxRunResult.RetryLater)
    }

    private suspend fun finish(
        row: LocalReportMediaEntity,
        state: String,
        message: String?,
        result: OutboxRunResult,
    ): OutboxRunResult {
        media.updateState(row.mediaPublicId, state, message, nowMs())
        FieldLog.event(
            "media_state",
            mapOf(
                "media_id" to row.mediaPublicId,
                "report_id" to row.reportClientPublicId,
                "to_state" to state,
                "result" to result.toString(),
            ),
        )
        return result
    }

    private fun alreadyAttached(result: OutboxHttpResult): Boolean =
        result is OutboxHttpResult.Success ||
            (result is OutboxHttpResult.Permanent && result.httpCode == 409)

    private suspend fun ensureReadyAsset(
        token: String,
        row: LocalReportMediaEntity,
        file: File,
    ): AssetStep {
        val existing = row.remoteAssetPublicId
        if (existing != null) {
            when (val done = complete(token, existing)) {
                is MediaApiResult.Ok -> return AssetStep.Ready(existing)
                is MediaApiResult.NeedNewUpload -> media.clearRemoteAsset(row.mediaPublicId, nowMs())
                is MediaApiResult.Http -> return AssetStep.Stop(applyHttp(row, done.result))
            }
        }
        val intent = when (
            val created = createUpload(token, row.mimeType, file.length(), row.checksumSha256)
        ) {
            is MediaApiResult.Ok -> created.value
            is MediaApiResult.NeedNewUpload -> return AssetStep.Stop(failTransient(row, created.message))
            is MediaApiResult.Http -> return AssetStep.Stop(applyHttp(row, created.result))
        }
        media.setRemoteAssetIfAbsent(row.mediaPublicId, intent.publicId, nowMs())
        val stored = media.findById(row.mediaPublicId)?.remoteAssetPublicId ?: intent.publicId
        if (stored != intent.publicId) {
            return when (val done = complete(token, stored)) {
                is MediaApiResult.Ok -> AssetStep.Ready(stored)
                is MediaApiResult.NeedNewUpload -> {
                    media.clearRemoteAsset(row.mediaPublicId, nowMs())
                    AssetStep.Stop(failTransient(row, done.message))
                }
                is MediaApiResult.Http -> AssetStep.Stop(applyHttp(row, done.result))
            }
        }
        when (val put = putObject(intent, file)) {
            is OutboxHttpResult.Success -> Unit
            else -> {
                media.clearRemoteAsset(row.mediaPublicId, nowMs())
                return AssetStep.Stop(applyHttp(row, put))
            }
        }
        return when (val done = complete(token, stored)) {
            is MediaApiResult.Ok -> AssetStep.Ready(stored)
            is MediaApiResult.NeedNewUpload -> {
                media.clearRemoteAsset(row.mediaPublicId, nowMs())
                AssetStep.Stop(failTransient(row, done.message))
            }
            is MediaApiResult.Http -> AssetStep.Stop(applyHttp(row, done.result))
        }
    }

    private suspend fun failTransient(row: LocalReportMediaEntity, message: String): OutboxRunResult {
        return finish(row, LocalReportMediaEntity.STATE_RETRY, message, OutboxRunResult.RetryLater)
    }

    private suspend fun applyHttp(row: LocalReportMediaEntity, result: OutboxHttpResult): OutboxRunResult {
        val status = when (result) {
            is OutboxHttpResult.Success -> LocalReportMediaEntity.STATE_SYNCED
            is OutboxHttpResult.Permanent -> LocalReportMediaEntity.STATE_PERMANENT_ERROR
            is OutboxHttpResult.Transient -> LocalReportMediaEntity.STATE_RETRY
        }
        val message = when (result) {
            is OutboxHttpResult.Success -> null
            is OutboxHttpResult.Permanent -> result.message
            is OutboxHttpResult.Transient -> result.message
        }
        val run = when (result) {
            is OutboxHttpResult.Success -> OutboxRunResult.Processed
            is OutboxHttpResult.Permanent -> OutboxRunResult.Processed
            is OutboxHttpResult.Transient -> OutboxRunResult.RetryLater
        }
        return finish(row, status, message, run)
    }
}

private sealed class AssetStep {
    data class Ready(val assetId: String) : AssetStep()
    data class Stop(val result: OutboxRunResult) : AssetStep()
}
