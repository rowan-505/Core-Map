package com.coremapmm.fieldsurveyor.e2e

import android.content.Context
import android.graphics.Bitmap
import android.os.ParcelFileDescriptor
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import com.coremapmm.fieldsurveyor.FieldApp
import com.coremapmm.fieldsurveyor.MainActivity
import com.coremapmm.fieldsurveyor.auth.SecureTokenStore
import com.coremapmm.fieldsurveyor.data.LocalReportEntity
import com.coremapmm.fieldsurveyor.data.LocalReportMediaEntity
import com.coremapmm.fieldsurveyor.survey.AnomalyKind
import com.coremapmm.fieldsurveyor.survey.GpsFix
import com.coremapmm.fieldsurveyor.survey.RouteIssueKind
import com.coremapmm.fieldsurveyor.work.FieldWork
import com.coremapmm.fieldsurveyor.log.FieldLog
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

@RunWith(AndroidJUnit4::class)
class FieldFullStackE2ETest {
    private val app = ApplicationProvider.getApplicationContext<FieldApp>()
    private val graph get() = app.graph

    @Before
    fun requireExplicitFullStackOptIn() {
        assumeTrue(
            "full-stack E2E requires disposable API, database, and media storage",
            InstrumentationRegistry.getArguments().getString("fieldE2E") == "true",
        )
    }

    @Test
    fun phase1_onlineCapture() = runBlocking {
        val password = requireNotNull(
            InstrumentationRegistry.getArguments().getString("fieldE2EPassword"),
        ) { "fieldE2EPassword instrumentation argument is required" }
        graph.auth.login("surveyor@coremapmm.com", password)
        val refresh = graph.bootstrap.refresh()
        assertTrue("bootstrap refresh failed: $refresh", graph.bootstrap.variantCount() >= 2)

        val synthetic = GpsFix(16.7600, 96.2000, 3f, System.currentTimeMillis())
        val recommendations = graph.nearbyRoutes.recommend(synthetic, System.currentTimeMillis())
        val d0 = recommendations.first { it.selection.variantCode == "D0" }
        graph.survey.selectVariant(d0.selection)

        ActivityScenario.launch(MainActivity::class.java).use {
            graph.survey.startupLocation()
            delay(500)
            if (graph.survey.state.first().gps == null) injectSyntheticFix()
            assertNotNull(graph.survey.state.first().gps)
            graph.survey.startSurvey()
            withTimeout(10_000) {
                while (graph.sessionDao.findActive() == null) delay(100)
            }
            saveScreenshot("01-survey-d0-started.png")

            val firstStop = graph.survey.state.first().stops.first()
            graph.survey.selectStop(firstStop.stopPublicId)
            val beforeCorrect = graph.reports.countAll()
            assertTrue(graph.survey.markStopCorrect())
            assertEquals(beforeCorrect, graph.reports.countAll())

            assertTrue(graph.survey.submitReport(AnomalyKind.DATA, note = "E2E text report"))
            delay(100)
            val photo = makePortraitJpeg()
            assertTrue(graph.survey.submitReport(AnomalyKind.MISSING, note = "E2E portrait photo", photoDrafts = listOf(photo)))
            delay(100)
            val voice = File(app.cacheDir, "e2e-voice.m4a").apply { writeBytes(ByteArray(2048) { (it % 251).toByte() }) }
            assertTrue(graph.survey.submitReport(AnomalyKind.OTHER, note = "E2E voice", voiceDraft = voice, voiceDurationMs = 2_000))

            assertEquals(3, graph.reports.countAll())
        }
        assertNotNull(graph.sessionDao.findActive())
        assertEquals(2, graph.reportMedia.allLocalPaths().size)
    }

    @Test
    fun phase1b_offlineCaptureDirectionSwitchAndFinish() = runBlocking {
        assertEquals(1, airplaneMode())
        ActivityScenario.launch(MainActivity::class.java).use {
            graph.survey.loadCachedVariant()
            assertTrue(graph.survey.restoreActiveSurvey())
            graph.survey.locate()
            delay(500)
            if (graph.survey.state.first().gps == null) injectSyntheticFix()
            assertNotNull(graph.survey.state.first().gps)
            val d0Session = graph.sessionDao.findActive()!!
            assertTrue(graph.survey.submitReport(AnomalyKind.ROUTE, note = "E2E offline report", routeIssue = RouteIssueKind.PATH_WRONG))
            assertEquals(4, graph.reports.countAll())
            val offlineReportId = graph.reports.listAll().single { it.payloadJson.contains("E2E offline report") }.clientPublicId
            graph.survey.switchToOppositeDirection()
            withTimeout(10_000) { while (graph.sessionDao.findActive()?.variantCode != "D1") delay(100) }
            val d1Session = graph.sessionDao.findActive()!!
            assertNotEquals(d0Session.clientSessionId, d1Session.clientSessionId)
            assertNotEquals(LocalReportEntity.STATUS_SYNCED, graph.reports.findById(offlineReportId)!!.status)
            assertEquals(4, graph.reports.countForSession(d0Session.clientSessionId))
            assertEquals(0, graph.reports.countForSession(d1Session.clientSessionId))
            assertEquals("COMPLETED", graph.sessionDao.findById(d0Session.clientSessionId)!!.status)
            saveScreenshot("02-survey-d1-offline.png")
            graph.survey.endSurvey()
            withTimeout(10_000) { while (graph.sessionDao.findActive() != null) delay(100) }
        }
        assertEquals(2, graph.sessionDao.observeHistory().first().size)
        assertEquals(2, graph.reportMedia.allLocalPaths().size)
    }

