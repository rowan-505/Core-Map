package com.coremapmm.fieldsurveyor.nav

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.Route
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.coremapmm.fieldsurveyor.ui.settings.tr

@Composable
fun FieldBottomBar(
    currentRoute: String?,
    onRoutes: () -> Unit,
    onSurvey: () -> Unit,
    onSettings: () -> Unit,
) {
    Column {
        NavigationBar(
            modifier = Modifier.height(68.dp).testTag("field_bottom_navigation"),
            containerColor = MaterialTheme.colorScheme.surfaceContainer,
            windowInsets = WindowInsets(0, 0, 0, 0),
        ) {
            NavigationBarItem(
            selected = currentRoute == FieldRoutes.Routes,
            onClick = onRoutes,
            icon = { Icon(Icons.Outlined.Route, contentDescription = tr("Routes"), modifier = Modifier.size(24.dp)) },
            label = { Text(tr("Routes"), fontSize = 12.sp) },
            colors = fieldNavigationItemColors(),
        )
        NavigationBarItem(
            selected = currentRoute == FieldRoutes.Survey,
            onClick = onSurvey,
            icon = { Icon(Icons.Outlined.Map, contentDescription = tr("Survey"), modifier = Modifier.size(24.dp)) },
            label = { Text(tr("Survey"), fontSize = 12.sp) },
            colors = fieldNavigationItemColors(),
        )
        NavigationBarItem(
            selected = FieldRoutes.settingsSection(currentRoute),
            onClick = onSettings,
            icon = { Icon(Icons.Outlined.Settings, contentDescription = tr("Settings"), modifier = Modifier.size(24.dp)) },
            label = { Text(tr("Settings"), fontSize = 12.sp) },
            colors = fieldNavigationItemColors(),
        )
        }
        Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
    }
}

@Composable
private fun fieldNavigationItemColors() = NavigationBarItemDefaults.colors(
    selectedIconColor = Color(0xFF005C40),
    selectedTextColor = Color(0xFF103D2F),
    indicatorColor = Color(0xFF65E6B4),
    unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
    unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
)
