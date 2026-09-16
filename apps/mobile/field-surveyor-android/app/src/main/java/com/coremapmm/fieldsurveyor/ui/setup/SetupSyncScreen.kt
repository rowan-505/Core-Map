package com.coremapmm.fieldsurveyor.ui.setup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.coremapmm.fieldsurveyor.data.transport.BootstrapRefreshPhase
import com.coremapmm.fieldsurveyor.data.transport.BootstrapRepository
import com.coremapmm.fieldsurveyor.data.transport.RouteSyncUi
import com.coremapmm.fieldsurveyor.data.transport.RouteSyncUiState
import com.coremapmm.fieldsurveyor.device.DeviceStatus
import com.coremapmm.fieldsurveyor.offline.OfflineMapPolicy
import com.coremapmm.fieldsurveyor.offline.YangonBasemapStore
import com.coremapmm.fieldsurveyor.offline.YangonMapManifestParser
import com.coremapmm.fieldsurveyor.ui.components.FieldCard
import com.coremapmm.fieldsurveyor.ui.components.ScreenHeader
import com.coremapmm.fieldsurveyor.ui.components.StatusPill
import com.coremapmm.fieldsurveyor.ui.routes.RouteSyncStatusRow
import com.coremapmm.fieldsurveyor.ui.settings.tr
import kotlinx.coroutines.launch
import java.util.Locale