    @Test
    fun phase2_restartAuthRefreshAndWorkManagerFailure() = runBlocking {
        assertEquals(2, graph.sessionDao.observeHistory().first().size)
        assertEquals(4, graph.reports.countAll())
        assertEquals(2, graph.reportMedia.allLocalPaths().size)
        assertNotNull(graph.auth.currentSession())
        val existing = graph.auth.currentSession()!!
        val expired = existing.copy(accessToken = "expired.e2e.token", accessExpiresAtEpochMs = 1L)
        SecureTokenStore(app).save(expired)
        @Suppress("UNCHECKED_CAST")
        val sessionFlow = graph.auth.javaClass.getDeclaredField("sessionFlow").apply { isAccessible = true }
            .get(graph.auth) as MutableStateFlow<com.coremapmm.fieldsurveyor.auth.AuthSession?>
        sessionFlow.value = expired
        val recovered = graph.auth.validAccessToken()
        assertNotEquals("expired.e2e.token", recovered)

        val mediaToFail = mediaRows().first()
        graph.reportMedia.updateState(
            mediaToFail.mediaPublicId,
            LocalReportMediaEntity.STATE_RETRY,
            "E2E forced storage outage",
            System.currentTimeMillis(),
        )

        FieldWork.enqueue(app)
        withTimeout(45_000) {
            while (graph.reports.countSynced() != 4) delay(250)
        }
        withTimeout(45_000) {
            while (graph.reportMedia.allLocalPaths().mapNotNull { path ->
                    graph.reportMedia.findById(File(path).nameWithoutExtension)
                }.none { it.syncState == LocalReportMediaEntity.STATE_RETRY }) delay(250)
        }
        assertEquals(4, graph.reports.countSynced())
        assertTrue(graph.reportMedia.allLocalPaths().all { File(it).isFile })
    }

    @Test
    fun phase3_mediaRetryHistoryAndFinalPersistence() = runBlocking {
        mediaRows().filter { it.syncState != LocalReportMediaEntity.STATE_SYNCED }.forEach {
            graph.reportMedia.updateState(
                it.mediaPublicId,
                LocalReportMediaEntity.STATE_RETRY,
                "E2E retry after storage recovery",
                System.currentTimeMillis(),
            )
        }
        logMediaSnapshot("phase3_before")
        FieldWork.enqueue(app)
        FieldWork.enqueueMediaOverCellular(app)
        withTimeout(60_000) {
            var last = ""
            while (mediaRows().count { it.syncState == LocalReportMediaEntity.STATE_SYNCED } != 2) {
                val snap = mediaRows().joinToString { "${it.mediaPublicId}:${it.syncState}" }
                if (snap != last) {
                    logMediaSnapshot("phase3_wait")
                    last = snap
                }
                delay(250)
            }
        }
        logMediaSnapshot("phase3_after")
        assertEquals(2, mediaRows().count { it.syncState == LocalReportMediaEntity.STATE_SYNCED })
        assertEquals(2, mediaRows().mapNotNull { it.remoteAssetPublicId }.distinct().size)
        assertEquals(0, mediaRows().count { it.syncState == LocalReportMediaEntity.STATE_SYNCING })
        assertTrue(mediaRows().all { File(it.localPath).isFile })

        ActivityScenario.launch(MainActivity::class.java).use {
            val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            device.waitForIdle()
            device.findObject(By.text("Settings"))?.click()
            device.waitForIdle()
            device.findObject(By.text("Survey History"))?.click()
            device.waitForIdle()
            saveScreenshot("03-survey-history.png")
        }
        val history = graph.sessionDao.observeHistory().first()
        assertEquals(4, history.single { it.variantCode == "D0" }.reportCount)
        assertEquals(0, history.single { it.variantCode == "D1" }.reportCount)
    }

    private suspend fun mediaRows(): List<LocalReportMediaEntity> = graph.reports.listAll().flatMap {
        graph.reportMedia.listForReport(it.clientPublicId)
    }

    private suspend fun logMediaSnapshot(phase: String) {
        mediaRows().forEach { row ->
            FieldLog.event(
                "e2e_media",
                mapOf(
                    "phase" to phase,
                    "media_id" to row.mediaPublicId,
                    "report_id" to row.reportClientPublicId,
                    "state" to row.syncState,
                    "remote_set" to (row.remoteAssetPublicId != null).toString(),
                ),
            )
        }
    }

    private fun makePortraitJpeg(): File {
        val file = File(app.cacheDir, "e2e-portrait.jpg")
        FileOutputStream(file).use { stream ->
            Bitmap.createBitmap(480, 800, Bitmap.Config.ARGB_8888).apply {
                eraseColor(0xff336699.toInt())
                compress(Bitmap.CompressFormat.JPEG, 90, stream)
                recycle()
            }
        }
        return file
    }

    private fun airplaneMode(): Int {
        val descriptor = InstrumentationRegistry.getInstrumentation().uiAutomation
            .executeShellCommand("settings get global airplane_mode_on")
        return ParcelFileDescriptor.AutoCloseInputStream(descriptor).bufferedReader().use {
            it.readText().trim().toInt()
        }
    }

    private fun injectSyntheticFix() {
        graph.survey.javaClass.getDeclaredMethod("acceptFix", GpsFix::class.java).apply {
            isAccessible = true
        }.invoke(graph.survey, GpsFix(16.7600, 96.2000, 3f, System.currentTimeMillis()))
    }

    private fun saveScreenshot(name: String) {
        val dir = File(app.getExternalFilesDir(null), "e2e").apply { mkdirs() }
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        FileOutputStream(File(dir, name)).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
}
