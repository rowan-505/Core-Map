package com.coremapmm.fieldsurveyor.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SurveySessionDaoTest {
    private lateinit var db: FieldDatabase

    @Before fun createDb() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext<Context>(),
            FieldDatabase::class.java,
        ).build()
    }

    @After fun closeDb() = db.close()

    @Test fun zeroReportHistoryAndActiveRecovery() = runBlocking {
        db.localSurveySessionDao().insert(session())
        val history = db.localSurveySessionDao().observeHistory().first().single()
        assertEquals(0, history.reportCount)
        assertNotNull(db.localSurveySessionDao().findActive())
    }

    @Test fun offlineCompletionIsRetainedForLaterSync() = runBlocking {
        val dao = db.localSurveySessionDao()
        dao.insert(session())
        assertEquals(1, dao.markEnded("session-1", LocalSurveySessionEntity.STATUS_COMPLETED, 2_000L))
        assertNull(dao.findActive())
        val ended = dao.findById("session-1")!!
        assertEquals(LocalSurveySessionEntity.STATUS_COMPLETED, ended.status)
        assertEquals(LocalSurveySessionEntity.SYNC_LOCAL, ended.syncState)
        assertEquals(ended, dao.nextEligible())
    }

    @Test fun historyReportCountUsesOnlyLinkedReports() = runBlocking {
        db.localSurveySessionDao().insert(session())
        db.localReportDao().upsert(report("linked", "session-1"))
        db.localReportDao().upsert(report("unlinked", null))
        assertEquals(1, db.localSurveySessionDao().observeHistory().first().single().reportCount)
    }

    @Test fun linkedReportWaitsUntilItsSessionIsSynced() = runBlocking {
        val sessions = db.localSurveySessionDao()
        sessions.insert(session())
        db.localReportDao().upsert(report("linked", "session-1"))
        assertNull(db.localReportDao().nextEligible())
        sessions.updateSync("session-1", "server-1", LocalSurveySessionEntity.SYNC_SYNCED, null, 2_000L)
        assertEquals("linked", db.localReportDao().nextEligible()?.clientPublicId)
    }

    @Test fun completeAndStartOppositeKeepsReportsOnOriginalSession() = runBlocking {
        val sessions = db.localSurveySessionDao()
        sessions.insert(session())
        db.localReportDao().upsert(report("r1", "session-1"))
        val next = session().copy(
            clientSessionId = "session-2",
            variantPublicId = "variant-d1",
            variantCode = "D1",
            originName = "Hledan",
            destinationName = "Sule",
            startedAtEpochMs = 2_000L,
            updatedAtEpochMs = 2_000L,
        )
        assertNotNull(sessions.completeActiveAndStart("session-1", next, 2_000L))
        assertEquals("session-2", sessions.findActive()?.clientSessionId)
        assertEquals(LocalSurveySessionEntity.STATUS_COMPLETED, sessions.findById("session-1")?.status)
        assertEquals(LocalSurveySessionEntity.SYNC_LOCAL, sessions.findById("session-1")?.syncState)
        assertEquals(LocalSurveySessionEntity.SYNC_LOCAL, sessions.findById("session-2")?.syncState)
        assertEquals(listOf("r1"), db.localReportDao().listForSession("session-1").map { it.clientPublicId })
        assertTrue(db.localReportDao().listForSession("session-2").isEmpty())
        assertEquals(1, sessions.observeHistory().first().first { it.clientSessionId == "session-1" }.reportCount)
        assertEquals(0, sessions.observeHistory().first().first { it.clientSessionId == "session-2" }.reportCount)
    }

    @Test fun completeAndStartOppositeWorksWithZeroReports() = runBlocking {
        val sessions = db.localSurveySessionDao()
        sessions.insert(session())
        val next = session().copy(clientSessionId = "session-2", variantCode = "D1", startedAtEpochMs = 2_000L)
        assertNotNull(sessions.completeActiveAndStart("session-1", next, 2_000L))
        assertEquals(0, sessions.observeHistory().first().sumOf { it.reportCount })
        assertEquals("session-2", sessions.findActive()?.clientSessionId)
    }

    @Test fun d0AndD1ReportsRemainOnSeparateSessions() = runBlocking {
        val sessions = db.localSurveySessionDao()
        sessions.insert(session().copy(status = LocalSurveySessionEntity.STATUS_COMPLETED, endedAtEpochMs = 1_500L))
        sessions.insert(
            session().copy(
                clientSessionId = "session-2",
                variantPublicId = "variant-d1",
                variantCode = "D1",
                status = LocalSurveySessionEntity.STATUS_COMPLETED,
                startedAtEpochMs = 2_000L,
                endedAtEpochMs = 3_000L,
                updatedAtEpochMs = 3_000L,
            ),
        )
        db.localReportDao().upsert(report("d0-report", "session-1"))
        db.localReportDao().upsert(report("d1-report", "session-2"))

        assertEquals(listOf("d0-report"), db.localReportDao().listForSession("session-1").map { it.clientPublicId })
        assertEquals(listOf("d1-report"), db.localReportDao().listForSession("session-2").map { it.clientPublicId })
        val history = sessions.observeHistory().first()
        assertEquals(1, history.single { it.variantCode == "D0" }.reportCount)
        assertEquals(1, history.single { it.variantCode == "D1" }.reportCount)
    }

    @Test fun mediaClaimIsExclusiveUntilItsLeaseExpires() = runBlocking {
        db.localReportDao().upsert(
            report("synced-parent", null).copy(status = LocalReportEntity.STATUS_SYNCED),
        )
        db.localReportMediaDao().insert(
            LocalReportMediaEntity(
                mediaPublicId = "media-lease",
                reportClientPublicId = "synced-parent",
                localPath = "/not-read-by-dao-test.jpg",
                mimeType = LocalReportMediaEntity.MIME_JPEG,
                byteSize = 1L,
                syncState = LocalReportMediaEntity.STATE_LOCAL,
                remoteAssetPublicId = null,
                createdAtEpochMs = 1L,
                updatedAtEpochMs = 1L,
            ),
        )
        val now = 1_000_000L
        assertNotNull(db.localReportMediaDao().claimNext(now))
        assertNull(db.localReportMediaDao().claimNext(now + 1L))
        assertNotNull(db.localReportMediaDao().claimNext(now + SyncClaimPolicy.LEASE_MS + 1L))
    }

    @Test fun interruptedNonTransactionalEndLeavesNoActiveSession() = runBlocking {
        val sessions = db.localSurveySessionDao()
        sessions.insert(session())
        db.localReportDao().upsert(report("r1", "session-1"))
        assertEquals(1, sessions.markEnded("session-1", LocalSurveySessionEntity.STATUS_COMPLETED, 2_000L))
        assertNull(sessions.findActive())
        assertEquals("r1", db.localReportDao().listForSession("session-1").single().clientPublicId)
    }

    @Test fun offlineReportPayloadPersistsWithoutCanonicalWrite() = runBlocking {
        db.localSurveySessionDao().insert(session())
        val payload = """{"reportTypeCode":"transport_issue","observedAt":"2026-09-04T12:00:00Z","location":{"lat":16.8,"lng":96.15,"accuracyM":5},"target":{"entityType":"route","publicId":"route"},"context":{"snapshotRevision":"rev","variantCode":"D0"}}"""
        db.localReportDao().upsert(report("offline-1", "session-1").copy(payloadJson = payload))
        val stored = db.localReportDao().findById("offline-1")!!
        assertEquals(payload, stored.payloadJson)
        assertEquals(LocalReportEntity.STATUS_LOCAL, stored.status)
        assertEquals(1, db.localReportDao().countForSession("session-1"))
        assertEquals(1, db.localReportDao().countPendingSync())
        assertEquals(1, db.localSurveySessionDao().observeHistory().first().single().reportCount)
    }

    @Test fun newStopOutboxUpsertIsIdempotentAndDoesNotTouchCanonicalData() = runBlocking {
        db.localSurveySessionDao().insert(session())
        val payload = """{"clientPublicId":"new-stop-1","reportTypeCode":"new_stop","anomalyKind":"NEW_STOP","observedAt":"2026-09-08T00:00:00Z","location":{"lat":16.91,"lng":96.21},"target":{"entityType":"variant","publicId":"variant"},"context":{"snapshotRevision":"rev","previousStopPublicId":"stop-1","previousStopSequence":4,"proposedStopName":"Corner stall","locationSource":"GPS"}}"""
        val first = report("new-stop-1", "session-1").copy(payloadJson = payload)
        db.localReportDao().upsert(first)
        db.localReportDao().upsert(first.copy(updatedAtEpochMs = 2_000L, payloadJson = payload))
        val stored = db.localReportDao().findById("new-stop-1")!!
        assertEquals(payload, stored.payloadJson)
        assertEquals(1, db.localReportDao().countForSession("session-1"))
        assertEquals("new_stop", org.json.JSONObject(stored.payloadJson).getString("reportTypeCode"))
        assertEquals("variant", org.json.JSONObject(stored.payloadJson).getJSONObject("target").getString("entityType"))
        assertEquals(4, org.json.JSONObject(stored.payloadJson).getJSONObject("context").getInt("previousStopSequence"))
        assertEquals("stop-1", org.json.JSONObject(stored.payloadJson).getJSONObject("context").getString("previousStopPublicId"))
    }

    @Test fun newStopPayloadRoundTripKeepsNextStopAndDoesNotCreateCanonicalStop() = runBlocking {
        db.localSurveySessionDao().insert(session())
        val payload = """{"clientPublicId":"new-stop-2","reportTypeCode":"new_stop","anomalyKind":"NEW_STOP","observedAt":"2026-09-08T00:00:00Z","location":{"lat":16.91,"lng":96.21},"target":{"entityType":"variant","publicId":"variant"},"context":{"snapshotRevision":"rev","previousStopPublicId":"stop-1","previousStopSequence":4,"nextStopPublicId":"stop-2","proposedStopName":"Corner stall","locationSource":"MAP_PICK"}}"""
        db.localReportDao().upsert(report("new-stop-2", "session-1").copy(payloadJson = payload))
        val stored = org.json.JSONObject(db.localReportDao().findById("new-stop-2")!!.payloadJson)
        assertEquals("stop-2", stored.getJSONObject("context").getString("nextStopPublicId"))
        assertEquals("MAP_PICK", stored.getJSONObject("context").getString("locationSource"))
        assertEquals("new_stop", stored.getString("reportTypeCode"))
        assertEquals(LocalReportEntity.STATUS_LOCAL, db.localReportDao().findById("new-stop-2")!!.status)
    }

    @Test fun historyPageIsBoundedAndNewestFirst() = runBlocking {
        val sessions = db.localSurveySessionDao()
        repeat(75) { index ->
            sessions.insert(
                session().copy(
                    clientSessionId = "session-$index",
                    startedAtEpochMs = index.toLong(),
                    updatedAtEpochMs = index.toLong(),
                    status = LocalSurveySessionEntity.STATUS_COMPLETED,
                    endedAtEpochMs = index.toLong(),
                ),
            )
        }
        val firstPage = sessions.observeHistoryPage(50).first()
        assertEquals(50, firstPage.size)
        assertEquals("session-74", firstPage.first().clientSessionId)
        assertEquals("session-25", firstPage.last().clientSessionId)
    }

    private fun session() = LocalSurveySessionEntity(
        "session-1", null, "route", "YBS-13", "variant", "D0", "Sule", "Hledan",
        "rev", 1_000L, null, LocalSurveySessionEntity.STATUS_ACTIVE,
        LocalSurveySessionEntity.SYNC_LOCAL, 1_000L,
    )

    private fun report(id: String, sessionId: String?) = LocalReportEntity(
        id, LocalReportEntity.STATUS_LOCAL, "{}", 1_000L, 1_000L,
        sessionClientSessionId = sessionId,
    )
}
