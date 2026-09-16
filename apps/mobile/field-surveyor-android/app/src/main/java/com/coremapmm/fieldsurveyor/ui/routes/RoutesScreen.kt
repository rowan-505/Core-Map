package com.coremapmm.fieldsurveyor.ui.routes

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.coremapmm.fieldsurveyor.data.transport.BootstrapRefreshPhase
import com.coremapmm.fieldsurveyor.data.transport.BootstrapRepository
import com.coremapmm.fieldsurveyor.data.transport.RouteSelectionFilter
import com.coremapmm.fieldsurveyor.data.transport.RouteSelectionRow
import com.coremapmm.fieldsurveyor.data.transport.RouteSyncUi
import com.coremapmm.fieldsurveyor.data.transport.RouteSyncUiState
import com.coremapmm.fieldsurveyor.device.DeviceStatus
import com.coremapmm.fieldsurveyor.survey.GpsFix
import com.coremapmm.fieldsurveyor.survey.NearbyRouteFlow
import com.coremapmm.fieldsurveyor.survey.NearbyRouteLocationPolicy
import com.coremapmm.fieldsurveyor.survey.NearbyRouteNavigation
import com.coremapmm.fieldsurveyor.survey.NearbyRoutePolicy
import com.coremapmm.fieldsurveyor.survey.NearbyRouteRecommendation
import com.coremapmm.fieldsurveyor.survey.NearbyRouteRecommender
import com.coremapmm.fieldsurveyor.survey.NearbyRouteRecompute
import com.coremapmm.fieldsurveyor.survey.NearbyRouteState
import com.coremapmm.fieldsurveyor.survey.SurveyAssignmentMapping
import com.coremapmm.fieldsurveyor.survey.SurveyController
import com.coremapmm.fieldsurveyor.survey.SurveyVariantCompletionMapping
import com.coremapmm.fieldsurveyor.ui.settings.tr
import com.coremapmm.fieldsurveyor.ui.components.StatusPill
import kotlinx.coroutines.launch

