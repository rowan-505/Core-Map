package com.coremapmm.fieldsurveyor.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.coremapmm.fieldsurveyor.data.transport.CacheMetadataEntity
import com.coremapmm.fieldsurveyor.data.transport.CacheRouteEntity
import com.coremapmm.fieldsurveyor.data.transport.CacheRoutePathEntity
import com.coremapmm.fieldsurveyor.data.transport.CacheRouteStopEntity
import com.coremapmm.fieldsurveyor.data.transport.CacheStopEntity
import com.coremapmm.fieldsurveyor.data.transport.CacheVariantEntity
import com.coremapmm.fieldsurveyor.data.transport.MIGRATION_1_2
import com.coremapmm.fieldsurveyor.data.transport.TransportCacheDao
import java.io.File

@Database(
    entities = [
        LocalReportEntity::class,
        LocalReportMediaEntity::class,
        LocalSurveySessionEntity::class,
        LocalSurveyVariantCompletionEntity::class,
        LocalSurveyVariantAssignmentEntity::class,
        CacheRouteEntity::class,
        CacheVariantEntity::class,
        CacheStopEntity::class,
        CacheRouteStopEntity::class,
        CacheRoutePathEntity::class,
        CacheMetadataEntity::class,
    ],
    version = FieldDatabase.VERSION,
    exportSchema = false,
)
abstract class FieldDatabase : RoomDatabase() {
    abstract fun localReportDao(): LocalReportDao
    abstract fun localReportMediaDao(): LocalReportMediaDao
    abstract fun localSurveySessionDao(): LocalSurveySessionDao
    abstract fun localSurveyVariantCompletionDao(): LocalSurveyVariantCompletionDao
    abstract fun localSurveyVariantAssignmentDao(): LocalSurveyVariantAssignmentDao
    abstract fun transportCacheDao(): TransportCacheDao

    companion object {
        const val FILE_NAME = "field.db"
        const val VERSION = 9

        fun create(context: Context): FieldDatabase {
            val app = context.applicationContext
            val file = File(app.noBackupFilesDir, FILE_NAME)
            return createAt(app, file)
        }

        fun createAt(context: Context, file: File): FieldDatabase {
            val app = context.applicationContext
            return Room.databaseBuilder(app, FieldDatabase::class.java, file.absolutePath)
                .addMigrations(
                    MIGRATION_1_2,
                    MIGRATION_2_3,
                    MIGRATION_3_4,
                    MIGRATION_4_5,
                    MIGRATION_5_6,
                    MIGRATION_6_7,
                    MIGRATION_7_8,
                    MIGRATION_8_9,
                )
                .build()
        }
    }
}
