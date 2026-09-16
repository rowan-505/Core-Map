package com.coremapmm.fieldsurveyor.nav

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsEqualTo
import androidx.compose.ui.test.isSelectable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import com.coremapmm.fieldsurveyor.ui.settings.FieldLanguage
import com.coremapmm.fieldsurveyor.ui.settings.LocalFieldLanguage
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class FieldBottomBarInstrumentedTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun exactlyThreeBottomNavigationTabsAreRendered() {
        compose.setContent {
            CompositionLocalProvider(LocalFieldLanguage provides FieldLanguage.ENGLISH) {
                MaterialTheme {
                    FieldBottomBar(FieldRoutes.Survey, {}, {}, {})
                }
            }
        }

        compose.onAllNodes(isSelectable()).assertCountEquals(3)
        compose.onNodeWithText("Routes").assertExists()
        compose.onNodeWithText("Survey").assertExists()
        compose.onNodeWithText("Settings").assertExists()
        compose.onNodeWithTag("field_bottom_navigation").assertHeightIsEqualTo(68.dp)
        assertEquals(listOf(FieldRoutes.Routes, FieldRoutes.Survey, FieldRoutes.Settings), FieldRoutes.mainTabs)
    }
}
