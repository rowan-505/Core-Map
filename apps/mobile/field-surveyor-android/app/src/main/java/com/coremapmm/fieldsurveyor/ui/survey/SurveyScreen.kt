package com.coremapmm.fieldsurveyor.ui.survey

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.coremapmm.fieldsurveyor.device.DeviceStatus
import com.coremapmm.fieldsurveyor.data.transport.OppositeVariantLookup
import com.coremapmm.fieldsurveyor.media.JpegTarget
import com.coremapmm.fieldsurveyor.media.VoiceRecorder
import com.coremapmm.fieldsurveyor.media.VoiceTarget
import com.coremapmm.fieldsurveyor.survey.*
import com.coremapmm.fieldsurveyor.ui.components.StatusPill
import com.coremapmm.fieldsurveyor.ui.media.OnDemandJpegPreview
import com.coremapmm.fieldsurveyor.ui.settings.tr
import java.io.File
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SurveyScreen(survey: SurveyController) {
    val state by survey.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val window = StopContext.window(state.stops, state.selection?.selectedStopPublicId)
    val permissionAction = remember { mutableStateOf("map") }
    var pendingKindName by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingKind by remember { mutableStateOf<AnomalyKind?>(pendingKindName?.let { runCatching { AnomalyKind.valueOf(it) }.getOrNull() }) }
    var note by rememberSaveable { mutableStateOf("") }
    var routeIssueName by rememberSaveable { mutableStateOf<String?>(null) }
    var routeIssue by remember { mutableStateOf(routeIssueName?.let { runCatching { RouteIssueKind.valueOf(it) }.getOrNull() }) }
    var proposedStopName by rememberSaveable { mutableStateOf("") }
    var newStopClientId by rememberSaveable { mutableStateOf("") }
    var newStopPickModeName by rememberSaveable { mutableStateOf(NewStopPickMode.NONE.name) }
    var newStopSourceName by rememberSaveable { mutableStateOf<String?>(null) }
    var proposedLat by rememberSaveable { mutableStateOf(Double.NaN) }
    var proposedLng by rememberSaveable { mutableStateOf(Double.NaN) }
    var proposedAccuracy by rememberSaveable { mutableStateOf(Float.NaN) }
    var proposedEpochMs by rememberSaveable { mutableStateOf(0L) }
    var mapPick by remember { mutableStateOf<GpsFix?>(null) }
    var showCamera by remember { mutableStateOf(false) }
    var recording by remember { mutableStateOf(false) }
    var recordStartedAt by remember { mutableLongStateOf(0L) }
    var voiceDraft by remember { mutableStateOf<File?>(null) }
    var voiceDraftDuration by remember { mutableLongStateOf(0L) }
    val photoDrafts = remember { mutableStateListOf<File>() }
    var draftStopId by remember { mutableStateOf<String?>(null) }
    var pendingStopId by remember { mutableStateOf<String?>(null) }
    var confirmPoorGpsReport by remember { mutableStateOf(false) }
    var confirmDirectionSwitch by remember { mutableStateOf(false) }
    var sheetStage by remember { mutableStateOf(SurveySheetStage.MAP) }
    var nowEpochMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val recorder = remember { VoiceRecorder(context) }
    val voiceDraftForCleanup by rememberUpdatedState(voiceDraft)

    fun setPendingKind(kind: AnomalyKind?) {
        pendingKind = kind
        pendingKindName = kind?.name
    }

    fun setRouteIssue(issue: RouteIssueKind?) {
        routeIssue = issue
        routeIssueName = issue?.name
    }

    fun newStopDraft(): NewStopDraft {
        val proposed = if (!proposedLat.isNaN() && !proposedLng.isNaN()) {
            GpsFix(
                proposedLat,
                proposedLng,
                proposedAccuracy.takeUnless { it.isNaN() },
                proposedEpochMs,
            )
        } else {
            mapPick
        }
        return NewStopDraft(
            clientPublicId = newStopClientId,
            name = proposedStopName,
            note = note,
            pickMode = runCatching { NewStopPickMode.valueOf(newStopPickModeName) }.getOrDefault(NewStopPickMode.NONE),
            proposed = proposed,
            locationSource = newStopSourceName?.let { runCatching { NewStopLocationSource.valueOf(it) }.getOrNull() },
        )
    }

    fun applyNewStopDraft(draft: NewStopDraft) {
        newStopClientId = draft.clientPublicId
        proposedStopName = draft.name
        note = draft.note
        newStopPickModeName = draft.pickMode.name
        newStopSourceName = draft.locationSource?.name
        val proposed = draft.proposed
        if (proposed == null) {
            proposedLat = Double.NaN
            proposedLng = Double.NaN
            proposedAccuracy = Float.NaN
            proposedEpochMs = 0L
            mapPick = null
        } else {
            proposedLat = proposed.lat
            proposedLng = proposed.lng
            proposedAccuracy = proposed.accuracyM ?: Float.NaN
            proposedEpochMs = proposed.epochMs
            mapPick = proposed
        }
    }

    LaunchedEffect(Unit) {
        if (!proposedLat.isNaN() && !proposedLng.isNaN() && mapPick == null) {
            mapPick = GpsFix(proposedLat, proposedLng, null, proposedEpochMs)
        }
    }

    val locationPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        val allowed = granted[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            granted[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (allowed) {
            when (permissionAction.value) {
                "survey" -> survey.startSurvey()
                "locate" -> survey.locate()
                else -> survey.startupLocation()
            }
        }
    }
    val cameraPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) showCamera = true else survey.setMessage("Camera permission is needed for photos.")
    }
    val micPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> if (!granted) survey.setMessage("Microphone permission is needed for voice.") }

    fun hasPermission(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    fun withLocationPermission(action: String, block: () -> Unit) {
        val allowed = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) ||
            hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
        val needsNotifications = action == "survey" &&
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            !hasPermission(Manifest.permission.POST_NOTIFICATIONS)
        if (allowed && !needsNotifications) block() else {
            permissionAction.value = action
            locationPermission.launch(
                buildList {
                    add(Manifest.permission.ACCESS_FINE_LOCATION)
                    add(Manifest.permission.ACCESS_COARSE_LOCATION)
                    if (needsNotifications) add(Manifest.permission.POST_NOTIFICATIONS)
                }.toTypedArray(),
            )
        }
    }

    fun clearMediaDrafts() {
        photoDrafts.forEach { it.delete() }
        photoDrafts.clear()
        voiceDraft?.delete()
        voiceDraft = null
        voiceDraftDuration = 0L
        draftStopId = null
    }

    fun resetDraft() {
        clearMediaDrafts()
        setPendingKind(null)
        note = ""
        setRouteIssue(null)
        proposedStopName = ""
        newStopClientId = ""
        newStopPickModeName = NewStopPickMode.NONE.name
        newStopSourceName = null
        proposedLat = Double.NaN
        proposedLng = Double.NaN
        proposedAccuracy = Float.NaN
        proposedEpochMs = 0L
        mapPick = null
    }

    fun submitPendingReport() {
        val kind = pendingKind ?: return
        val draft = newStopDraft()
        scope.launch {
            val saved = survey.submitReport(
                kind = kind,
                note = if (kind == AnomalyKind.NEW_STOP) draft.note else note,
                reportLocation = when (kind) {
                    AnomalyKind.MOVED -> mapPick
                    AnomalyKind.NEW_STOP -> draft.proposed
                    else -> null
                },
                routeIssue = if (kind == AnomalyKind.ROUTE) routeIssue else null,
                proposedStopName = if (kind == AnomalyKind.NEW_STOP) draft.name else "",
                photoDrafts = photoDrafts.toList(),
                voiceDraft = voiceDraft,
                voiceDurationMs = voiceDraftDuration,
                clientPublicId = if (kind == AnomalyKind.NEW_STOP) draft.clientPublicId else null,
                locationSource = if (kind == AnomalyKind.NEW_STOP) NewStopReportFlow.locationSourceCode(draft.locationSource) else null,
                online = DeviceStatus.isOnline(context),
            )
            if (saved) {
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                resetDraft()
                sheetStage = SurveySheetStage.STOPS
            }
        }
    }

    fun selectStop(stopId: String) {
        val changing = stopId != state.selection?.selectedStopPublicId
        if (changing && draftStopId != null && (photoDrafts.isNotEmpty() || voiceDraft != null)) {
            pendingStopId = stopId
            return
        }
        if (changing) resetDraft()
        survey.selectStop(stopId)
        sheetStage = SurveySheetStage.STOPS
    }

    DisposableEffect(Unit) {
        onDispose {
            recorder.cancel()
            photoDrafts.forEach { it.delete() }
            voiceDraftForCleanup?.delete()
            survey.releaseMapGps()
        }
    }
    LaunchedEffect(Unit) {
        survey.loadCachedVariant()
        withLocationPermission("startup") { survey.startupLocation() }
    }
    LaunchedEffect(state.capturedBanner) {
        if (state.capturedBanner != null) {
            delay(1_400)
            survey.clearBanner()
        }
    }
    LaunchedEffect(Unit) {
        while (true) {
            nowEpochMs = System.currentTimeMillis()
            survey.onLocationTick()
            delay(1_000)
        }
    }

    val location = state.location
    val visibleNearbyStops = state.nearbyStops

    Box(Modifier.fillMaxSize()) {
        SurveyMap(
            variantPublicId = state.selection?.variantPublicId,
            pathCoordinates = state.pathCoordinates,
            stops = state.stops,
            selectedStopPublicId = state.selection?.selectedStopPublicId,
            nearbyStopPublicIds = visibleNearbyStops.map { it.stop.stopPublicId }.toSet(),
            gps = location.displayFix,
            cameraFollowEnabled = state.cameraFollowEnabled,
            centerOncePending = state.centerOncePending,
            anomalies = state.anomalies,
            pickMovedGeom = (pendingKind == AnomalyKind.MOVED && mapPick == null) ||
                (pendingKind == AnomalyKind.NEW_STOP && NewStopReportFlow.isPickMode(newStopDraft())),
            pickedPoint = if (pendingKind == AnomalyKind.NEW_STOP) newStopDraft().proposed else mapPick,
            sheetVisibleFraction = sheetStage.visibleFraction,
            onStopClick = ::selectStop,
            onMapPick = { lat, lng ->
                if (pendingKind == AnomalyKind.NEW_STOP) {
                    applyNewStopDraft(NewStopReportFlow.onMapTap(newStopDraft(), lat, lng, System.currentTimeMillis()))
                    sheetStage = SurveySheetStage.FULL
                } else {
                    mapPick = GpsFix(lat, lng, null, System.currentTimeMillis())
                    sheetStage = SurveySheetStage.FULL
                }
            },
            onManualPan = survey::manualMapPan,
            onCenterOnceConsumed = survey::cameraCentered,
            onLocate = { withLocationPermission("locate") { survey.locate() } },
            modifier = Modifier.fillMaxSize(),
        )
        FourStageSurveySheet(
            stage = sheetStage,
            onStageChange = { sheetStage = it },
            modifier = Modifier.fillMaxSize(),
            header = { dragModifier ->
                Column(
                    dragModifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                    verticalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Box(
                        Modifier.align(Alignment.CenterHorizontally).size(width = 40.dp, height = 4.dp)
                            .background(MaterialTheme.colorScheme.onSurfaceVariant, RoundedCornerShape(100.dp)),
                    )
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        val title = state.selection?.let { "${it.routeCode} · ${it.variantCode}" }
                            ?: tr("Select a D0/D1 variant")
                        Text(
                            title,
                            style = MaterialTheme.typography.titleMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (state.selection != null) {
                            OutlinedButton(
                                onClick = {
                                    when (survey.requestDirectionSwitch()) {
                                        DirectionSwitchAction.SWITCH_NOW -> survey.switchToOppositeDirection()
                                        DirectionSwitchAction.CONFIRM_AND_SWITCH -> confirmDirectionSwitch = true
                                        DirectionSwitchAction.DISABLED -> Unit
                                    }
                                },
                                enabled = state.directionSwitchEnabled,
                                modifier = Modifier.heightIn(min = 48.dp),
                                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 0.dp),
                            ) {
                                Text(
                                    DirectionSwitchPolicy.buttonLabel(state.oppositeVariantCode),
                                    style = MaterialTheme.typography.labelMedium,
                                )
                            }
                        }
                    }
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(7.dp),
                    ) {
                        StatusPill(
                            tr(location.chipLabel),
                            positive = location.status == SurveyLocationStatus.Live,
                            warning = location.status != SurveyLocationStatus.Live,
                        )
                        Spacer(Modifier.weight(1f))
                        Button(
                            onClick = {
                                if (state.running) survey.endSurvey()
                                else withLocationPermission("survey") { survey.startSurvey() }
                            },
                                modifier = Modifier.height(34.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (state.running) MaterialTheme.colorScheme.error
                                else MaterialTheme.colorScheme.primary,
                            ),
                        ) { Text(tr(if (state.running) "Finish" else "Start"), style = MaterialTheme.typography.labelMedium) }
                    }
                    if (state.selection != null && !state.directionSwitchEnabled) {
                        Text(
                            tr(OppositeVariantLookup.MISSING_COUNTERPART_MESSAGE),
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                    location.banner?.let { gpsBanner ->
                        Text(
                            tr(gpsBanner),
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                    if (state.running || state.sessionReportCount > 0 || state.pendingSyncCount > 0) {
                        Text(
                            tr("${state.sessionReportCount} reports · ${state.pendingSyncCount} pending"),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    state.duplicateWarning?.let {
                        SurveyNotice(tr(it), warning = true)
                    }
                    state.message?.takeIf {
                        it.isNotBlank() &&
                            it != location.banner &&
                            it != SurveyLocationLabels.TEMPORARILY_UNAVAILABLE
                    }?.let {
                        SurveyNotice(tr(it), warning = false)
                    }
                }
            },
            content = { visibleStage ->
                val scrolling = if (visibleStage == SurveySheetStage.FULL) {
                    Modifier.verticalScroll(rememberScrollState())
                } else Modifier
                Column(
                    scrolling
                        .fillMaxWidth()
                        .padding(
                            horizontal = 14.dp,
                            vertical = if (visibleStage == SurveySheetStage.MAP) 0.dp else 6.dp,
                        ),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (visibleStage.ordinal >= SurveySheetStage.STOPS.ordinal) {
                        SurveySection("${tr("Route stops")} · ${StopProgress.label(state.stops, state.selection?.selectedStopPublicId)}") {
                            StopWindowRow(
                                window = window,
                                sequences = state.stops.map { it.stopSequence },
                                onSelect = ::selectStop,
                            )
                            FilledTonalButton(
                                onClick = {
                                    if (survey.markStopCorrect()) {
                                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                        resetDraft()
                                    }
                                },
                                enabled = state.running && window.current != null,
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                            ) { Text(tr("Stop is correct")) }
                            OutlinedButton(
                                onClick = {
                                    when {
                                        !state.running -> survey.setMessage("Start the survey first.")
                                        window.current == null -> survey.setMessage("Select a stop first.")
                                        else -> {
                                            clearMediaDrafts()
                                            setRouteIssue(null)
                                            setPendingKind(AnomalyKind.NEW_STOP)
                                            applyNewStopDraft(
                                                NewStopReportFlow.newDraft(
                                                    NewStopReportFlow.reuseDraftUuid(newStopClientId.ifBlank { null }),
                                                ),
                                            )
                                            survey.setMessage("")
                                            survey.refreshDuplicateWarning(AnomalyKind.NEW_STOP)
                                            sheetStage = SurveySheetStage.FULL
                                        }
                                    }
                                },
                                enabled = state.running && window.current != null,
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                            ) { Text(tr("Report new stop")) }
                            state.endOfRouteNotice?.let {
                                Text(
                                    tr(it),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                    if (visibleStage.ordinal >= SurveySheetStage.STOPS.ordinal) {
                        SurveySection(tr("Nearest stops")) {
                            if (visibleNearbyStops.isEmpty()) {
                                Text(
                                    tr("No selected-route stop is close enough. Check GPS or select a stop manually."),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            } else {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    visibleNearbyStops.forEachIndexed { index, nearby ->
                                        NearbyStopButton(
                                            nearby,
                                            nearby.stop.stopPublicId == state.selection?.selectedStopPublicId,
                                            index == 0,
                                            state.stops.map { it.stopSequence },
                                            Modifier.weight(1f),
                                        ) { selectStop(nearby.stop.stopPublicId) }
                                    }
                                }
                            }
                        }
                    }
                    if (visibleStage == SurveySheetStage.FULL) {
                        SurveySection(tr("Report issue")) {
                            FlowRow(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalArrangement = Arrangement.spacedBy(3.dp),
                            ) {
                                AnomalyMapping.reportIssueKinds().forEach { kind ->
                                    val selected = pendingKind == kind
                                    FilterChip(
                                        selected = selected,
                                        onClick = {
                                            when {
                                                !state.running -> survey.setMessage("Start the survey first.")
                                                SurveyReportFlow.requiresStop(kind) &&
                                                    state.selection?.selectedStopPublicId == null ->
                                                    survey.setMessage("Select a stop first.")
                                                selected -> {
                                                    resetDraft()
                                                    survey.setMessage("")
                                                }
                                                else -> {
                                                    clearMediaDrafts()
                                                    setPendingKind(kind)
                                                    note = ""
                                                    setRouteIssue(null)
                                                    proposedStopName = ""
                                                    applyNewStopDraft(NewStopReportFlow.newDraft())
                                                    mapPick = null
                                                    survey.setMessage("")
                                                    survey.refreshDuplicateWarning(kind)
                                                    if (kind == AnomalyKind.MOVED) sheetStage = SurveySheetStage.MAP
                                                }
                                            }
                                        },
                                        colors = FilterChipDefaults.filterChipColors(
                                            selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                                            selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                                        ),
                                        label = { Text(tr(kind.name), style = MaterialTheme.typography.labelSmall) },
                                    )
                                }
                            }
                        }
                        pendingKind?.let { kind ->
                            SurveySection(tr("Report details")) {
                                CaptureFacts(
                                    epochMs = nowEpochMs,
                                    gps = location.displayFix,
                                    routeCode = state.selection?.routeCode,
                                    variantCode = state.selection?.variantCode,
                                    snapshotRevision = state.snapshotRevision,
                                )
                                ReportKindForm(
                                    kind,
                                    note,
                                    { note = it },
                                    routeIssue,
                                    { setRouteIssue(it) },
                                    mapPick,
                                    proposedStopName,
                                    { proposedStopName = it },
                                    newStopDraft(),
                                    onNewStopDraft = { applyNewStopDraft(it) },
                                    gps = location.displayFix ?: location.evidenceFix,
                                    previousStop = window.current,
                                    nextStop = window.next,
                                    sequences = state.stops.map { it.stopSequence },
                                    onChooseOnMap = {
                                        applyNewStopDraft(NewStopReportFlow.chooseAgain(newStopDraft()))
                                        sheetStage = SurveySheetStage.MAP
                                    },
                                )
                            }
                        }
                        SurveySection(tr("Evidence (optional)")) {
                            EvidenceSection(
                                hasReportContext = pendingKind != null &&
                                    (!SurveyReportFlow.requiresStop(pendingKind!!) ||
                                        state.selection?.selectedStopPublicId != null),
                                photoDrafts = photoDrafts,
                                voiceDraft = voiceDraft,
                                voiceDraftDurationMs = voiceDraftDuration,
                                recording = recording,
                                onCamera = {
                                    if (hasPermission(Manifest.permission.CAMERA)) showCamera = true
                                    else cameraPermission.launch(Manifest.permission.CAMERA)
                                },
                                onRecordStart = {
                                    if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
                                        micPermission.launch(Manifest.permission.RECORD_AUDIO)
                                    } else {
                                        val dest = File(context.cacheDir, "field-voice-${System.currentTimeMillis()}.m4a")
                                        runCatching {
                                            recorder.start(dest)
                                            recordStartedAt = System.currentTimeMillis()
                                            recording = true
                                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                        }.onFailure { error -> survey.setMessage(error.message ?: "Could not start recording") }
                                    }
                                },
                                onRecordEnd = { cancelled ->
                                    if (recording) {
                                        recording = false
                                        val duration = System.currentTimeMillis() - recordStartedAt
                                        if (cancelled) recorder.cancel() else runCatching { recorder.stop() }
                                            .onSuccess { file ->
                                                if (duration < VoiceTarget.MIN_DURATION_MS) {
                                                    file.delete()
                                                    survey.setMessage("Hold longer to record.")
                                                } else {
                                                    voiceDraft?.delete()
                                                    voiceDraft = file
                                                    voiceDraftDuration = duration.coerceAtMost(VoiceTarget.MAX_DURATION_MS.toLong())
                                                    draftStopId = state.selection?.selectedStopPublicId
                                                }
                                            }.onFailure { error -> survey.setMessage(error.message ?: "Could not save voice") }
                                    }
                                },
                                onRemovePhoto = { file -> photoDrafts.remove(file); file.delete() },
                                onDiscardVoice = {
                                    voiceDraft?.delete()
                                    voiceDraft = null
                                    voiceDraftDuration = 0L
                                },
                            )
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = ::resetDraft, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                                Text(tr("Cancel"))
                            }
                            Button(
                                onClick = {
                                    val kind = pendingKind ?: return@Button
                                    if (kind != AnomalyKind.NEW_STOP &&
                                        ReportLocationPolicy.requiresPoorAccuracyConfirmation(kind, state.gps, nowEpochMs)
                                    ) {
                                        confirmPoorGpsReport = true
                                    } else submitPendingReport()
                                },
                                enabled = if (pendingKind == AnomalyKind.NEW_STOP) {
                                    NewStopReportFlow.canSave(state.running, window.current, newStopDraft())
                                } else {
                                    pendingKind != null
                                },
                                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                            ) { Text(tr("Report")) }
                        }
                        state.capturedBanner?.let {
                            Text(tr(it), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
                        }
                        Spacer(Modifier.height(16.dp))
                    }
                }
            },
        )
        if (showCamera) CameraCaptureOverlay(
            onCaptured = { file ->
                showCamera = false
                photoDrafts.add(file)
                draftStopId = state.selection?.selectedStopPublicId
            },
            onClose = { showCamera = false },
            onError = { message -> showCamera = false; survey.setMessage(message) },
        )
    }
    pendingStopId?.let { stopId ->
        AlertDialog(
            onDismissRequest = { pendingStopId = null },
            title = { Text(tr("Discard draft media?")) },
            text = { Text(tr("Changing stops removes the unsent photo or recording.")) },
            confirmButton = {
                TextButton(onClick = {
                    pendingStopId = null
                    resetDraft()
                    survey.selectStop(stopId)
                    sheetStage = SurveySheetStage.STOPS
                }) { Text(tr("Discard")) }
            },
            dismissButton = { TextButton(onClick = { pendingStopId = null }) { Text(tr("Keep editing")) } },
        )
    }
    if (confirmPoorGpsReport) {
        AlertDialog(
            onDismissRequest = { confirmPoorGpsReport = false },
            title = { Text(tr("Poor GPS accuracy")) },
            text = { Text(tr("This location may be more than 50 m off. Submit this location-critical report anyway?")) },
            confirmButton = {
                TextButton(onClick = {
                    confirmPoorGpsReport = false
                    submitPendingReport()
                }) { Text(tr("Submit anyway")) }
            },
            dismissButton = {
                TextButton(onClick = { confirmPoorGpsReport = false }) { Text(tr("Wait for GPS")) }
            },
        )
    }
    if (confirmDirectionSwitch) {
        AlertDialog(
            onDismissRequest = { confirmDirectionSwitch = false },
            title = { Text(tr("Switch direction?")) },
            text = { Text(tr("Finish current direction and start the opposite direction?")) },
            confirmButton = {
                TextButton(onClick = {
                    confirmDirectionSwitch = false
                    survey.switchToOppositeDirection()
                }) { Text(tr("Switch")) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDirectionSwitch = false }) { Text(tr("Keep this direction")) }
            },
        )
    }
}

@Composable
private fun NearbyStopButton(
    nearby: NearbyStop,
    selected: Boolean,
    nearest: Boolean,
    sequences: List<Int>,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val colors = when {
        selected -> ButtonDefaults.outlinedButtonColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        )
        nearest -> ButtonDefaults.outlinedButtonColors(
            containerColor = MaterialTheme.colorScheme.tertiaryContainer,
            contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
        )
        else -> ButtonDefaults.outlinedButtonColors()
    }
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.heightIn(min = 82.dp),
        colors = colors,
        shape = RoundedCornerShape(14.dp),
        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 7.dp),
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                "${StopSequenceDisplay.uiLabel(nearby.stop.stopSequence, sequences)} · ${formatDistance(nearby.distanceM)}",
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
            )
            Text(
                stopDisplayName(nearby.stop),
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun EvidenceSection(
    hasReportContext: Boolean,
    photoDrafts: List<File>,
    recording: Boolean,
    voiceDraft: File?,
    voiceDraftDurationMs: Long,
    onCamera: () -> Unit,
    onRecordStart: () -> Unit,
    onRecordEnd: (Boolean) -> Unit,
    onDiscardVoice: () -> Unit,
    onRemovePhoto: (File) -> Unit,
) {
    if (!hasReportContext) {
        Text(tr("Choose a report action first. Photo, voice and text are optional."), style = MaterialTheme.typography.bodySmall)
        return
    }
    photoDrafts.forEach { PhotoDraftAttachment(it, onRemovePhoto) }
    voiceDraft?.let { VoiceDraft(it, voiceDraftDurationMs, onDiscardVoice) }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(
            onClick = onCamera,
            enabled = photoDrafts.size < JpegTarget.MAX_PHOTOS_PER_REPORT,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
        ) {
            Text(tr(if (photoDrafts.isEmpty()) "Photo" else "Add photo"), style = MaterialTheme.typography.labelMedium)
        }
        if (voiceDraft == null) {
            HoldToRecordButton(recording, onRecordStart, onRecordEnd, Modifier.weight(1f))
        }
    }
}

@Composable
private fun PhotoDraftAttachment(file: File, onRemove: (File) -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(tr("Photo ready"))
            OnDemandJpegPreview(file, contentDescription = tr("Attached report photo"))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(tr("Optional photo. Full file uploads later."), modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { onRemove(file) }) { Text(tr("Remove")) }
            }
        }
    }
}