@Composable
fun SetupSyncScreen(
    bootstrap: BootstrapRepository,
    yangon: YangonBasemapStore,
    title: String? = null,
    onContinue: (() -> Unit)? = null,
    onDisplaySettings: (() -> Unit)? = null,
    modifier: Modifier = Modifier.fillMaxSize(),
) {
    val context = LocalContext.current
    var routeSync by remember { mutableStateOf<RouteSyncUiState>(RouteSyncUiState.NotDownloaded) }
    var syncName by rememberSaveable { mutableStateOf(RouteSyncUi.persistenceName(RouteSyncUiState.NotDownloaded)) }
    var syncCount by rememberSaveable { mutableStateOf(0) }
    var syncRevision by rememberSaveable { mutableStateOf<String?>(null) }
    var mapBusy by remember { mutableStateOf(false) }
    var mapStatus by remember { mutableStateOf("") }
    var mapFailed by remember { mutableStateOf(false) }
    var yangonReady by remember { mutableStateOf(yangon.isReady()) }
    var downloadedBytes by remember { mutableLongStateOf(yangon.sizeBytes()) }
    var totalBytes by remember { mutableLongStateOf(yangon.sizeBytes()) }
    var expectedBytes by remember { mutableLongStateOf(0L) }
    var mapVersion by remember { mutableStateOf<String?>(null) }
    var remoteMapVersion by remember { mutableStateOf<String?>(null) }
    var mapNeedsUpdate by remember { mutableStateOf(false) }
    var showTechnical by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val continueLocked = RouteSyncUi.isBusy(routeSync) || mapBusy
    val visibleTitle = title ?: tr("Setup / Sync")

    fun persist(state: RouteSyncUiState) {
        routeSync = state
        syncName = RouteSyncUi.persistenceName(state)
        syncCount = state.variantCount
        syncRevision = state.revision
    }

    suspend fun runRefresh() {
        val online = DeviceStatus.isOnline(context)
        val previous = routeSync
        persist(RouteSyncUi.downloading(previous))
        val result = bootstrap.refresh { phase ->
            when (phase) {
                BootstrapRefreshPhase.FETCHING -> Unit
                BootstrapRefreshPhase.IMPORTING -> persist(RouteSyncUi.importing(routeSync))
            }
        }
        val count = bootstrap.variantCount()
        val revision = bootstrap.snapshotRevision()
        persist(
            RouteSyncUi.fromRefreshResult(
                result = result,
                online = online,
                fallbackCount = count,
                fallbackRevision = revision,
            ),
        )
    }

    suspend fun runYangonDownload(allowMetered: Boolean) {
        mapBusy = true
        mapFailed = false
        mapStatus = "Downloading Yangon streets map…"
        try {
            yangon.ensure(allowMetered = allowMetered) { copied, total ->
                scope.launch {
                    downloadedBytes = copied
                    totalBytes = total
                }
            }
            yangonReady = yangon.isReady()
            mapVersion = yangon.localVersion()
            downloadedBytes = yangon.sizeBytes()
            mapNeedsUpdate = yangonReady &&
                remoteMapVersion != null &&
                mapVersion != null &&
                mapVersion != remoteMapVersion
            mapStatus = when {
                yangonReady && mapNeedsUpdate -> "A newer Yangon map is available. Download anytime (uses data)."
                yangonReady -> "Yangon streets map is on this device."
                else -> "Yangon download finished but the file is incomplete."
            }
            mapFailed = !yangonReady
        } catch (error: Exception) {
            yangonReady = yangon.isReady()
            val message = error.message ?: error.toString()
            val cancelled = message == OfflineMapPolicy.CANCELLED_MESSAGE
            mapFailed = !cancelled
            mapStatus = if (cancelled) {
                message
            } else {
                "Map download failed"
            }
        } finally {
            mapBusy = false
        }
    }

    LaunchedEffect(Unit) {
        val online = DeviceStatus.isOnline(context)
        val count = bootstrap.variantCount()
        val revision = bootstrap.snapshotRevision()
        persist(RouteSyncUi.restore(syncName, count, revision, online).let { restored ->
            if (restored is RouteSyncUiState.Downloading || restored is RouteSyncUiState.Importing) {
                RouteSyncUi.initial(count, revision, online)
            } else {
                restored
            }
        })
        yangonReady = yangon.isReady()
        downloadedBytes = yangon.sizeBytes()
        totalBytes = yangon.sizeBytes()
        mapVersion = yangon.localVersion()
        try {
            val manifest = yangon.probeManifest()
            expectedBytes = manifest.byteSize
            remoteMapVersion = manifest.version
            val local = yangon.localVersion()
            mapVersion = local ?: manifest.version
            mapNeedsUpdate = yangonReady && local != null && local != manifest.version
            if (totalBytes <= 0L) {
                totalBytes = manifest.byteSize
            }
            mapStatus = when {
                mapNeedsUpdate -> "A newer Yangon map is available. Download anytime (uses data)."
                yangonReady -> "Yangon streets map is on this device."
                else -> "Street zoom needs the Yangon map (~120 MB). Works on mobile data."
            }
        } catch (_: Exception) {
            expectedBytes = YangonMapManifestParser.FALLBACK_BYTES
            remoteMapVersion = "v2"
            mapNeedsUpdate = yangonReady && mapVersion != null && mapVersion != remoteMapVersion
            mapStatus = when {
                mapNeedsUpdate -> "A newer Yangon map is available. Download anytime (uses data)."
                yangonReady -> "Yangon streets map is on this device."
                else -> "Street zoom needs the Yangon map (~120 MB). Works on mobile data."
            }
        }
        runRefresh()
    }

    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (visibleTitle.isNotBlank()) {
            ScreenHeader(
                title = visibleTitle,
                subtitle = tr("Prepare routes and the offline map before field work."),
            )
        }
        if (onDisplaySettings != null) {
            OutlinedButton(
                onClick = onDisplaySettings,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) {
                Text(tr("Language and appearance"))
            }
        }
        if (routeSync.variantCount > 0) {
            Text(
                tr("${routeSync.variantCount} route variants"),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.testTag("setup_variant_count"),
            )
        }
        FieldCard {
            RouteSyncStatusRow(
                state = routeSync,
                onTryAgain = { scope.launch { runRefresh() } },
            )
        }
        FieldCard {
            StatusPill(
                label = tr(
                    if (mapBusy) "Downloading map"
                    else if (mapNeedsUpdate) "Map update available"
                    else if (yangonReady) "Offline map ready"
                    else if (mapFailed) "Map download failed"
                    else "Map needed",
                ),
                positive = yangonReady && !mapBusy && !mapFailed && !mapNeedsUpdate,
                warning = (mapNeedsUpdate || !yangonReady) && !mapBusy && !mapFailed,
                blockingError = mapFailed && !mapBusy,
            )
            Text(tr(mapStatus), style = MaterialTheme.typography.bodyMedium)
            if (mapBusy && totalBytes > 0L) {
                LinearProgressIndicator(
                    progress = { (downloadedBytes.toFloat() / totalBytes.toFloat()).coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(formatBytes(downloadedBytes, totalBytes), style = MaterialTheme.typography.bodySmall)
            } else if (mapBusy) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }
            OutlinedButton(
                onClick = { scope.launch { runYangonDownload(allowMetered = true) } },
                enabled = !mapBusy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) {
                Text(
                    tr(
                        when {
                            mapBusy -> "Downloading map…"
                            mapNeedsUpdate -> "Update Yangon map"
                            yangonReady -> "Verify offline map"
                            else -> "Download Yangon map"
                        },
                    ),
                )
            }
            if (mapBusy) {
                OutlinedButton(
                    onClick = { yangon.cancelDownload() },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) {
                    Text(tr("Cancel download"))
                }
            }
        }
        TextButton(
            onClick = { showTechnical = !showTechnical },
            modifier = Modifier.heightIn(min = 48.dp).testTag("setup_technical_toggle"),
        ) {
            Text(tr(if (showTechnical) "Hide technical details" else "Technical details"))
        }
        if (showTechnical) {
            FieldCard {
                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.testTag("setup_technical_details"),
                ) {
                    Text(
                        tr("Routes on device: ${routeSync.variantCount}"),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    if (!routeSync.revision.isNullOrBlank()) {
                        Text(
                            tr("Data version: ${routeSync.revision}"),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    if (expectedBytes > 0L) {
                        Text(
                            tr("File size before download: ${formatMb(expectedBytes)}"),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    if (mapVersion != null) {
                        Text(
                            tr("Map version: $mapVersion"),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    if (downloadedBytes > 0L || totalBytes > 0L) {
                        Text(
                            formatBytes(downloadedBytes, totalBytes),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }
        if (onContinue != null) {
            Button(
                onClick = onContinue,
                enabled = !continueLocked && RouteSyncUi.hasUsableCache(routeSync) && yangonReady,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) {
                Text(tr("Continue to route selection"))
            }
        }
    }
}

private fun formatMb(bytes: Long): String {
    return String.format(Locale.US, "%.0f MB", bytes / 1_000_000.0)
}

private fun formatBytes(copied: Long, total: Long): String {
    fun mb(value: Long): String = String.format(Locale.US, "%.0f", value / 1_000_000.0)
    return if (total > 0L) {
        "${mb(copied)} / ${mb(total)} MB"
    } else {
        "${mb(copied)} MB"
    }
}
