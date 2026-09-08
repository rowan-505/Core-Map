package com.coremapmm.fieldsurveyor.ui.routes

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coremapmm.fieldsurveyor.data.transport.RouteSelectionRow
import com.coremapmm.fieldsurveyor.data.transport.RouteSyncUi
import com.coremapmm.fieldsurveyor.data.transport.RouteSyncUiState
import com.coremapmm.fieldsurveyor.survey.NearbyRoutePolicy
import com.coremapmm.fieldsurveyor.survey.NearbyRouteRecommendation
import com.coremapmm.fieldsurveyor.survey.NearbyRouteState
import com.coremapmm.fieldsurveyor.ui.settings.FieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.LocalFieldLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NearbyRoutePanelTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun recommendationsShowRouteDirectionStopAndDistanceOnly() {
        val row = NearbyRouteRecommendation(
            selection = RouteSelectionRow("r", "13", "v-d0", "D0", "A", "B", 8),
            nearestStopName = "Sule",
            stopDistanceM = 42.0,
        )
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    NearbyRecommendPanel(
                        state = NearbyRouteState.Recommendations(
                            rows = listOf(row),
                            qualifier = NearbyRoutePolicy.QUALIFIER_STALE,
                        ),
                        onSelect = {},
                    )
                }
            }
        }
        compose.onNodeWithText("13 · D0").assertIsDisplayed()
        compose.onNodeWithText("Sule · ~42 m").assertIsDisplayed()
        compose.onNodeWithText(NearbyRoutePolicy.QUALIFIER_STALE).assertDoesNotExist()
        compose.onNodeWithText("Not surveyed yet").assertDoesNotExist()
        compose.onNodeWithText("GPS accuracy required.").assertDoesNotExist()
    }

    @Test
    fun nearbyListIsCappedAtThree() {
        val rows = (1..5).map { index ->
            NearbyRouteRecommendation(
                selection = RouteSelectionRow("r$index", "$index", "v$index", "D0", "A", "B", 4),
                nearestStopName = "Stop $index",
                stopDistanceM = index * 10.0,
            )
        }
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    NearbyRecommendPanel(
                        state = NearbyRouteState.Recommendations(rows = rows),
                        onSelect = {},
                    )
                }
            }
        }
        compose.onNodeWithText("1 · D0").assertIsDisplayed()
        compose.onNodeWithText("3 · D0").assertIsDisplayed()
        compose.onNodeWithText("4 · D0").assertDoesNotExist()
        assertEquals(3, NearbyRoutePolicy.MAX_RESULTS)
    }

    @Test
    fun noLocationShowsShortEmptyState() {
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    NearbyRecommendPanel(state = NearbyRouteState.NoLocation, onSelect = {})
                }
            }
        }
        compose.onNodeWithText("No location yet").assertIsDisplayed()
    }

    @Test
    fun noNearbyShowsShortEmptyState() {
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    NearbyRecommendPanel(state = NearbyRouteState.NoNearby, onSelect = {})
                }
            }
        }
        compose.onNodeWithText("No nearby routes").assertIsDisplayed()
    }

    @Test
    fun failedWithCacheShowsCompactStatusAndTryAgain() {
        var tried = false
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    RouteSyncStatusRow(
                        state = RouteSyncUiState.FailedWithCache(12, "rev"),
                        onTryAgain = { tried = true },
                    )
                }
            }
        }
        compose.onNodeWithText(RouteSyncUi.LABEL_FAILED_WITH_CACHE).assertIsDisplayed()
        compose.onNodeWithTag("route_sync_try_again").performClick()
        assertTrue(tried)
        compose.onNodeWithText(RouteSyncUi.LABEL_FAILED_WITHOUT_CACHE).assertDoesNotExist()
    }
}
