package com.coremapmm.fieldsurveyor.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.coremapmm.fieldsurveyor.data.LocalReportEntity
import com.coremapmm.fieldsurveyor.data.LocalReportMediaEntity
import com.coremapmm.fieldsurveyor.data.LocalSurveySessionEntity
import com.coremapmm.fieldsurveyor.data.SurveyHistoryRow
import com.coremapmm.fieldsurveyor.data.SurveySessionRepository
import com.coremapmm.fieldsurveyor.outbox.OutboxReportSummary
import com.coremapmm.fieldsurveyor.ui.components.StatusPill
import com.coremapmm.fieldsurveyor.ui.media.OnDemandJpegPreview
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun SurveyHistoryScreen(repository: SurveySessionRepository, onBack: () -> Unit, onOpen: (String) -> Unit) {
    var visibleLimit by remember { mutableStateOf(HISTORY_PAGE_SIZE) }
    val rows by repository.historyPage(visibleLimit).collectAsStateWithLifecycle(initialValue = emptyList())
    SettingsPage(title = tr("Survey History"), onBack = onBack) {
        if (rows.isEmpty()) {
            Text(tr("No survey sessions yet."), modifier = Modifier.padding(24.dp))
        } else {
            LazyColumn(Modifier.fillMaxSize()) {
                items(rows, key = { it.clientSessionId }) { row ->
                    SurveyHistoryItem(row, onClick = { onOpen(row.clientSessionId) })
                    HorizontalDivider()
                }
                if (rows.size == visibleLimit && visibleLimit < HISTORY_MAX_VISIBLE) {
                    item {
                        Button(
                            onClick = { visibleLimit = (visibleLimit + HISTORY_PAGE_SIZE).coerceAtMost(HISTORY_MAX_VISIBLE) },
                            modifier = Modifier.fillMaxWidth().padding(20.dp),
                        ) { Text(tr("Load more")) }
                    }
                }
            }
        }
    }
}

private const val HISTORY_PAGE_SIZE = 50
private const val HISTORY_MAX_VISIBLE = 500

