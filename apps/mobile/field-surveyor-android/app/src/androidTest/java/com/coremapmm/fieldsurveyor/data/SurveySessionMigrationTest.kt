package com.coremapmm.fieldsurveyor.data

import android.content.Context
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SurveySessionMigrationTest {
    @Test
    fun migration4To5PreservesReportsAndAddsSessionLink() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "survey-migration-test.db"
        context.deleteDatabase(name)
        val legacy = context.openOrCreateDatabase(name, Context.MODE_PRIVATE, null)
        legacy.execSQL("CREATE TABLE local_reports (clientPublicId TEXT NOT NULL PRIMARY KEY, status TEXT NOT NULL, payloadJson TEXT NOT NULL, createdAtEpochMs INTEGER NOT NULL, updatedAtEpochMs INTEGER NOT NULL, lastError TEXT)")
        legacy.execSQL("INSERT INTO local_reports VALUES ('report-1','LOCAL','{}',1,1,NULL)")
        legacy.version = 4
        legacy.close()
        val helper = FrameworkSQLiteOpenHelperFactory().create(
            SupportSQLiteOpenHelper.Configuration.builder(context)
                .name(name)
                .callback(object : SupportSQLiteOpenHelper.Callback(5) {
                    override fun onCreate(db: SupportSQLiteDatabase) = Unit
                    override fun onUpgrade(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) {
                        MIGRATION_4_5.migrate(db)
                    }
                })
                .build(),
        )
        val migrated = helper.writableDatabase
        migrated.query("SELECT COUNT(*), sessionClientSessionId FROM local_reports").use {
            it.moveToFirst()
            assertEquals(1, it.getInt(0))
            assertEquals(true, it.isNull(1))
        }
        migrated.query("PRAGMA foreign_key_list(local_reports)").use {
            assertEquals(true, it.moveToFirst())
            assertEquals("local_survey_sessions", it.getString(it.getColumnIndexOrThrow("table")))
        }
        helper.close()
        context.deleteDatabase(name)
    }

    @Test
    fun migration5To6AddsMediaMetadataColumns() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "media-migration-test.db"
        context.deleteDatabase(name)
        val legacy = context.openOrCreateDatabase(name, Context.MODE_PRIVATE, null)
        legacy.execSQL(
            """
            CREATE TABLE local_report_media (
              mediaPublicId TEXT NOT NULL PRIMARY KEY,
              reportClientPublicId TEXT NOT NULL,
              localPath TEXT NOT NULL,
              mimeType TEXT NOT NULL,
              byteSize INTEGER NOT NULL,
              syncState TEXT NOT NULL,
              remoteAssetPublicId TEXT,
              createdAtEpochMs INTEGER NOT NULL,
              updatedAtEpochMs INTEGER NOT NULL,
              lastError TEXT
            )
            """.trimIndent(),
        )
        legacy.execSQL("INSERT INTO local_report_media VALUES ('m1','r1','/tmp/a.jpg','image/jpeg',10,'LOCAL',NULL,1,1,NULL)")
        legacy.version = 5
        legacy.close()
        val helper = FrameworkSQLiteOpenHelperFactory().create(
            SupportSQLiteOpenHelper.Configuration.builder(context)
                .name(name)
                .callback(object : SupportSQLiteOpenHelper.Callback(6) {
                    override fun onCreate(db: SupportSQLiteDatabase) = Unit
                    override fun onUpgrade(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) {
                        MIGRATION_5_6.migrate(db)
                    }
                })
                .build(),
        )
        val migrated = helper.writableDatabase
        migrated.query("SELECT pixelWidth, pixelHeight, checksumSha256, durationMs FROM local_report_media").use {
            it.moveToFirst()
            assertEquals(0, it.getInt(0))
            assertEquals(0, it.getInt(1))
            assertEquals("", it.getString(2))
            assertEquals(true, it.isNull(3))
        }
        helper.close()
        context.deleteDatabase(name)
    }
}
