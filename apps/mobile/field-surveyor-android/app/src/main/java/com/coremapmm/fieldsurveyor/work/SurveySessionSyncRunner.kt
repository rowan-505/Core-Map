package com.coremapmm.fieldsurveyor.work

import com.coremapmm.fieldsurveyor.auth.AuthException
import com.coremapmm.fieldsurveyor.data.LocalSurveySessionDao
import com.coremapmm.fieldsurveyor.data.LocalSurveySessionEntity
import com.coremapmm.fieldsurveyor.data.SurveySessionHttpResult

class SurveySessionSyncRunner(
    private val hasAuth: () -> Boolean,
    private val token: suspend () -> String,
    private val sessions: LocalSurveySessionDao,
    private val create: (String, LocalSurveySessionEntity) -> SurveySessionHttpResult,
    private val end: (String, LocalSurveySessionEntity) -> SurveySessionHttpResult,
    private val now: () -> Long = { System.currentTimeMillis() },
) {
    suspend fun syncOne(): OutboxRunResult {
        if (!hasAuth()) return OutboxRunResult.Idle
        val local = sessions.claimNext(now()) ?: return OutboxRunResult.Idle
        val accessToken = try { token() } catch (error: AuthException) {
            sessions.updateSync(local.clientSessionId, local.serverPublicId, LocalSurveySessionEntity.SYNC_RETRY, error.message, now())
            return if (error.statusCode == 401) OutboxRunResult.Idle else OutboxRunResult.RetryLater
        }
        val created = create(accessToken, local)
        if (created is SurveySessionHttpResult.Failure) return fail(local, created.result)
        val remote = (created as SurveySessionHttpResult.Success).session
        if (remote.clientSessionId != local.clientSessionId) {
            return fail(local, OutboxHttpResult.Permanent(409, "Session identity mismatch"))
        }
        if (local.status != LocalSurveySessionEntity.STATUS_ACTIVE) {
            val ended = end(accessToken, local)
            if (ended is SurveySessionHttpResult.Failure) {
                sessions.updateSync(local.clientSessionId, remote.publicId, LocalSurveySessionEntity.SYNC_RETRY, null, now())
                return fail(local.copy(serverPublicId = remote.publicId), ended.result)
            }
        }
        sessions.updateSync(local.clientSessionId, remote.publicId, LocalSurveySessionEntity.SYNC_SYNCED, null, now())
        return OutboxRunResult.Processed
    }

    private suspend fun fail(local: LocalSurveySessionEntity, result: OutboxHttpResult): OutboxRunResult {
        val state = if (result is OutboxHttpResult.Permanent) LocalSurveySessionEntity.SYNC_PERMANENT_ERROR else LocalSurveySessionEntity.SYNC_RETRY
        val message = when (result) {
            is OutboxHttpResult.Success -> null
            is OutboxHttpResult.Permanent -> result.message
            is OutboxHttpResult.Transient -> result.message
        }
        sessions.updateSync(local.clientSessionId, local.serverPublicId, state, message, now())
        return if (result is OutboxHttpResult.Transient) OutboxRunResult.RetryLater else OutboxRunResult.Processed
    }
}
