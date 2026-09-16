package com.coremapmm.fieldsurveyor.work

import com.coremapmm.fieldsurveyor.auth.AuthException
import com.coremapmm.fieldsurveyor.data.LocalSurveyVariantCompletionDao
import com.coremapmm.fieldsurveyor.data.LocalSurveyVariantCompletionEntity
import com.coremapmm.fieldsurveyor.data.RemoteSurveyCompletion
import com.coremapmm.fieldsurveyor.data.SurveyCompletionHttpResult
import com.coremapmm.fieldsurveyor.survey.SurveyVariantCompletionMapping
import java.time.Instant

/** Pull personal completion marks from GET /field/survey-completions. */
class SurveyCompletionPullRunner(
    private val hasAuth: () -> Boolean,
    private val token: suspend () -> String,
    private val completions: LocalSurveyVariantCompletionDao,
    private val list: (String) -> SurveyCompletionHttpResult,
    private val now: () -> Long = { System.currentTimeMillis() },
) {
    suspend fun pull(): OutboxRunResult {
        if (!hasAuth()) return OutboxRunResult.Idle
        val accessToken = try {
            token()
        } catch (error: AuthException) {
            return if (error.statusCode == 401) OutboxRunResult.Idle else OutboxRunResult.RetryLater
        }
        return when (val result = list(accessToken)) {
            is SurveyCompletionHttpResult.ListSuccess -> {
                merge(result.items)
                OutboxRunResult.Processed
            }
            is SurveyCompletionHttpResult.Success -> OutboxRunResult.Processed
            is SurveyCompletionHttpResult.Failure -> {
                if (result.result is OutboxHttpResult.Transient) {
                    OutboxRunResult.RetryLater
                } else {
                    OutboxRunResult.Idle
                }
            }
        }
    }

    private suspend fun merge(items: List<RemoteSurveyCompletion>) {
        val nowMs = now()
        for (item in items) {
            val local = completions.findByVariant(item.routeVariantPublicId)
            if (!SurveyVariantCompletionMapping.canApplyRemote(local?.syncState)) continue
            val finishedAt = item.finishedAt?.let {
                runCatching { Instant.parse(it).toEpochMilli() }.getOrNull()
            }
            completions.upsert(
                LocalSurveyVariantCompletionEntity(
                    variantPublicId = item.routeVariantPublicId,
                    routePublicId = item.routePublicId ?: local?.routePublicId,
                    routeCode = item.routeCode ?: local?.routeCode,
                    variantCode = item.variantCode ?: local?.variantCode,
                    isFinished = item.finished,
                    finishedAtEpochMs = if (item.finished) finishedAt ?: local?.finishedAtEpochMs ?: nowMs else null,
                    updatedAtEpochMs = nowMs,
                    syncState = LocalSurveyVariantCompletionEntity.SYNC_SYNCED,
                    lastError = null,
                ),
            )
        }
    }
}
