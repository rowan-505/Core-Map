package com.coremapmm.fieldsurveyor.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FieldDatabaseRecoveryInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun offlineSessionAndReportSurviveDatabaseReopen() {
        runBlocking {
            val file = File(context.cacheDir, "field-persistence-${System.nanoTime()}.db")
            val first = FieldDatabase.createAt(context, file)
            val session = LocalSurveySessionEntity(
                "persisted-session", null, "route", "YBS-13", "variant", "D0", null, null,
                "rev", 1_000L, null, LocalSurveySessionEntity.STATUS_ACTIVE,
                LocalSurveySessionEntity.SYNC_LOCAL, 1_000L,
            )
            first.localSurveySessionDao().insert(session)
            first.localReportDao().upsert(
                LocalReportEntity("persisted-report", LocalReportEntity.STATUS_LOCAL, "{}", 1_000L, 1_000L,
                    sessionClientSessionId = session.clientSessionId),
            )
            first.close()

            val reopened = FieldDatabase.createAt(context, file)
            assertNotNull(reopened.localSurveySessionDao().findById("persisted-session"))
            assertNotNull(reopened.localReportDao().findById("persisted-report"))
            assertEquals(1, reopened.localSurveySessionDao().observeHistory().first().single().reportCount)
            reopened.close()
            file.delete()
        }
    }

    @Test
    fun unsupportedSchemaFailsWithoutDestructiveFallback() {
        val file = File(context.cacheDir, "field-future-${System.nanoTime()}.db")
        val raw = android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(file, null)
        raw.execSQL("CREATE TABLE sentinel (value TEXT NOT NULL)")
        raw.execSQL("INSERT INTO sentinel VALUES ('keep-me')")
        raw.version = FieldDatabase.VERSION + 1
        raw.close()

        val opened = runCatching {
            FieldDatabase.createAt(context, file).openHelper.writableDatabase
        }
        assertTrue(opened.isFailure)

        val verify = android.database.sqlite.SQLiteDatabase.openDatabase(file.absolutePath, null, android.database.sqlite.SQLiteDatabase.OPEN_READONLY)
        verify.rawQuery("SELECT value FROM sentinel", null).use {
            assertTrue(it.moveToFirst())
            assertEquals("keep-me", it.getString(0))
        }
        verify.close()
        file.delete()
    }
}
