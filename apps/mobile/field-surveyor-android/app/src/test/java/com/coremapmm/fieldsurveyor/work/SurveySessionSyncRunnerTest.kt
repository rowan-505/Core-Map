package com.coremapmm.fieldsurveyor.work

import com.coremapmm.fieldsurveyor.data.LocalSurveySessionDao
import com.coremapmm.fieldsurveyor.data.LocalSurveySessionEntity
import com.coremapmm.fieldsurveyor.data.RemoteSurveySession
import com.coremapmm.fieldsurveyor.data.SurveyHistoryRow
import com.coremapmm.fieldsurveyor.data.SurveySessionHttpResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SurveySessionSyncRunnerTest {
    @Test
    fun offlineCompletionCreatesSessionBeforeCompletingIt() = runBlocking {
        val dao = MemorySessions(session(status = LocalSurveySessionEntity.STATUS_COMPLETED, ended = 2_000L))
        val calls = mutableListOf<String>()
        val runner = runner(
            dao,
            create = { _, row -> calls += "create:${row.clientSessionId}"; success("active") },
            end = { _, _ -> calls += "complete"; success("completed") },
        )
        assertEquals(OutboxRunResult.Processed, runner.syncOne())
        assertEquals(listOf("create:session-1", "complete"), calls)
        assertEquals(LocalSurveySessionEntity.SYNC_SYNCED, dao.row!!.syncState)
    }

    @Test
    fun duplicateSyncUsesStableClientIdentityAndMergesServerPublicId() = runBlocking {
        val dao = MemorySessions(session(sync = LocalSurveySessionEntity.SYNC_SYNCING))
        var creates = 0
        val runner = runner(dao, create = { _, row ->
            creates += 1
            assertEquals("session-1", row.clientSessionId)
            SurveySessionHttpResult.Success(RemoteSurveySession("server-1", row.clientSessionId, "active"))
        })
        assertEquals(OutboxRunResult.Processed, runner.syncOne())
        dao.row = dao.row!!.copy(syncState = LocalSurveySessionEntity.SYNC_SYNCING)
        assertEquals(OutboxRunResult.Processed, runner.syncOne())
        assertEquals(2, creates)
        assertEquals("server-1", dao.row!!.serverPublicId)
        assertEquals(LocalSurveySessionEntity.SYNC_SYNCED, dao.row!!.syncState)
    }

    @Test
    fun localTerminalStateWinsWhenServerCreateReturnsActive() = runBlocking {
        val dao = MemorySessions(session(status = LocalSurveySessionEntity.STATUS_ABANDONED, ended = 4_000L))
        var endCalls = 0
        val runner = runner(
            dao,
            create = { _, _ -> success("active") },
            end = { _, local ->
                endCalls += 1
                assertEquals(LocalSurveySessionEntity.STATUS_ABANDONED, local.status)
                success("abandoned")
            },
        )
        runner.syncOne()
        assertEquals(1, endCalls)
        assertEquals(LocalSurveySessionEntity.STATUS_ABANDONED, dao.row!!.status)
        assertEquals(4_000L, dao.row!!.endedAtEpochMs)
    }

    @Test
    fun transientFailureRetainsUnsyncedSession() = runBlocking {
        val dao = MemorySessions(session())
        val result = runner(dao, create = { _, _ ->
            SurveySessionHttpResult.Failure(OutboxHttpResult.Transient(null, "offline"))
        }).syncOne()
        assertEquals(OutboxRunResult.RetryLater, result)
        assertEquals(LocalSurveySessionEntity.SYNC_RETRY, dao.row!!.syncState)
        assertNull(dao.row!!.serverPublicId)
    }

    private fun runner(
        dao: MemorySessions,
        create: (String, LocalSurveySessionEntity) -> SurveySessionHttpResult = { _, _ -> success("active") },
        end: (String, LocalSurveySessionEntity) -> SurveySessionHttpResult = { _, _ -> success("completed") },
    ) = SurveySessionSyncRunner({ true }, { "token" }, dao, create, end, now = { 5_000L })

    private fun success(status: String) = SurveySessionHttpResult.Success(
        RemoteSurveySession("server-1", "session-1", status),
    )

    private fun session(
        status: String = LocalSurveySessionEntity.STATUS_ACTIVE,
        sync: String = LocalSurveySessionEntity.SYNC_LOCAL,
        ended: Long? = null,
    ) = LocalSurveySessionEntity(
        "session-1", null, "route", "YBS-13", "variant", "D0", "Sule", "Hledan",
        "rev", 1_000L, ended, status, sync, 1_000L,
    )
}

private class MemorySessions(var row: LocalSurveySessionEntity?) : LocalSurveySessionDao {
    override suspend fun insert(row: LocalSurveySessionEntity) { this.row = row }
    override suspend fun findById(id: String) = row?.takeIf { it.clientSessionId == id }
    override suspend fun lastSurveyByVariant() = listOfNotNull(
        row?.let { com.coremapmm.fieldsurveyor.data.VariantLastSurveyRow(it.variantPublicId, it.startedAtEpochMs) },
    )
    override suspend fun findActive() = row?.takeIf { it.status == LocalSurveySessionEntity.STATUS_ACTIVE }
    override fun observeHistory(): Flow<List<SurveyHistoryRow>> = flowOf(emptyList())
    override fun observeHistoryPage(limit: Int): Flow<List<SurveyHistoryRow>> = flowOf(emptyList())
    override fun observeHistoryRow(id: String): Flow<SurveyHistoryRow?> = flowOf(null)
    override suspend fun nextEligible() = row?.takeIf { it.syncState != LocalSurveySessionEntity.SYNC_SYNCED }
    override suspend fun markSyncing(id: String, now: Long): Int {
        val value = row?.takeIf { it.clientSessionId == id } ?: return 0
        row = value.copy(syncState = LocalSurveySessionEntity.SYNC_SYNCING, updatedAtEpochMs = now)
        return 1
    }
    override suspend fun markEnded(id: String, status: String, endedAt: Long): Int {
        val value = row?.takeIf { it.clientSessionId == id && it.status == LocalSurveySessionEntity.STATUS_ACTIVE } ?: return 0
        row = value.copy(status = status, endedAtEpochMs = endedAt, syncState = LocalSurveySessionEntity.SYNC_LOCAL)
        return 1
    }
    override suspend fun updateSync(id: String, serverPublicId: String?, syncState: String, lastError: String?, now: Long) {
        row = row?.copy(serverPublicId = row?.serverPublicId ?: serverPublicId, syncState = syncState, lastError = lastError, updatedAtEpochMs = now)
    }
}
