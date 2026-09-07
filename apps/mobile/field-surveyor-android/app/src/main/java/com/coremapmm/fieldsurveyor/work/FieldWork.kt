package com.coremapmm.fieldsurveyor.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.coremapmm.fieldsurveyor.FieldApp
import com.coremapmm.fieldsurveyor.data.SyncClaimPolicy
import com.coremapmm.fieldsurveyor.device.DeviceStatus
import com.coremapmm.fieldsurveyor.log.FieldLog
import com.coremapmm.fieldsurveyor.media.MediaRetentionCleanup
import com.coremapmm.fieldsurveyor.media.ReportPhotoStore
import com.coremapmm.fieldsurveyor.offline.OfflineMapPolicy
import java.util.concurrent.TimeUnit

internal enum class SyncStage { REPORTS, MEDIA }

internal object FieldWorkPolicy {
    fun defaultStages() = listOf(SyncStage.REPORTS, SyncStage.MEDIA)
    fun meteredOverrideStages() = listOf(SyncStage.MEDIA)

    fun uniqueMediaWorkPolicy(@Suppress("UNUSED_PARAMETER") allowMetered: Boolean): String = "APPEND_OR_REPLACE"

    fun mediaShouldRetry(retryLater: Boolean, hasEligible: Boolean, hasFreshSyncing: Boolean): Boolean =
        retryLater || hasEligible || hasFreshSyncing
}

/** Report JSON: any network. Media: Wi-Fi by default. */
class OutboxSyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as? FieldApp ?: return Result.success()
        val graph = app.graph
        val reportsRunner = OutboxSyncRunner(
            hasSession = { graph.auth.currentSession() != null },
            accessToken = { graph.auth.validAccessToken() },
            reports = graph.reports,
            post = graph.fieldReportsApi::create,
        )
        val sessionsRunner = SurveySessionSyncRunner(
            hasAuth = { graph.auth.currentSession() != null },
            token = { graph.auth.validAccessToken() },
            sessions = graph.sessionDao,
            create = graph.fieldSurveySessionsApi::create,
            end = graph.fieldSurveySessionsApi::end,
        )
        var retryLater = false
        var sessionProcessed = 0
        while (sessionProcessed < 20) {
            when (sessionsRunner.syncOne()) {
                OutboxRunResult.Idle -> break
                OutboxRunResult.Processed -> sessionProcessed += 1
                OutboxRunResult.RetryLater -> return Result.retry()
            }
        }
        var processed = 0
        while (processed < 20) {
            when (reportsRunner.syncOne()) {
                OutboxRunResult.Idle -> break
                OutboxRunResult.Processed -> processed += 1
                OutboxRunResult.RetryLater -> {
                    retryLater = true
                    break
                }
            }
        }
        if (retryLater) {
            return Result.retry()
        }
        val moreSessions = graph.sessionDao.nextEligible() != null
        val moreReports = graph.reports.nextEligible() != null
        return if (moreSessions || moreReports) {
            Result.retry()
        } else {
            FieldWork.enqueueMedia(applicationContext)
            Result.success()
        }
    }
}

class MediaSyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as? FieldApp ?: return Result.success()
        val graph = app.graph
        if (!OfflineMapPolicy.canDownload(DeviceStatus.isMetered(applicationContext), MediaMeteredOptIn.get(applicationContext))) {
            return Result.retry()
        }
        val mediaRunner = MediaSyncRunner(
            hasSession = { graph.auth.currentSession() != null },
            accessToken = { graph.auth.validAccessToken() },
            media = graph.reportMedia,
            createUpload = { token, mimeType, byteSize, checksumSha256 ->
                graph.fieldMediaApi.createUpload(token, mimeType, byteSize, checksumSha256)
            },
            putObject = graph.fieldMediaApi::putObject,
            complete = graph.fieldMediaApi::complete,
            attach = graph.fieldMediaApi::attach,
        )
        var retryLater = false
        var mediaProcessed = 0
        var attempts = 0
        while (mediaProcessed < 20) {
            attempts += 1
            when (mediaRunner.syncOne()) {
                OutboxRunResult.Idle -> break
                OutboxRunResult.Processed -> mediaProcessed += 1
                OutboxRunResult.RetryLater -> {
                    retryLater = true
                    break
                }
            }
        }
        FieldLog.event(
            "media_worker",
            mapOf(
                "attempts" to attempts.toString(),
                "processed" to mediaProcessed.toString(),
                "retry_later" to retryLater.toString(),
            ),
        )
        MediaRetentionCleanup(graph.reportMedia, ReportPhotoStore.dir(app.noBackupFilesDir)).run(System.currentTimeMillis())
        val now = System.currentTimeMillis()
        val staleBefore = now - SyncClaimPolicy.LEASE_MS
        val hasEligible = graph.reportMedia.nextEligible(staleBefore) != null
        val hasFreshSyncing = graph.reportMedia.countFreshSyncing(staleBefore) > 0
        if (!retryLater && !hasEligible && !hasFreshSyncing) {
            MediaMeteredOptIn.clear(applicationContext)
        }
        return if (FieldWorkPolicy.mediaShouldRetry(retryLater, hasEligible, hasFreshSyncing)) {
            Result.retry()
        } else {
            Result.success()
        }
    }
}

object FieldWork {
    const val UNIQUE_NAME = "field-outbox-sync"
    const val MEDIA_WIFI = "field-outbox-media"
    const val MEDIA_CELLULAR = MEDIA_WIFI
    private const val LEGACY_MEDIA_CELLULAR = "field-outbox-media-cellular"

    fun enqueue(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(LEGACY_MEDIA_CELLULAR)
        enqueueReports(context)
        enqueueMedia(context)
    }

    fun enqueueMediaOverCellular(context: Context) {
        MediaMeteredOptIn.set(context, true)
        enqueueMedia(context)
    }

    private fun enqueueReports(context: Context) {
        val request = OneTimeWorkRequestBuilder<OutboxSyncWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            UNIQUE_NAME,
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    internal fun enqueueMedia(context: Context) {
        val request = OneTimeWorkRequestBuilder<MediaSyncWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            MEDIA_WIFI,
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            request,
        )
    }
}

internal object MediaMeteredOptIn {
    private const val PREFS = "field_work"
    private const val KEY = "media_allow_metered"

    fun set(context: Context, allow: Boolean) {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY, allow)
            .apply()
    }

    fun get(context: Context): Boolean =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY, false)

    fun clear(context: Context) = set(context, false)
}
