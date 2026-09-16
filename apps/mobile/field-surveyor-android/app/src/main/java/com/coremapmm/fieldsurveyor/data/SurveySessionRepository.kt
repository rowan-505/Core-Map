package com.coremapmm.fieldsurveyor.data

import com.coremapmm.fieldsurveyor.data.transport.RouteSelectionRow
import com.coremapmm.fieldsurveyor.survey.SurveySessionOps
import kotlinx.coroutines.flow.Flow
import java.util.UUID

class SurveySessionRepository(
    private val sessions: LocalSurveySessionDao,
    private val reports: LocalReportDao,
    private val media: LocalReportMediaDao,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    suspend fun start(
        selection: RouteSelectionRow,
        snapshotRevision: String,
        now: Long,
        totalStopCount: Int = 0,
    ): LocalSurveySessionEntity {
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
            trackingState = SurveySessionOps.TRACKING_ACTIVE,
            completionStatus = SurveySessionOps.COMPLETION_PARTIAL,
            lastActivityAtEpochMs = now,
            totalStopCount = totalStopCount,
            activeSegmentStartedAtEpochMs = now,
        ).also { sessions.insert(it) }
    }

    suspend fun active(): LocalSurveySessionEntity? = sessions.findActive()

    suspend fun complete(id: String, now: Long): Boolean {
        val row = sessions.findById(id) ?: return false
        val seconds = SurveySessionOps.accumulateSeconds(
            row.accumulatedActiveSeconds,
            row.activeSegmentStartedAtEpochMs,
            now,
        )
        return sessions.markEnded(id, LocalSurveySessionEntity.STATUS_COMPLETED, now, seconds) == 1
    }

    suspend fun abandon(id: String, now: Long): Boolean {
        val row = sessions.findById(id) ?: return false
        val seconds = SurveySessionOps.accumulateSeconds(
            row.accumulatedActiveSeconds,
            row.activeSegmentStartedAtEpochMs,
            now,
        )
        return sessions.markEnded(id, LocalSurveySessionEntity.STATUS_ABANDONED, now, seconds) == 1
    }

    suspend fun completeAndStartOpposite(
        activeId: String,
        selection: RouteSelectionRow,
        snapshotRevision: String,
        now: Long,
        totalStopCount: Int = 0,
    ): LocalSurveySessionEntity? {
        val active = sessions.findById(activeId) ?: return null
        val seconds = SurveySessionOps.accumulateSeconds(
            active.accumulatedActiveSeconds,
            active.activeSegmentStartedAtEpochMs,
            now,
        )
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
            trackingState = SurveySessionOps.TRACKING_ACTIVE,
            completionStatus = SurveySessionOps.COMPLETION_PARTIAL,
            lastActivityAtEpochMs = now,
            totalStopCount = totalStopCount,
            activeSegmentStartedAtEpochMs = now,
        )
        return sessions.completeActiveAndStart(activeId, next, now, seconds)
    }

    suspend fun finish(id: String, now: Long): LocalSurveySessionEntity? {
        val row = sessions.findById(id) ?: return null
        val result = SurveySessionOps.applyFinish(
            trackingState = row.trackingState,
            completionStatus = row.completionStatus,
            nowMs = now,
            accumulatedSeconds = row.accumulatedActiveSeconds,
            segmentStartedAtMs = row.activeSegmentStartedAtEpochMs,
        )
        if (!result.changed && !row.pendingFinishSync) return row
        val status = if (result.stopTracking || row.status == LocalSurveySessionEntity.STATUS_ACTIVE) {
            LocalSurveySessionEntity.STATUS_COMPLETED
        } else {
            row.status
        }
        val ended = if (result.stopTracking) now else row.endedAtEpochMs
        sessions.upsertOperational(
            id = id,
            trackingState = result.trackingState,
            completionStatus = result.completionStatus,
            accumulatedActiveSeconds = result.accumulatedActiveSeconds,
            finishedAtEpochMs = result.finishedAtEpochMs,
            reopenedAtEpochMs = row.reopenedAtEpochMs,
            lastActivityAtEpochMs = now,
            lastCheckedStopSequence = row.lastCheckedStopSequence,
            checkedStopCount = row.checkedStopCount,
            totalStopCount = row.totalStopCount,
            pendingSyncCount = row.pendingSyncCount,
            lastGpsAccuracyM = row.lastGpsAccuracyM,
            lastLat = row.lastLat,
            lastLng = row.lastLng,
            lastGpsAtEpochMs = row.lastGpsAtEpochMs,
            activeSegmentStartedAtEpochMs = null,
            lastHeartbeatAtEpochMs = row.lastHeartbeatAtEpochMs,
            pendingFinishSync = true,
            pendingReopenSync = false,
            status = status,
            endedAtEpochMs = ended,
            now = now,
        )
        return sessions.findById(id)
    }

    suspend fun reopen(id: String, now: Long): LocalSurveySessionEntity? {
        val row = sessions.findById(id) ?: return null
        val result = SurveySessionOps.applyReopen(row.completionStatus, now)
        if (!result.changed && !row.pendingReopenSync) return row
        sessions.upsertOperational(
            id = id,
            trackingState = result.trackingState,
            completionStatus = result.completionStatus,
            accumulatedActiveSeconds = row.accumulatedActiveSeconds,
            finishedAtEpochMs = row.finishedAtEpochMs,
            reopenedAtEpochMs = result.reopenedAtEpochMs,
            lastActivityAtEpochMs = now,
            lastCheckedStopSequence = row.lastCheckedStopSequence,
            checkedStopCount = row.checkedStopCount,
            totalStopCount = row.totalStopCount,
            pendingSyncCount = row.pendingSyncCount,
            lastGpsAccuracyM = row.lastGpsAccuracyM,
            lastLat = row.lastLat,
            lastLng = row.lastLng,
            lastGpsAtEpochMs = row.lastGpsAtEpochMs,
            activeSegmentStartedAtEpochMs = null,
            lastHeartbeatAtEpochMs = row.lastHeartbeatAtEpochMs,
            pendingFinishSync = false,
            pendingReopenSync = true,
            status = row.status,
            endedAtEpochMs = row.endedAtEpochMs,
            now = now,
        )
        return sessions.findById(id)
    }

    suspend fun saveOperational(row: LocalSurveySessionEntity) {
        sessions.upsertOperational(
            id = row.clientSessionId,
            trackingState = row.trackingState,
            completionStatus = row.completionStatus,
            accumulatedActiveSeconds = row.accumulatedActiveSeconds,
            finishedAtEpochMs = row.finishedAtEpochMs,
            reopenedAtEpochMs = row.reopenedAtEpochMs,
            lastActivityAtEpochMs = row.lastActivityAtEpochMs,
            lastCheckedStopSequence = row.lastCheckedStopSequence,
            checkedStopCount = row.checkedStopCount,
            totalStopCount = row.totalStopCount,
            pendingSyncCount = row.pendingSyncCount,
            lastGpsAccuracyM = row.lastGpsAccuracyM,
            lastLat = row.lastLat,
            lastLng = row.lastLng,
            lastGpsAtEpochMs = row.lastGpsAtEpochMs,
            activeSegmentStartedAtEpochMs = row.activeSegmentStartedAtEpochMs,
            lastHeartbeatAtEpochMs = row.lastHeartbeatAtEpochMs,
            pendingFinishSync = row.pendingFinishSync,
            pendingReopenSync = row.pendingReopenSync,
            status = row.status,
            endedAtEpochMs = row.endedAtEpochMs,
            now = row.updatedAtEpochMs,
        )
    }

    fun history(): Flow<List<SurveyHistoryRow>> = sessions.observeHistory()
    fun historyPage(limit: Int): Flow<List<SurveyHistoryRow>> = sessions.observeHistoryPage(limit.coerceIn(1, 500))
    fun historyRow(id: String): Flow<SurveyHistoryRow?> = sessions.observeHistoryRow(id)
    suspend fun session(id: String) = sessions.findById(id)
    suspend fun latestForVariant(variantPublicId: String) = sessions.latestForVariant(variantPublicId)
    suspend fun finishedVariants() = sessions.finishedVariants()
    suspend fun reports(id: String) = reports.listForSession(id)
    suspend fun media(reportId: String) = media.listForReport(reportId)
}
