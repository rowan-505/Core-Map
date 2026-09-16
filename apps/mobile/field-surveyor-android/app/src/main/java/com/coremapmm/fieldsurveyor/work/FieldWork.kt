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
import com.coremapmm.fieldsurveyor.log.FieldLog
import com.coremapmm.fieldsurveyor.media.MediaRetentionCleanup
import com.coremapmm.fieldsurveyor.media.ReportPhotoStore
import java.util.concurrent.TimeUnit

internal enum class SyncStage { REPORTS, MEDIA }

internal object FieldWorkPolicy {
    fun defaultStages() = listOf(SyncStage.REPORTS, SyncStage.MEDIA)
    fun meteredOverrideStages() = listOf(SyncStage.MEDIA)

    fun uniqueMediaWorkPolicy(@Suppress("UNUSED_PARAMETER") allowMetered: Boolean): String = "REPLACE"

    fun mediaShouldRetry(retryLater: Boolean, hasEligible: Boolean, hasFreshSyncing: Boolean): Boolean =
        retryLater || hasEligible || hasFreshSyncing

    /** Session/completion retry must not skip later report sync in the same worker pass. */
    fun shouldContinueAfterUpstreamRetry(upstreamRetryLater: Boolean): Boolean = true

    fun shouldRetryWorker(
        retryLater: Boolean,
        moreSessions: Boolean,
        moreCompletions: Boolean,
        moreReports: Boolean,
    ): Boolean = retryLater || moreSessions || moreCompletions || moreReports
}

/** Report JSON + media + maps: any connected network (Wi-Fi or cellular). */
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
            summary = graph.fieldSurveySessionsApi::summary,
            finish = graph.fieldSurveySessionsApi::finish,
            reopen = graph.fieldSurveySessionsApi::reopen,
        )
        val completionsRunner = SurveyCompletionSyncRunner(
            hasAuth = { graph.auth.currentSession() != null },
            token = { graph.auth.validAccessToken() },
            completions = graph.completionDao,
            put = graph.fieldSurveyCompletionsApi::put,
        )
        val completionsPull = SurveyCompletionPullRunner(
            hasAuth = { graph.auth.currentSession() != null },
            token = { graph.auth.validAccessToken() },
            completions = graph.completionDao,
            list = graph.fieldSurveyCompletionsApi::list,
        )
        val assignmentsPull = SurveyAssignmentPullRunner(
            hasAuth = { graph.auth.currentSession() != null },
            token = { graph.auth.validAccessToken() },
            assignments = graph.assignmentDao,
            listActive = graph.fieldSurveyAssignmentsApi::listActive,
        )
        // Do not abort the whole worker on session/completion RetryLater.
        // A stuck session (offline API, stale active row) used to block report POST forever,
        // which left Outbox items on "Waiting".
        var retryLater = false
        var sessionProcessed = 0
        while (sessionProcessed < 20) {
            when (sessionsRunner.syncOne()) {
                OutboxRunResult.Idle -> break
                OutboxRunResult.Processed -> sessionProcessed += 1
                OutboxRunResult.RetryLater -> {
                    retryLater = true
                    break
                }
            }
        }
        var completionProcessed = 0
        while (completionProcessed < 20) {
            when (completionsRunner.syncOne()) {
                OutboxRunResult.Idle -> break
                OutboxRunResult.Processed -> completionProcessed += 1
                OutboxRunResult.RetryLater -> {
                    retryLater = true
                    break
                }
            }
        }
        when (completionsPull.pull()) {
            OutboxRunResult.RetryLater -> retryLater = true
            OutboxRunResult.Idle, OutboxRunResult.Processed -> Unit
        }
        when (assignmentsPull.pull()) {
            OutboxRunResult.RetryLater -> retryLater = true
            OutboxRunResult.Idle, OutboxRunResult.Processed -> Unit
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
        val moreSessions = graph.sessionDao.nextEligible() != null
        val moreCompletions = graph.completionDao.nextEligible() != null
        val moreReports = graph.reports.nextEligible() != null
        return if (
            FieldWorkPolicy.shouldRetryWorker(
                retryLater = retryLater,
                moreSessions = moreSessions,
                moreCompletions = moreCompletions,
                moreReports = moreReports,
            )
        ) {
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

    /** @deprecated Media uploads use any network; kept as alias for enqueueMedia. */
    fun enqueueMediaOverCellular(context: Context) {
        enqueueMedia(context)
    }

    private fun enqueueReports(context: Context) {
        val request = OneTimeWorkRequestBuilder<OutboxSyncWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .setExpedited(androidx.work.OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .build()
        // REPLACE so a new capture restarts sync immediately instead of waiting on KEEP/backoff.
        WorkManager.getInstance(context).enqueueUniqueWork(
            UNIQUE_NAME,
            ExistingWorkPolicy.REPLACE,
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
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            MEDIA_WIFI,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }
}