@Composable
fun SurveyHistoryDetailScreen(
    repository: SurveySessionRepository,
    sessionId: String,
    onBack: () -> Unit,
    onViewRoute: (LocalSurveySessionEntity) -> Unit,
) {
    val history by repository.historyRow(sessionId).collectAsStateWithLifecycle(initialValue = null)
    var session by remember(sessionId) { mutableStateOf<LocalSurveySessionEntity?>(null) }
    var reports by remember(sessionId) { mutableStateOf<List<HistoryReport>>(emptyList()) }
    LaunchedEffect(sessionId, history?.reportCount) {
        session = repository.session(sessionId)
        reports = repository.reports(sessionId).map { report ->
            HistoryReport(report, repository.media(report.clientPublicId))
        }
    }
    SettingsPage(title = tr("Survey History"), onBack = onBack) {
        val row = history
        if (row == null) {
            Text(tr("Survey session not found."), modifier = Modifier.padding(24.dp))
            return@SettingsPage
        }
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
            item {
                Column(
                    Modifier.fillMaxWidth().padding(vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("${row.routeCode} · ${row.variantCode}", style = MaterialTheme.typography.headlineSmall)
                    Text(listOfNotNull(row.originName, row.destinationName).joinToString(" → ").ifBlank { "—" })
                    Text("${tr("Duration")} · ${formatDuration(row)}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatusPill(tr(syncLabel(row.syncState)), positive = row.syncState == LocalSurveySessionEntity.SYNC_SYNCED)
                        Text("${row.reportCount} ${tr("reports")}", modifier = Modifier.align(Alignment.CenterVertically))
                    }
                    Button(
                        onClick = { session?.let(onViewRoute) },
                        enabled = session != null,
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text(tr("View route on map")) }
                    Text(tr("Reports"), style = MaterialTheme.typography.titleMedium)
                }
            }
            if (reports.isEmpty()) item { Text(tr("No reports in this survey."), modifier = Modifier.padding(vertical = 12.dp)) }
            items(reports, key = { it.report.clientPublicId }) { item ->
                val summary = OutboxReportSummary.from(item.report)
                var selected by remember(item.report.clientPublicId) { mutableStateOf(false) }
                Column(
                    Modifier.fillMaxWidth().padding(vertical = 12.dp).clickable { selected = !selected },
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(summary.title.ifBlank { tr("Report") }, style = MaterialTheme.typography.titleSmall)
                    Text(summary.stopLabel, style = MaterialTheme.typography.bodySmall)
                    Text("${tr("Sync state")} · ${tr(syncLabel(item.report.status))}", style = MaterialTheme.typography.labelMedium)
                    Text("${tr("Media")} · ${mediaLabel(item.media)}", style = MaterialTheme.typography.labelMedium)
                    if (selected) {
                        item.media.forEach { row ->
                            if (row.mimeType == LocalReportMediaEntity.MIME_JPEG) {
                                OnDemandJpegPreview(java.io.File(row.localPath), contentDescription = tr("Attached report photo"))
                            } else {
                                Text(tr("Voice · ${(row.durationMs ?: 0L) / 1_000}s"), style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
                HorizontalDivider()
            }
        }
    }
}

private data class HistoryReport(val report: LocalReportEntity, val media: List<LocalReportMediaEntity>)

@Composable
private fun SurveyHistoryItem(row: SurveyHistoryRow, onClick: () -> Unit) {
    Surface(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 20.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("${row.routeCode} · ${row.variantCode}", style = MaterialTheme.typography.titleMedium)
                val timeRange = row.endedAtEpochMs?.let {
                    "${formatTime(row.startedAtEpochMs)}–${formatTime(it)}"
                } ?: tr("Active")
                Text("${formatDate(row.startedAtEpochMs)} · $timeRange", style = MaterialTheme.typography.bodySmall)
                Text("${row.reportCount} ${tr("reports")}", style = MaterialTheme.typography.labelMedium)
            }
            StatusPill(tr(syncLabel(row.syncState)), positive = row.syncState == LocalSurveySessionEntity.SYNC_SYNCED)
        }
    }
}

private fun formatDate(epoch: Long): String = Instant.ofEpochMilli(epoch).atZone(ZoneId.systemDefault())
    .format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault()))

private fun formatTime(epoch: Long): String = Instant.ofEpochMilli(epoch).atZone(ZoneId.systemDefault())
    .format(DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault()))

private fun formatDuration(row: SurveyHistoryRow): String {
    val end = row.endedAtEpochMs ?: System.currentTimeMillis()
    val minutes = ((end - row.startedAtEpochMs).coerceAtLeast(0L) / 60_000L)
    return "${minutes / 60}h ${minutes % 60}m"
}

private fun syncLabel(value: String): String = when (value) {
    LocalSurveySessionEntity.SYNC_SYNCED, LocalReportEntity.STATUS_SYNCED -> "Synced"
    LocalSurveySessionEntity.SYNC_SYNCING, LocalReportEntity.STATUS_SYNCING -> "Uploading"
    LocalSurveySessionEntity.SYNC_RETRY, LocalReportEntity.STATUS_RETRY -> "Retry later"
    LocalSurveySessionEntity.SYNC_PERMANENT_ERROR, LocalReportEntity.STATUS_PERMANENT_ERROR -> "Needs fix"
    else -> "Waiting"
}

@Composable
private fun mediaLabel(rows: List<LocalReportMediaEntity>): String = when {
    rows.isEmpty() -> tr("No media")
    rows.all { it.syncState == LocalReportMediaEntity.STATE_SYNCED } -> "${rows.size} · ${tr("Synced")}"
    rows.any { it.syncState == LocalReportMediaEntity.STATE_SYNCING } -> "${rows.size} · ${tr("Uploading")}"
    else -> "${rows.size} · ${tr("Waiting")}"
}

@Preview(showBackground = true)
@Composable
private fun SurveyHistoryItemPreview() {
    SurveyHistoryItem(
        SurveyHistoryRow("id", "YBS-13", "D0", "Sule", "Hledan", 1_788_480_000_000, null, "ACTIVE", "LOCAL", 0),
        onClick = {},
    )
}