@Composable
private fun VoiceDraft(file: File, durationMs: Long, onDiscard: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(tr("Voice · ${durationMs / 1_000}s"), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
            AudioButton(file)
            TextButton(onClick = onDiscard) { Text(tr("Retake")) }
        }
    }
}

@Composable
private fun AudioButton(file: File, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var playing by remember(file.absolutePath) { mutableStateOf(false) }
    val player = remember(file.absolutePath) {
        runCatching { MediaPlayer.create(context, Uri.fromFile(file)) }.getOrNull()
    }
    DisposableEffect(player) {
        player?.setOnCompletionListener { playing = false }
        onDispose { player?.release() }
    }
    OutlinedButton(
        onClick = {
            if (player != null) {
                if (playing) player.pause() else player.start()
                playing = !playing
            }
        },
        enabled = player != null,
        modifier = modifier,
    ) { Text(tr(if (playing) "Pause" else "Play")) }
}

@Composable
private fun ReportKindForm(
    kind: AnomalyKind,
    note: String,
    onNote: (String) -> Unit,
    routeIssue: RouteIssueKind?,
    onRouteIssue: (RouteIssueKind) -> Unit,
    mapPick: GpsFix?,
    proposedStopName: String,
    onProposedStopName: (String) -> Unit,
    newStopDraft: NewStopDraft,
    onNewStopDraft: (NewStopDraft) -> Unit,
    gps: GpsFix?,
    previousStop: com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow?,
    nextStop: com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow?,
    sequences: List<Int>,
    onChooseOnMap: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        when (kind) {
            AnomalyKind.MOVED -> {
                Text(tr(if (mapPick == null) "Tap the correct stop position on the map." else "New position selected."))
                OptionalNote(note, onNote)
            }
            AnomalyKind.MISSING -> OptionalNote(note, onNote)
            AnomalyKind.NEW_STOP -> NewStopForm(
                draft = newStopDraft,
                onDraft = onNewStopDraft,
                gps = gps,
                previousStop = previousStop,
                nextStop = nextStop,
                sequences = sequences,
                onChooseOnMap = onChooseOnMap,
            )
            AnomalyKind.DATA -> OptionalNote(note, onNote)
            AnomalyKind.ROUTE -> {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RouteIssueKind.entries.forEach { issue ->
                        val selected = routeIssue == issue
                        OutlinedButton(
                            onClick = { onRouteIssue(issue) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                            contentPadding = PaddingValues(4.dp),
                            colors = if (selected) ButtonDefaults.outlinedButtonColors(
                                containerColor = MaterialTheme.colorScheme.secondaryContainer,
                                contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                            ) else ButtonDefaults.outlinedButtonColors(),
                        ) {
                            Text(tr(when (issue) {
                                RouteIssueKind.PATH_WRONG -> "Path"
                                RouteIssueKind.MISSING_SEGMENT -> "Gap"
                                RouteIssueKind.OTHER -> "Other"
                            }))
                        }
                    }
                }
                OptionalNote(note, onNote)
            }
            AnomalyKind.OTHER -> OptionalNote(note, onNote)
        }
    }
}

