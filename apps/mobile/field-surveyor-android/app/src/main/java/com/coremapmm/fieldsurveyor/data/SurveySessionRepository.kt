package com.coremapmm.fieldsurveyor.data

import com.coremapmm.fieldsurveyor.data.transport.RouteSelectionRow
import kotlinx.coroutines.flow.Flow
import java.util.UUID

class SurveySessionRepository(
    private val sessions: LocalSurveySessionDao,
    private val reports: LocalReportDao,
    private val media: LocalReportMediaDao,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    suspend fun start(selection: RouteSelectionRow, snapshotRevision: String, now: Long): LocalSurveySessionEntity {
        sessions.findActive()?.let { return it }
        return LocalSurveySessionEntity(
            clientSessionId = newId(),
            serverPublicId = null,
            routePublicId = selection.routePublicId,
            routeCode = selection.routeCode,
            variantPublicId = selection.variantPublicId,
            variantCode = selection.variantCode,
            originName = selection.originName,
            destinationName = selection.destinationName,
            snapshotRevision = snapshotRevision,
            startedAtEpochMs = now,
            endedAtEpochMs = null,
            status = LocalSurveySessionEntity.STATUS_ACTIVE,
            syncState = LocalSurveySessionEntity.SYNC_LOCAL,
            updatedAtEpochMs = now,
        ).also { sessions.insert(it) }
    }

    suspend fun active(): LocalSurveySessionEntity? = sessions.findActive()

    suspend fun complete(id: String, now: Long): Boolean =
        sessions.markEnded(id, LocalSurveySessionEntity.STATUS_COMPLETED, now) == 1

    suspend fun abandon(id: String, now: Long): Boolean =
        sessions.markEnded(id, LocalSurveySessionEntity.STATUS_ABANDONED, now) == 1

    suspend fun completeAndStartOpposite(
        activeId: String,
        selection: RouteSelectionRow,
        snapshotRevision: String,
        now: Long,
    ): LocalSurveySessionEntity? {
        val next = LocalSurveySessionEntity(
            clientSessionId = newId(),
            serverPublicId = null,
            routePublicId = selection.routePublicId,
            routeCode = selection.routeCode,
            variantPublicId = selection.variantPublicId,
            variantCode = selection.variantCode,
            originName = selection.originName,
            destinationName = selection.destinationName,
            snapshotRevision = snapshotRevision,
            startedAtEpochMs = now,
            endedAtEpochMs = null,
            status = LocalSurveySessionEntity.STATUS_ACTIVE,
            syncState = LocalSurveySessionEntity.SYNC_LOCAL,
            updatedAtEpochMs = now,
        )
        return sessions.completeActiveAndStart(activeId, next, now)
    }

    fun history(): Flow<List<SurveyHistoryRow>> = sessions.observeHistory()
    fun historyPage(limit: Int): Flow<List<SurveyHistoryRow>> = sessions.observeHistoryPage(limit.coerceIn(1, 500))
    fun historyRow(id: String): Flow<SurveyHistoryRow?> = sessions.observeHistoryRow(id)
    suspend fun session(id: String) = sessions.findById(id)
    suspend fun reports(id: String) = reports.listForSession(id)
    suspend fun media(reportId: String) = media.listForReport(reportId)
}
