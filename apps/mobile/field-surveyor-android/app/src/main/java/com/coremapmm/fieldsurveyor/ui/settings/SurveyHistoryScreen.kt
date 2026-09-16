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
import androidx.compose.material3.TextButton
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
import com.coremapmm.fieldsurveyor.data.LocalSurveyVariantCompletionDao
import com.coremapmm.fieldsurveyor.data.SurveyHistoryRow
import com.coremapmm.fieldsurveyor.data.SurveySessionRepository
import com.coremapmm.fieldsurveyor.outbox.OutboxReportSummary
import com.coremapmm.fieldsurveyor.survey.SurveySessionClassify
import com.coremapmm.fieldsurveyor.survey.SurveyVariantCompletionMapping
import com.coremapmm.fieldsurveyor.ui.components.StatusPill
import com.coremapmm.fieldsurveyor.ui.media.OnDemandJpegPreview
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
fun SurveyHistoryScreen(
    repository: SurveySessionRepository,
    completions: LocalSurveyVariantCompletionDao,
    onBack: () -> Unit,
    onOpen: (String) -> Unit,
) {
    var visibleLimit by remember { mutableStateOf(HISTORY_PAGE_SIZE) }
    val rows by repository.historyPage(visibleLimit).collectAsStateWithLifecycle(initialValue = emptyList())
    var finishedByVariant by remember { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var showShortEmpty by remember { mutableStateOf(false) }
    LaunchedEffect(rows) {
        finishedByVariant = withContext(Dispatchers.IO) {
            SurveyVariantCompletionMapping.finishedMap(
                completions.listAll().map { it.variantPublicId to it.isFinished },
            )
        }
    }
    val (meaningful, shortEmpty) = remember(rows) { SurveySessionClassify.partitionHistory(rows) }
    val visibleRows = if (showShortEmpty) meaningful + shortEmpty else meaningful
    SettingsPage(title = tr("Survey History"), onBack = onBack) {
        if (rows.isEmpty()) {
            Text(tr("No survey sessions yet."), modifier = Modifier.padding(24.dp))
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(visibleRows, key = { it.clientSessionId }) { row ->
                    SurveyHistoryItem(
                        row = row,
                        finished = finishedByVariant[row.variantPublicId],
                        onClick = { onOpen(row.clientSessionId) },
                    )
                    HorizontalDivider()
                }
                if (!showShortEmpty && shortEmpty.isNotEmpty()) {
                    item(key = "short-empty-toggle") {
                        TextButton(
                            onClick = { showShortEmpty = true },
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp, vertical = 4.dp),
                        ) {
                            Text(tr("${shortEmpty.size} short sessions hidden"))
                        }
                    }
                }
                if (showShortEmpty && shortEmpty.isNotEmpty()) {
                    item(key = "short-empty-hide") {
                        TextButton(
                            onClick = { showShortEmpty = false },
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp, vertical = 4.dp),
                        ) {
                            Text(tr("Hide short sessions"))
                        }
                    }
                }
                if (rows.size == visibleLimit && visibleLimit < HISTORY_MAX_VISIBLE) {
                    item {
                        Button(
                            onClick = { visibleLimit = (visibleLimit + HISTORY_PAGE_SIZE).coerceAtMost(HISTORY_MAX_VISIBLE) },
                            modifier = Modifier.fillMaxWidth().padding(20.dp),
                        ) {
                            Text(tr("Show more"))
                        }
                    }
                }
            }
        }
    }
}

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
                    Text(
                        "${tr("Duration")} · ${SurveySessionClassify.formatActiveDuration(row.accumulatedActiveSeconds)}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "${SurveySessionClassify.formatCheckedLabel(row.checkedStopCount, row.totalStopCount)} · ${tr(SurveySessionClassify.formatReportLabel(row.reportCount))}",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatusPill(tr(syncLabel(row.syncState)), positive = row.syncState == LocalSurveySessionEntity.SYNC_SYNCED)
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
                        item.media.forEach { mediaRow ->
                            if (mediaRow.mimeType == LocalReportMediaEntity.MIME_JPEG) {
                                OnDemandJpegPreview(java.io.File(mediaRow.localPath), contentDescription = tr("Attached report photo"))
                            } else {
                                Text(tr("Voice · ${(mediaRow.durationMs ?: 0L) / 1_000}s"), style = MaterialTheme.typography.bodySmall)
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
private fun SurveyHistoryItem(row: SurveyHistoryRow, finished: Boolean?, onClick: () -> Unit) {
    val badge = SurveyVariantCompletionMapping.badge(finished)
        ?: if (row.status.equals(LocalSurveySessionEntity.STATUS_ACTIVE, ignoreCase = true)) "Active" else "Partial"
    val timeRange = row.endedAtEpochMs?.let {
        "${formatTime(row.startedAtEpochMs)}–${formatTime(it)}"
    } ?: tr("Active")
    val duration = SurveySessionClassify.formatActiveDuration(row.accumulatedActiveSeconds)
    Surface(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 20.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("${row.routeCode} · ${row.variantCode}", style = MaterialTheme.typography.titleMedium)
                Text(
                    "${formatDateShort(row.startedAtEpochMs)} · $timeRange · $duration",
                    style = MaterialTheme.typography.bodySmall,
                )
                Text(
                    "${SurveySessionClassify.formatCheckedLabel(row.checkedStopCount, row.totalStopCount)} · ${tr(SurveySessionClassify.formatReportLabel(row.reportCount))}",
                    style = MaterialTheme.typography.labelMedium,
                )
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                StatusPill(tr(badge), positive = finished == true)
            }
        }
    }
}

private fun formatDate(epoch: Long): String = Instant.ofEpochMilli(epoch).atZone(ZoneId.systemDefault())
    .format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault()))

private fun formatDateShort(epoch: Long): String = Instant.ofEpochMilli(epoch).atZone(ZoneId.systemDefault())
    .format(DateTimeFormatter.ofPattern("d MMM", Locale.getDefault()))

private fun formatTime(epoch: Long): String = Instant.ofEpochMilli(epoch).atZone(ZoneId.systemDefault())
    .format(DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault()))

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
        row = SurveyHistoryRow(
            clientSessionId = "id",
            routeCode = "YBS-13",
            variantCode = "D0",
            variantPublicId = "variant-d0",
            originName = "Sule",
            destinationName = "Hledan",
            startedAtEpochMs = 1_788_480_000_000,
            endedAtEpochMs = 1_788_480_060_000,
            status = "COMPLETED",
            syncState = "LOCAL",
            reportCount = 1,
            accumulatedActiveSeconds = 60,
            checkedStopCount = 0,
            totalStopCount = 114,
        ),
        finished = false,
        onClick = {},
    )
}

private const val HISTORY_PAGE_SIZE = 50
private const val HISTORY_MAX_VISIBLE = 500
