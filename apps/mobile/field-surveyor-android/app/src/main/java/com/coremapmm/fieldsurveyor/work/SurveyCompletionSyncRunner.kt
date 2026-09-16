package com.coremapmm.fieldsurveyor.work

import com.coremapmm.fieldsurveyor.auth.AuthException
import com.coremapmm.fieldsurveyor.data.LocalSurveyVariantCompletionDao
import com.coremapmm.fieldsurveyor.data.LocalSurveyVariantCompletionEntity
import com.coremapmm.fieldsurveyor.data.SurveyCompletionHttpResult

class SurveyCompletionSyncRunner(
    private val hasAuth: () -> Boolean,
    private val token: suspend () -> String,
    private val completions: LocalSurveyVariantCompletionDao,
    private val put: (String, LocalSurveyVariantCompletionEntity) -> SurveyCompletionHttpResult,
    private val now: () -> Long = { System.currentTimeMillis() },
) {
    suspend fun syncOne(): OutboxRunResult {
        if (!hasAuth()) return OutboxRunResult.Idle
        val local = completions.claimNext(now()) ?: return OutboxRunResult.Idle
        val accessToken = try {
            token()
        } catch (error: AuthException) {
            completions.updateSync(
                local.variantPublicId,
                LocalSurveyVariantCompletionEntity.SYNC_RETRY,
                error.message,
                now(),
            )
            return if (error.statusCode == 401) OutboxRunResult.Idle else OutboxRunResult.RetryLater
        }
        return when (val result = put(accessToken, local)) {
            is SurveyCompletionHttpResult.Success -> {
                completions.updateSync(
                    local.variantPublicId,
                    LocalSurveyVariantCompletionEntity.SYNC_SYNCED,
                    null,
                    now(),
                )
                OutboxRunResult.Processed
            }
            is SurveyCompletionHttpResult.ListSuccess -> {
                completions.updateSync(
                    local.variantPublicId,
                    LocalSurveyVariantCompletionEntity.SYNC_SYNCED,
                    null,
                    now(),
                )
                OutboxRunResult.Processed
            }
            is SurveyCompletionHttpResult.Failure -> {
                val state = if (result.result is OutboxHttpResult.Permanent) {
                    LocalSurveyVariantCompletionEntity.SYNC_PERMANENT_ERROR
                } else {
                    LocalSurveyVariantCompletionEntity.SYNC_RETRY
                }
                val message = when (val http = result.result) {
                    is OutboxHttpResult.Success -> null
                    is OutboxHttpResult.Permanent -> http.message
                    is OutboxHttpResult.Transient -> http.message
                }
                completions.updateSync(local.variantPublicId, state, message, now())
                if (result.result is OutboxHttpResult.Transient) {
                    OutboxRunResult.RetryLater
                } else {
                    OutboxRunResult.Processed
                }
            }
        }
    }
}
