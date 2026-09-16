package com.coremapmm.fieldsurveyor.work

import com.coremapmm.fieldsurveyor.auth.AuthException
import com.coremapmm.fieldsurveyor.data.LocalSurveyVariantAssignmentDao
import com.coremapmm.fieldsurveyor.data.LocalSurveyVariantAssignmentEntity
import com.coremapmm.fieldsurveyor.data.RemoteSurveyAssignment
import com.coremapmm.fieldsurveyor.data.SurveyAssignmentHttpResult
import java.time.Instant

/** Pull active assignments only — no cancelled history. */
class SurveyAssignmentPullRunner(
    private val hasAuth: () -> Boolean,
    private val token: suspend () -> String,
    private val assignments: LocalSurveyVariantAssignmentDao,
    private val listActive: (String) -> SurveyAssignmentHttpResult,
    private val now: () -> Long = { System.currentTimeMillis() },
) {
    suspend fun pull(): OutboxRunResult {
        if (!hasAuth()) return OutboxRunResult.Idle
        val accessToken = try {
            token()
        } catch (error: AuthException) {
            return if (error.statusCode == 401) OutboxRunResult.Idle else OutboxRunResult.RetryLater
        }
        return when (val result = listActive(accessToken)) {
            is SurveyAssignmentHttpResult.ListSuccess -> {
                assignments.replaceActive(result.items.map { toEntity(it, now()) })
                OutboxRunResult.Processed
            }
            is SurveyAssignmentHttpResult.Failure -> {
                if (result.result is OutboxHttpResult.Transient) {
                    OutboxRunResult.RetryLater
                } else {
                    OutboxRunResult.Idle
                }
            }
        }
    }

    private fun toEntity(item: RemoteSurveyAssignment, nowMs: Long): LocalSurveyVariantAssignmentEntity {
        val updatedAt = item.updatedAt?.let {
            runCatching { Instant.parse(it).toEpochMilli() }.getOrNull()
        } ?: nowMs
        return LocalSurveyVariantAssignmentEntity(
            publicId = item.publicId,
            variantPublicId = item.routeVariantPublicId,
            routePublicId = item.routePublicId,
            routeCode = item.routeCode,
            variantCode = item.variantCode,
            assignedDate = item.assignedDate,
            dueDate = item.dueDate,
            status = item.status,
            workStatus = item.workStatus,
            remaining = item.remaining,
            updatedAtEpochMs = updatedAt,
        )
    }
}