@Composable
internal fun NewStopForm(
    draft: NewStopDraft,
    onDraft: (NewStopDraft) -> Unit,
    gps: GpsFix?,
    previousStop: com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow?,
    nextStop: com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow?,
    sequences: List<Int>,
    onChooseOnMap: () -> Unit,
) {
    val previousLabel = previousStop?.let {
        "${StopSequenceDisplay.uiLabel(it.stopSequence, sequences)} ${it.nameEn ?: it.nameMy ?: it.stopPublicId}"
    } ?: tr("Select a stop first.")
    val nextLabel = nextStop?.let {
        "${StopSequenceDisplay.uiLabel(it.stopSequence, sequences)} ${it.nameEn ?: it.nameMy ?: it.stopPublicId}"
    } ?: "—"
    Text(tr("Previous stop") + ": $previousLabel", style = MaterialTheme.typography.bodySmall)
    Text(tr("Next stop") + ": $nextLabel", style = MaterialTheme.typography.bodySmall)
    OutlinedTextField(
        draft.name,
        { onDraft(NewStopReportFlow.withName(draft, it)) },
        label = { Text(tr("Proposed stop name")) },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
    )
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(
            onClick = { onDraft(NewStopReportFlow.useMyLocation(draft, gps)) },
            enabled = gps != null,
            modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("newStopUseMyLocation"),
        ) { Text(tr("Use my location")) }
        OutlinedButton(
            onClick = onChooseOnMap,
            modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("newStopChooseOnMap"),
        ) { Text(tr("Choose on map")) }
    }
    if (draft.pickMode == NewStopPickMode.PICKING) {
        Text(tr("Tap the map once to place the new stop."))
    }
    draft.proposed?.let { proposed ->
        Text(
            tr("Proposed location") + ": " +
                String.format(Locale.US, "%.5f, %.5f", proposed.lat, proposed.lng),
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            tr(if (draft.locationSource == NewStopLocationSource.GPS) "Using GPS" else "Location from map"),
            style = MaterialTheme.typography.labelSmall,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(
                onClick = { onDraft(NewStopReportFlow.removeGeometry(draft)) },
                modifier = Modifier.testTag("newStopRemove"),
            ) { Text(tr("Remove")) }
            TextButton(
                onClick = onChooseOnMap,
                modifier = Modifier.testTag("newStopChooseAgain"),
            ) { Text(tr("Choose again")) }
        }
    }
    OptionalNote(draft.note) { onDraft(draft.copy(note = it.take(4000))) }
}

