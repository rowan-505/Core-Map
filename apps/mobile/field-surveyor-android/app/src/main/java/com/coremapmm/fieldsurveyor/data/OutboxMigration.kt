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

val MIGRATION_6_7 = object : Migration(6, 7) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `trackingState` TEXT NOT NULL DEFAULT 'idle'")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `completionStatus` TEXT NOT NULL DEFAULT 'partial'")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `accumulatedActiveSeconds` INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `finishedAtEpochMs` INTEGER")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `reopenedAtEpochMs` INTEGER")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `lastActivityAtEpochMs` INTEGER")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `lastCheckedStopSequence` INTEGER")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `checkedStopCount` INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `totalStopCount` INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `pendingSyncCount` INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `lastGpsAccuracyM` REAL")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `lastLat` REAL")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `lastLng` REAL")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `lastGpsAtEpochMs` INTEGER")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `activeSegmentStartedAtEpochMs` INTEGER")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `lastHeartbeatAtEpochMs` INTEGER")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `pendingFinishSync` INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE `local_survey_sessions` ADD COLUMN `pendingReopenSync` INTEGER NOT NULL DEFAULT 0")
        db.execSQL(
            """
            UPDATE `local_survey_sessions`
            SET trackingState = CASE WHEN status = 'ACTIVE' THEN 'active' ELSE 'idle' END,
                lastActivityAtEpochMs = COALESCE(endedAtEpochMs, startedAtEpochMs),
                activeSegmentStartedAtEpochMs = CASE WHEN status = 'ACTIVE' THEN startedAtEpochMs ELSE NULL END
            """.trimIndent(),
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_local_survey_sessions_variantPublicId` ON `local_survey_sessions` (`variantPublicId`)",
        )
    }
}

val MIGRATION_7_8 = object : Migration(7, 8) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `local_survey_variant_completions` (
              `variantPublicId` TEXT NOT NULL,
              `routePublicId` TEXT,
              `routeCode` TEXT,
              `variantCode` TEXT,
              `isFinished` INTEGER NOT NULL,
              `finishedAtEpochMs` INTEGER,
              `updatedAtEpochMs` INTEGER NOT NULL,
              `syncState` TEXT NOT NULL,
              `lastError` TEXT,
              PRIMARY KEY(`variantPublicId`)
            )
            """.trimIndent(),
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_local_survey_variant_completions_syncState` ON `local_survey_variant_completions` (`syncState`)",
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_local_survey_variant_completions_isFinished` ON `local_survey_variant_completions` (`isFinished`)",
        )
    }
}

val MIGRATION_8_9 = object : Migration(8, 9) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `local_survey_variant_assignments` (
              `publicId` TEXT NOT NULL,
              `variantPublicId` TEXT NOT NULL,
              `routePublicId` TEXT,
              `routeCode` TEXT,
              `variantCode` TEXT,
              `assignedDate` TEXT NOT NULL,
              `dueDate` TEXT,
              `status` TEXT NOT NULL,
              `workStatus` TEXT NOT NULL,
              `remaining` INTEGER NOT NULL,
              `updatedAtEpochMs` INTEGER NOT NULL,
              PRIMARY KEY(`publicId`)
            )
            """.trimIndent(),
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_local_survey_variant_assignments_variantPublicId` ON `local_survey_variant_assignments` (`variantPublicId`)",
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_local_survey_variant_assignments_status` ON `local_survey_variant_assignments` (`status`)",
        )
    }
}