@Composable
fun RoutesScreen(
    bootstrap: BootstrapRepository,
    survey: SurveyController,
    nearbyRoutes: NearbyRouteRecommender,
    onNeedSync: () -> Unit,
    onSelectVariant: (RouteSelectionRow) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val surveyState by survey.state.collectAsStateWithLifecycle()
    var allRows by remember { mutableStateOf<List<RouteSelectionRow>>(emptyList()) }
    var completionByVariant by remember { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var assignmentByVariant by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var query by remember { mutableStateOf("") }
    var recommendState by remember { mutableStateOf<NearbyRouteState>(NearbyRouteState.Idle) }
    var lastRecommendFix by remember { mutableStateOf<GpsFix?>(null) }
    var lastRecommendAtMs by remember { mutableLongStateOf(0L) }
    var routeSync by remember { mutableStateOf<RouteSyncUiState>(RouteSyncUiState.NotDownloaded) }
    var syncName by rememberSaveable { mutableStateOf("NotDownloaded") }
    var syncCount by rememberSaveable { mutableStateOf(0) }
    var syncRevision by rememberSaveable { mutableStateOf<String?>(null) }

    fun persistSync(state: RouteSyncUiState) {
        routeSync = state
        syncName = RouteSyncUi.persistenceName(state)
        syncCount = state.variantCount
        syncRevision = state.revision
    }

    fun hasLocationPermission(): Boolean {
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        return fine || coarse
    }

    suspend fun refreshRecommendations(force: Boolean) {
        val now = System.currentTimeMillis()
        val snapshot = survey.state.value.location
        val pendingFix = NearbyRouteLocationPolicy.select(snapshot, survey.state.value.gps)?.fix
        if (!force && !NearbyRouteRecompute.shouldRecompute(lastRecommendFix, pendingFix, lastRecommendAtMs, now)) {
            return
        }
        if (force || recommendState !is NearbyRouteState.Recommendations) {
            recommendState = NearbyRouteFlow.retainDuringRefresh(recommendState, NearbyRouteState.Locating)
        }
        val next = runRecommend(bootstrap, survey, nearbyRoutes)
        lastRecommendFix = NearbyRouteLocationPolicy.select(
            survey.state.value.location,
            survey.state.value.gps,
        )?.fix
        lastRecommendAtMs = now
        recommendState = NearbyRouteFlow.retainDuringRefresh(recommendState, next)
    }

    suspend fun runRouteRefresh() {
        val online = DeviceStatus.isOnline(context)
        persistSync(RouteSyncUi.downloading(routeSync))
        val result = bootstrap.refresh { phase ->
            if (phase == BootstrapRefreshPhase.IMPORTING) {
                persistSync(RouteSyncUi.importing(routeSync))
            }
        }
        val count = bootstrap.variantCount()
        val revision = bootstrap.snapshotRevision()
        persistSync(
            RouteSyncUi.fromRefreshResult(
                result = result,
                online = online,
                fallbackCount = count,
                fallbackRevision = revision,
            ),
        )
        allRows = bootstrap.listSelections()
        if (hasLocationPermission()) {
            refreshRecommendations(force = true)
        }
        completionByVariant = survey.variantCompletionStatuses()
        assignmentByVariant = survey.assignmentWorkStatuses()
    }

    val locationPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        val allowed = granted[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            granted[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (allowed) {
            scope.launch { refreshRecommendations(force = true) }
        } else {
            recommendState = NearbyRouteState.PermissionRequired
        }
    }

    LaunchedEffect(Unit) {
        val online = DeviceStatus.isOnline(context)
        val count = bootstrap.variantCount()
        val revision = bootstrap.snapshotRevision()
        allRows = bootstrap.listSelections()
        completionByVariant = survey.variantCompletionStatuses()
        assignmentByVariant = survey.assignmentWorkStatuses()
        val restored = RouteSyncUi.restore(syncName, syncCount.takeIf { it > 0 } ?: count, syncRevision ?: revision, online)
        persistSync(
            if (restored is RouteSyncUiState.Downloading || restored is RouteSyncUiState.Importing) {
                RouteSyncUi.initial(count, revision, online)
            } else {
                restored
            },
        )
        if (hasLocationPermission()) {
            refreshRecommendations(force = true)
        }
    }

    LaunchedEffect(surveyState.snapshotRevision, surveyState.variantFinished) {
        val rows = bootstrap.listSelections()
        allRows = rows
        completionByVariant = survey.variantCompletionStatuses()
        assignmentByVariant = survey.assignmentWorkStatuses()
        if (hasLocationPermission()) {
            refreshRecommendations(force = false)
        }
    }

    LaunchedEffect(
        surveyState.location.status,
        surveyState.location.displayFix?.lat,
        surveyState.location.displayFix?.lng,
        surveyState.location.displayFix?.epochMs,
    ) {
        if (hasLocationPermission()) {
            refreshRecommendations(force = false)
        }
    }

    val visible = remember(allRows, query, assignmentByVariant) {
        SurveyAssignmentMapping.sortRoutes(
            RouteSelectionFilter.byRouteCode(allRows, query),
            assignmentByVariant,
        )
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(tr("Routes"), style = MaterialTheme.typography.titleLarge, modifier = Modifier.testTag("routes_title"))
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text(tr("Search route code")) },
                singleLine = true,
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                modifier = Modifier.fillMaxWidth().testTag("routes_search"),
            )
            RouteSyncStatusRow(
                state = routeSync,
                onTryAgain = {
                    if (!RouteSyncUi.hasUsableCache(routeSync) && allRows.isEmpty()) {
                        onNeedSync()
                    } else {
                        scope.launch { runRouteRefresh() }
                    }
                },
            )
            OutlinedButton(
                onClick = {
                    if (!hasLocationPermission()) {
                        recommendState = NearbyRouteState.PermissionRequired
                        locationPermission.launch(
                            arrayOf(
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION,
                            ),
                        )
                    } else {
                        scope.launch { refreshRecommendations(force = true) }
                    }
                },
                enabled = recommendState !is NearbyRouteState.Locating,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(tr("Nearby routes")) }
            NearbyRecommendPanel(
                state = recommendState,
                onSelect = { row ->
                    NearbyRouteNavigation.select(row) { onSelectVariant(it) }
                },
            )
            if (allRows.isEmpty() && !RouteSyncUi.isBusy(routeSync)) {
                TextButton(onClick = onNeedSync) { Text(tr("Open Setup / Sync")) }
            }
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            items(visible, key = { it.variantPublicId }) { row ->
                RouteSelectionItem(
                    row = row,
                    workStatus = assignmentByVariant[row.variantPublicId],
                    finished = completionByVariant[row.variantPublicId],
                    onClick = { onSelectVariant(row) },
                )
            }
        }
    }
}