@Composable
private fun OptionalNote(note: String, onNote: (String) -> Unit) = NoteField(note, onNote, "Note (optional)")

@Composable
private fun NoteField(note: String, onNote: (String) -> Unit, label: String) {
    OutlinedTextField(
        note, onNote, label = { Text(tr(label)) }, modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 3,
    )
}

internal fun formatDistance(distanceM: Double): String = when {
    distanceM < 1_000 -> "${distanceM.toInt()} m"
    distanceM < 100_000 -> String.format(Locale.US, "%.1f km", distanceM / 1_000)
    else -> "${(distanceM / 1_000).toInt()} km"
}

@Composable
private fun SurveyNotice(text: String, warning: Boolean) {
    val container = if (warning) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.errorContainer
    val content = if (warning) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onErrorContainer
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = container,
    ) {
        Text(
            text,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            style = MaterialTheme.typography.bodySmall,
            color = content,
        )
    }
}

@Composable
private fun CaptureFacts(
    epochMs: Long,
    gps: GpsFix?,
    routeCode: String?,
    variantCode: String?,
    snapshotRevision: String?,
) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        SurveyCaptureFacts.lines(epochMs, gps, routeCode, variantCode, snapshotRevision).forEach { line ->
            Text(tr(line), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SurveySection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                title,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            content()
        }
    }
}

@Composable
private fun HoldToRecordButton(
    recording: Boolean,
    onHoldStart: () -> Unit,
    onHoldEnd: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(20.dp)
    val color = if (recording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier.border(1.dp, color, shape).padding(horizontal = 12.dp, vertical = 10.dp)
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown()
                    onHoldStart()
                    onHoldEnd(waitForUpOrCancellation() == null)
                }
            },
    ) {
        Text(
            tr(if (recording) "Recording…" else "Hold for voice"),
            color = if (recording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
        )
    }
}
