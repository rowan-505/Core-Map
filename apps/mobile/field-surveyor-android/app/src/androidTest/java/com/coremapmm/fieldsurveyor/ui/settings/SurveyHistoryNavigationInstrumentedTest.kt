package com.coremapmm.fieldsurveyor.ui.settings

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.coremapmm.fieldsurveyor.data.FieldDatabase
import com.coremapmm.fieldsurveyor.data.LocalSurveySessionEntity
import com.coremapmm.fieldsurveyor.data.SurveySessionRepository
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test

class SurveyHistoryNavigationInstrumentedTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var db: FieldDatabase

    @Before
    fun setup() = runBlocking {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext<Context>(),
            FieldDatabase::class.java,
        ).build()
        db.localSurveySessionDao().insert(
            LocalSurveySessionEntity(
                "zero-report", null, "route", "YBS-13", "variant-d0", "D0", "Sule", "Hledan",
                "rev", 1_000L, 2_000L, LocalSurveySessionEntity.STATUS_COMPLETED,
                LocalSurveySessionEntity.SYNC_LOCAL, 2_000L,
            ),
        )
    }

    @After fun close() = db.close()

    @Test
    fun settingsOpensHistoryAndShowsZeroReportSurvey() {
        val repository = SurveySessionRepository(
            db.localSurveySessionDao(),
            db.localReportDao(),
            db.localReportMediaDao(),
        )
        var historyVisible by mutableStateOf(false)
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    if (historyVisible) {
                        SurveyHistoryScreen(
                            repository,
                            completions = db.localSurveyVariantCompletionDao(),
                            onBack = { historyVisible = false },
                            onOpen = {},
                        )
                    } else {
                        SettingsHomeScreen(
                            language = FieldLanguage.ENGLISH,
                            themeMode = FieldThemeMode.LIGHT,
                            onLanguage = {},
                            onThemeMode = {},
                            onHistory = { historyVisible = true },
                            onProfile = {},
                            onOutbox = {},
                            onInfra = {},
                        )
                    }
                }
            }
        }

        compose.onNodeWithText("Survey History").performClick()
        compose.waitUntil(5_000L) {
            compose.onAllNodesWithText("YBS-13 · D0").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("YBS-13 · D0").assertIsDisplayed()
        compose.onNodeWithText("0 reports").assertIsDisplayed()
    }
}