internal suspend fun runRecommend(
    bootstrap: BootstrapRepository,
    survey: SurveyController,
    nearbyRoutes: NearbyRouteRecommender,
): NearbyRouteState {
    val revision = bootstrap.snapshotRevision()
    val variants = bootstrap.variantCount()
    val snapshotOk = !revision.isNullOrBlank() && variants > 0
    if (!snapshotOk) {
        return NearbyRouteState.StalePackage
    }
    if (!survey.hasLocationPermission()) {
        val existing = NearbyRouteLocationPolicy.select(survey.state.value.location, survey.state.value.gps)
        if (existing == null) return NearbyRouteState.PermissionRequired
    }
    val fix = survey.locationForNearbyRecommend()
    val location = NearbyRouteLocationPolicy.select(survey.state.value.location, fix)
    val rows = if (location != null) nearbyRoutes.recommend(location.fix) else emptyList()
    return NearbyRouteFlow.afterSnapshotAndFix(
        hasUsableSnapshot = true,
        hasPermission = survey.hasLocationPermission() || location != null,
        location = location,
        recommendations = rows,
    )
}

@Composable
internal fun NearbyRecommendPanel(
    state: NearbyRouteState,
    onSelect: (RouteSelectionRow) -> Unit,
) {
    val message = NearbyRouteFlow.message(state)
    if (message != null) {
        Text(
            tr(message),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    if (state is NearbyRouteState.Recommendations) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            state.rows.take(NearbyRoutePolicy.MAX_RESULTS).forEach { row ->
                NearbyRecommendRow(row, onClick = { onSelect(row.selection) })
            }
        }
    }
}

@Composable
private fun NearbyRecommendRow(row: NearbyRouteRecommendation, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        Text(
            "${row.selection.routeCode} · ${row.selection.variantCode}",
            style = MaterialTheme.typography.titleSmall,
        )
        Text(
            "${row.nearestStopName} · ${NearbyRoutePolicy.formatDistance(row.stopDistanceM)}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun RouteSelectionItem(
    row: RouteSelectionRow,
    workStatus: String?,
    finished: Boolean?,
    onClick: () -> Unit,
) {
    val origin = row.originName ?: "—"
    val destination = row.destinationName ?: "—"
    val badge = SurveyAssignmentMapping.badge(workStatus)
        ?: SurveyVariantCompletionMapping.badge(finished)
    val badgePositive = workStatus == com.coremapmm.fieldsurveyor.data.LocalSurveyVariantAssignmentEntity.WORK_FINISHED ||
        (workStatus == null && finished == true)
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                ) {
                    Text(
                        row.routeCode,
                        style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                }
                Text(
                    row.variantCode,
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.weight(1f),
                )
                if (badge != null) {
                    StatusPill(
                        label = tr(badge),
                        positive = badgePositive,
                        warning = !badgePositive,
                    )
                }
            }
            Text(
                "$origin → $destination",
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                "${row.stopCount} ${tr("stops")}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
