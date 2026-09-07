package com.coremapmm.fieldsurveyor.nav

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.coremapmm.fieldsurveyor.AppGraph
import com.coremapmm.fieldsurveyor.device.DeviceStatus
import androidx.compose.runtime.rememberCoroutineScope
import com.coremapmm.fieldsurveyor.ui.login.LoginScreen
import com.coremapmm.fieldsurveyor.ui.outbox.OutboxScreen
import com.coremapmm.fieldsurveyor.ui.routes.RoutesScreen
import com.coremapmm.fieldsurveyor.ui.settings.ProfileScreen
import com.coremapmm.fieldsurveyor.ui.settings.SettingsHomeScreen
import com.coremapmm.fieldsurveyor.ui.settings.SurveyHistoryDetailScreen
import com.coremapmm.fieldsurveyor.ui.settings.SurveyHistoryScreen
import com.coremapmm.fieldsurveyor.ui.settings.SettingsPage
import com.coremapmm.fieldsurveyor.ui.settings.FieldPreferences
import com.coremapmm.fieldsurveyor.ui.settings.tr
import com.coremapmm.fieldsurveyor.ui.setup.SetupSyncScreen
import com.coremapmm.fieldsurveyor.ui.survey.SurveyScreen
import com.coremapmm.fieldsurveyor.work.FieldWork
import kotlinx.coroutines.launch

@Composable
fun FieldNavHost(graph: AppGraph, display: FieldPreferences) {
    val session by graph.auth.session.collectAsStateWithLifecycle()
    val surveyState by graph.survey.state.collectAsStateWithLifecycle()
    val navController = rememberNavController()
    val start = when {
        session == null -> FieldRoutes.Login
        !graph.yangon.isReady() -> FieldRoutes.Setup
        else -> FieldRoutes.Routes
    }
    val backStack by navController.currentBackStackEntryAsState()
    val current = backStack?.destination?.route
    val showTabs = current in FieldRoutes.mainTabs || FieldRoutes.settingsSection(current)
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var online by remember { mutableStateOf(DeviceStatus.isOnline(context)) }
    var lowStorage by remember { mutableStateOf(DeviceStatus.isLowStorage(context)) }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                online = DeviceStatus.isOnline(context)
                lowStorage = DeviceStatus.isLowStorage(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    fun loggedOut() {
        graph.survey.abandonSurvey()
        navController.navigate(FieldRoutes.Login) {
            popUpTo(navController.graph.id) { inclusive = true }
            launchSingleTop = true
        }
    }

    LaunchedEffect(session, current) {
        if (session == null && current != null && current != FieldRoutes.Login) {
            loggedOut()
        }
    }

    LaunchedEffect(surveyState.openSurveyRequestId, session) {
        if (
            surveyState.openSurveyRequestId > 0L &&
            session != null &&
            graph.yangon.isReady() &&
            current != FieldRoutes.Survey
        ) {
            navController.openTab(FieldRoutes.Survey)
        }
    }

    Scaffold(
        bottomBar = {
            if (showTabs) {
                FieldBottomBar(
                    currentRoute = current,
                    onRoutes = { navController.openTab(FieldRoutes.Routes) },
                    onSurvey = { navController.openTab(FieldRoutes.Survey) },
                    onSettings = { navController.openTab(FieldRoutes.Settings) },
                )
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            if (!online) {
                StatusBanner(tr("No internet. Survey capture still works. Sync waits until you are online."))
            }
            if (lowStorage) {
                StatusBanner(tr("Storage is low. Free space before downloading maps or capturing media."))
            }
            NavHost(
                navController = navController,
                startDestination = start,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            ) {
            composable(FieldRoutes.Login) {
                LoginScreen(
                    auth = graph.auth,
                    apiBaseUrl = graph.apiBaseUrl,
                    onLoggedIn = {
                        FieldWork.enqueue(context)
                        navController.navigate(FieldRoutes.Setup) {
                            popUpTo(FieldRoutes.Login) { inclusive = true }
                        }
                    },
                )
            }
            composable(FieldRoutes.Setup) {
                SetupSyncScreen(
                    bootstrap = graph.bootstrap,
                    yangon = graph.yangon,
                    onDisplaySettings = { navController.navigate(FieldRoutes.Settings) },
                    onContinue = {
                        navController.navigate(FieldRoutes.Routes) {
                            popUpTo(FieldRoutes.Setup) { inclusive = true }
                        }
                    },
                )
            }
            composable(FieldRoutes.Routes) {
                val scope = rememberCoroutineScope()
                RoutesScreen(
                    bootstrap = graph.bootstrap,
                    survey = graph.survey,
                    nearbyRoutes = graph.nearbyRoutes,
                    onNeedSync = { navController.navigate(FieldRoutes.Infra) },
                    onSelectVariant = { row ->
                        scope.launch {
                            graph.survey.selectVariant(row)
                            navController.openTab(FieldRoutes.Survey)
                        }
                    },
                )
            }
            composable(FieldRoutes.Survey) { SurveyScreen(graph.survey) }
            composable(FieldRoutes.Settings) {
                SettingsHomeScreen(
                    language = display.language,
                    themeMode = display.themeMode,
                    onLanguage = display::updateLanguage,
                    onThemeMode = display::updateThemeMode,
                    onHistory = { navController.navigate(FieldRoutes.History) },
                    onProfile = { navController.navigate(FieldRoutes.Profile) },
                    onOutbox = { navController.navigate(FieldRoutes.Outbox) },
                    onInfra = { navController.navigate(FieldRoutes.Infra) },
                )
            }
            composable(FieldRoutes.History) {
                SurveyHistoryScreen(
                    repository = graph.sessions,
                    onBack = { navController.popBackStack() },
                    onOpen = { navController.navigate(FieldRoutes.historyDetail(it)) },
                )
            }
            composable(FieldRoutes.HistoryDetail) { entry ->
                val id = entry.arguments?.getString("clientSessionId").orEmpty()
                val scope = rememberCoroutineScope()
                SurveyHistoryDetailScreen(
                    repository = graph.sessions,
                    sessionId = id,
                    onBack = { navController.popBackStack() },
                    onViewRoute = { session ->
                        scope.launch {
                            graph.survey.openHistoryRoute(session)
                            navController.openTab(FieldRoutes.Survey)
                        }
                    },
                )
            }
            composable(FieldRoutes.Profile) {
                SettingsPage(title = tr("Profile"), onBack = { navController.popBackStack() }) {
                    ProfileScreen(
                        auth = graph.auth,
                        apiBaseUrl = graph.apiBaseUrl,
                        onLoggedOut = { loggedOut() },
                    )
                }
            }
            composable(FieldRoutes.Outbox) {
                OutboxScreen(
                    reports = graph.reports,
                    photos = graph.photos,
                    reportMedia = graph.reportMedia,
                    onBack = { navController.popBackStack() },
                )
            }
            composable(FieldRoutes.Infra) {
                SettingsPage(title = tr("Infra"), onBack = { navController.popBackStack() }) {
                    SetupSyncScreen(
                        bootstrap = graph.bootstrap,
                        yangon = graph.yangon,
                        title = "",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
        }
    }
}

@Composable
private fun StatusBanner(text: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.errorContainer,
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onErrorContainer,
        )
    }
}

private fun NavHostController.openTab(route: String) {
    navigate(route) {
        popUpTo(FieldRoutes.Routes) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
