package com.coremapmm.fieldsurveyor.e2e

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.coremapmm.fieldsurveyor.FieldApp
import com.coremapmm.fieldsurveyor.data.LocalReportEntity
import com.coremapmm.fieldsurveyor.data.LocalSurveySessionEntity
import com.coremapmm.fieldsurveyor.survey.AnomalyKind
import com.coremapmm.fieldsurveyor.survey.GpsFix
import com.coremapmm.fieldsurveyor.ui.settings.FieldPreferences
import com.coremapmm.fieldsurveyor.work.FieldWork
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Opt-in smoke: login → start survey → one stop report → WorkManager sync → SYNCED.
 *
 * adb args: -e fieldDashboardSmoke true -e fieldE2EPassword '...'
 */
@RunWith(AndroidJUnit4::class)
class DashboardReportSyncSmokeTest {
    private val app = ApplicationProvider.getApplicationContext<FieldApp>()
    private val graph get() = app.graph

    @Before
    fun requireOptIn() {
        assumeTrue(
            "set fieldDashboardSmoke=true to run",
            InstrumentationRegistry.getArguments().getString("fieldDashboardSmoke") == "true",
        )
    }

    @Test
    fun syncOneWrongLocationReportToApi() = runBlocking {
        val password = requireNotNull(
            InstrumentationRegistry.getArguments().getString("fieldE2EPassword"),
        ) { "fieldE2EPassword is required" }

        // Emulator default is already 10.0.2.2:3001; keep explicit for clarity.
        FieldPreferences(app).updateDebugApiBaseUrl("http://10.0.2.2:3001")

        graph.auth.login("surveyor@coremapmm.com", password)
        val refresh = graph.bootstrap.refresh()
        assertTrue("bootstrap failed: $refresh", graph.bootstrap.variantCount() >= 1)

        val fix = GpsFix(16.8275, 96.1876, 4f, System.currentTimeMillis())
        val recommendations = graph.nearbyRoutes.recommend(fix, System.currentTimeMillis())
        assertTrue("no nearby YBS variants", recommendations.isNotEmpty())
        val pick = recommendations.firstOrNull { it.selection.variantCode == "D0" }
            ?: recommendations.first()
        graph.survey.selectVariant(pick.selection)

        injectFix(fix)
        assertNotNull(graph.survey.state.first().gps)

        val startError = graph.survey.startSurvey()
        assertTrue("startSurvey blocked: $startError", startError == null)
        withTimeout(20_000) {
            while (true) {
                val active = graph.sessionDao.findActive()
                val snap = graph.survey.state.first()
                if (active != null && snap.running && !snap.snapshotRevision.isNullOrBlank() && snap.stops.isNotEmpty()) {
                    break
                }
                injectFix(fix)
                delay(200)
            }
        }
        val sessionId = graph.sessionDao.findActive()!!.clientSessionId

        val stops = graph.survey.state.first().stops
        assertTrue(stops.isNotEmpty())
        graph.survey.selectStop(stops.first().stopPublicId)
        // observedAt must fall inside [session.startedAt, session.endedAt].
        injectFix(GpsFix(16.8275, 96.1876, 4f, System.currentTimeMillis()))
        delay(300)

        val note = "Dashboard smoke ${System.currentTimeMillis()}"
        val submitted = graph.survey.submitReport(AnomalyKind.DATA, note = note)
        assertTrue(
            "submitReport failed: ${graph.survey.state.first().message}",
            submitted,
        )
        val reportId = graph.reports.listAll().first { it.payloadJson.contains(note) }.clientPublicId

        // submitReport enqueues WorkManager immediately. Emulator GPS clocks can precede
        // session.startedAt and mark the first attempt PERMANENT_ERROR. Fix payload and retry.
        delay(1_500)
        val session = graph.sessionDao.findById(sessionId)!!
        val localReport = graph.reports.findById(reportId)!!
        val payload = org.json.JSONObject(localReport.payloadJson)
        val safeObserved = java.time.Instant.ofEpochMilli(session.startedAtEpochMs + 2_000).toString()
        payload.put("observedAt", safeObserved)
        graph.reports.updatePayload(reportId, payload.toString(), System.currentTimeMillis())
        graph.reports.updateStatus(
            reportId,
            LocalReportEntity.STATUS_RETRY,
            null,
            System.currentTimeMillis(),
        )

        FieldWork.enqueue(app)
        withTimeout(90_000) {
            while (true) {
                val session = graph.sessionDao.findById(sessionId)
                val report = graph.reports.findById(reportId)
                if (
                    session?.syncState == LocalSurveySessionEntity.SYNC_SYNCED &&
                    report?.status == LocalReportEntity.STATUS_SYNCED
                ) {
                    break
                }
                if (session?.syncState == LocalSurveySessionEntity.SYNC_PERMANENT_ERROR) {
                    error("session permanent error: ${session.lastError}")
                }
                if (report?.status == LocalReportEntity.STATUS_PERMANENT_ERROR) {
                    error("report permanent error: ${report.lastError}")
                }
                delay(500)
            }
        }

        assertEquals(LocalReportEntity.STATUS_SYNCED, graph.reports.findById(reportId)!!.status)
        // Print for host-side verification against /admin/reports.
        println("DASHBOARD_SMOKE_REPORT_ID=$reportId")
        println("DASHBOARD_SMOKE_SESSION_ID=$sessionId")
        println("DASHBOARD_SMOKE_NOTE=$note")
    }

    private fun injectFix(fix: GpsFix) {
        graph.survey.javaClass.getDeclaredMethod("acceptFix", GpsFix::class.java).apply {
            isAccessible = true
        }.invoke(graph.survey, fix)
    }
}
