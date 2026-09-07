package com.coremapmm.fieldsurveyor.data

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `local_reports` ADD COLUMN `lastError` TEXT")
        db.execSQL(
            """
            UPDATE `local_reports` SET `status` = CASE
              WHEN `status` IN ('draft', 'queued') THEN 'QUEUED'
              WHEN `status` = 'failed' THEN 'RETRY'
              WHEN `status` = 'synced' THEN 'SYNCED'
              ELSE `status`
            END
            """.trimIndent(),
        )
    }
}

val MIGRATION_3_4 = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `local_report_media` (
              `mediaPublicId` TEXT NOT NULL,
              `reportClientPublicId` TEXT NOT NULL,
              `localPath` TEXT NOT NULL,
              `mimeType` TEXT NOT NULL,
              `byteSize` INTEGER NOT NULL,
              `syncState` TEXT NOT NULL,
              `remoteAssetPublicId` TEXT,
              `createdAtEpochMs` INTEGER NOT NULL,
              `updatedAtEpochMs` INTEGER NOT NULL,
              `lastError` TEXT,
              PRIMARY KEY(`mediaPublicId`)
            )
            """.trimIndent(),
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_local_report_media_reportClientPublicId` ON `local_report_media` (`reportClientPublicId`)",
        )
    }
}

val MIGRATION_4_5 = object : Migration(4, 5) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `local_survey_sessions` (
              `clientSessionId` TEXT NOT NULL,
              `serverPublicId` TEXT,
              `routePublicId` TEXT NOT NULL,
              `routeCode` TEXT NOT NULL,
              `variantPublicId` TEXT NOT NULL,
              `variantCode` TEXT NOT NULL,
              `originName` TEXT,
              `destinationName` TEXT,
              `snapshotRevision` TEXT NOT NULL,
              `startedAtEpochMs` INTEGER NOT NULL,
              `endedAtEpochMs` INTEGER,
              `status` TEXT NOT NULL,
              `syncState` TEXT NOT NULL,
              `updatedAtEpochMs` INTEGER NOT NULL,
              `lastError` TEXT,
              PRIMARY KEY(`clientSessionId`)
            )
            """.trimIndent(),
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_local_survey_sessions_startedAtEpochMs` ON `local_survey_sessions` (`startedAtEpochMs`)")
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_local_survey_sessions_syncState` ON `local_survey_sessions` (`syncState`)")
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_local_survey_sessions_serverPublicId` ON `local_survey_sessions` (`serverPublicId`)")
        db.execSQL("ALTER TABLE `local_reports` ADD COLUMN `sessionClientSessionId` TEXT REFERENCES `local_survey_sessions`(`clientSessionId`) ON UPDATE NO ACTION ON DELETE NO ACTION")
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_local_reports_sessionClientSessionId` ON `local_reports` (`sessionClientSessionId`)")
    }
}

val MIGRATION_5_6 = object : Migration(5, 6) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `local_report_media` ADD COLUMN `pixelWidth` INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE `local_report_media` ADD COLUMN `pixelHeight` INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE `local_report_media` ADD COLUMN `checksumSha256` TEXT NOT NULL DEFAULT ''")
        db.execSQL("ALTER TABLE `local_report_media` ADD COLUMN `durationMs` INTEGER")
    }
}
