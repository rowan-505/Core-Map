package com.coremapmm.fieldsurveyor.ui.survey

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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
import com.coremapmm.fieldsurveyor.ui.report.ProposedLocationControls
import com.coremapmm.fieldsurveyor.ui.report.ReportTypeSelector
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
    var mapPickModeName by rememberSaveable { mutableStateOf(NewStopPickMode.NONE.name) }
    var mapPickLat by rememberSaveable { mutableStateOf(Double.NaN) }
    var mapPickLng by rememberSaveable { mutableStateOf(Double.NaN) }
    var mapPickAccuracy by rememberSaveable { mutableStateOf(Float.NaN) }
    var mapPickEpochMs by rememberSaveable { mutableStateOf(0L) }
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
    var sheetStageName by rememberSaveable { mutableStateOf(SurveySheetStage.MAP.name) }
    var sheetStage by remember {
        mutableStateOf(
            runCatching { SurveySheetStage.valueOf(sheetStageName) }.getOrDefault(SurveySheetStage.MAP),
        )
    }
    var sheetVisibleFraction by remember { mutableFloatStateOf(sheetStage.visibleFraction) }
    val formListState = rememberSaveable(saver = LazyListState.Saver) { LazyListState() }
    var nowEpochMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val recorder = remember { VoiceRecorder(context) }
    val voiceDraftForCleanup by rememberUpdatedState(voiceDraft)

    fun setSheetStage(next: SurveySheetStage) {
        sheetStage = next
        sheetStageName = next.name
        sheetVisibleFraction = next.visibleFraction
    }

    fun persistMapPick(fix: GpsFix?, mode: NewStopPickMode) {
        mapPick = fix
        mapPickModeName = mode.name
        if (fix == null) {
            mapPickLat = Double.NaN
            mapPickLng = Double.NaN
            mapPickAccuracy = Float.NaN
            mapPickEpochMs = 0L
        } else {
            mapPickLat = fix.lat
            mapPickLng = fix.lng
            mapPickAccuracy = fix.accuracyM ?: Float.NaN
            mapPickEpochMs = fix.epochMs
        }
    }

    fun mapPickMode(): NewStopPickMode =
        runCatching { NewStopPickMode.valueOf(mapPickModeName) }.getOrDefault(NewStopPickMode.NONE)

    fun restoredMapPick(): GpsFix? {
        if (!mapPickLat.isNaN() && !mapPickLng.isNaN()) {
            return GpsFix(
                mapPickLat,
                mapPickLng,
                mapPickAccuracy.takeUnless { it.isNaN() },
                mapPickEpochMs,
            )
        }
        return mapPick
    }

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
        if (mapPick == null && !mapPickLat.isNaN() && !mapPickLng.isNaN()) {
            mapPick = restoredMapPick()
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
        persistMapPick(null, NewStopPickMode.NONE)
    }

    fun submitPendingReport() {
        val kind = pendingKind ?: return
        val draft = newStopDraft()
        scope.launch {
            val saved = survey.submitReport(
                kind = kind,
                note = if (kind == AnomalyKind.NEW_STOP) draft.note else note,
                reportLocation = when (kind) {
                    AnomalyKind.MOVED, AnomalyKind.OTHER -> restoredMapPick()
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
                if (ReportSaveReset.shouldClearDraftMedia(true) && ReportSaveReset.shouldResetForm(true)) {
                    resetDraft()
                }
                // Compact peek — form fields cleared; next/prev/current already updated.
                setSheetStage(SurveySheetStage.MAP)
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
        setSheetStage(SurveySheetStage.STOPS)
    }

    SurveyKeepScreenOnEffect(trackingActive = state.running)

    DisposableEffect(Unit) {
        onDispose {
            recorder.cancel()
            photoDrafts.forEach { it.delete() }
            voiceDraftForCleanup?.delete()
            survey.clearTransientFeedback()
            survey.releaseMapGps()
        }
    }
    LaunchedEffect(Unit) {
        survey.loadCachedVariant()
        withLocationPermission("startup") { survey.startupLocation() }
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
            reportedStopIds = state.reportedStopIds,
            preferMyanmarLabels = true,
            gps = location.displayFix,
            cameraFollowEnabled = state.cameraFollowEnabled,
            centerOncePending = state.centerOncePending,
            anomalies = state.anomalies,
            pickMovedGeom = (pendingKind == AnomalyKind.MOVED && mapPickMode() == NewStopPickMode.PICKING) ||
                (pendingKind == AnomalyKind.OTHER && mapPickMode() == NewStopPickMode.PICKING) ||
                (pendingKind == AnomalyKind.NEW_STOP && NewStopReportFlow.isPickMode(newStopDraft())),
            pickedPoint = when (pendingKind) {
                AnomalyKind.NEW_STOP -> newStopDraft().proposed
                AnomalyKind.MOVED, AnomalyKind.OTHER -> restoredMapPick()
                else -> null
            },
            sheetVisibleFraction = sheetVisibleFraction,
            onStopClick = ::selectStop,
            onMapPick = { lat, lng ->
                when (pendingKind) {
                    AnomalyKind.NEW_STOP -> {
                        applyNewStopDraft(
                            NewStopReportFlow.onMapTap(newStopDraft(), lat, lng, System.currentTimeMillis()),
                        )
                        setSheetStage(SurveySheetStage.STOPS)
                    }
                    AnomalyKind.MOVED, AnomalyKind.OTHER -> {
                        if (mapPickMode() == NewStopPickMode.PICKING) {
                            persistMapPick(
                                GpsFix(lat, lng, null, System.currentTimeMillis()),
                                NewStopPickMode.SELECTED,
                            )
                            setSheetStage(SurveySheetStage.STOPS)
                        }
                    }
                    else -> Unit
                }
            },
            onManualPan = survey::manualMapPan,
            onCenterOnceConsumed = survey::cameraCentered,
            onLocate = { withLocationPermission("locate") { survey.locate() } },
            modifier = Modifier.fillMaxSize(),
        )
        FourStageSurveySheet(
            stage = sheetStage,
            onStageChange = ::setSheetStage,
            onVisibleFractionChange = { sheetVisibleFraction = it },
            modifier = Modifier.fillMaxSize(),
            header = { dragModifier, onHandleToggle ->
                val selectedStop = window.current
                val sequences = state.stops.map { it.stopSequence }
                val newStopHasPosition = pendingKind == AnomalyKind.NEW_STOP &&
                    newStopDraft().proposed != null
                SurveyStickySummaryBanner(
                    routeTitle = SurveyStickyBannerModel.routeTitle(
                        state.selection?.routeCode,
                        state.selection?.variantCode,
                    ),
                    oppositeVariantCode = state.oppositeVariantCode,
                    directionSwitchEnabled = state.directionSwitchEnabled,
                    showDirectionSwitch = state.selection != null,
                    onDirectionSwitch = {
                        when (survey.requestDirectionSwitch()) {
                            DirectionSwitchAction.SWITCH_NOW -> survey.switchToOppositeDirection()
                            DirectionSwitchAction.CONFIRM_AND_SWITCH -> confirmDirectionSwitch = true
                            DirectionSwitchAction.DISABLED -> Unit
                        }
                    },
                    running = state.running,
                    sessionTransitionBusy = state.sessionTransitionBusy,
                    onStart = { withLocationPermission("survey") { survey.startSurvey() } },
                    onStop = { survey.endSurvey() },
                    variantFinished = state.variantFinished,
                    finishEnabled = state.selection != null,
                    onToggleFinished = {
                        if (state.selection != null) {
                            survey.setVariantFinished(!state.variantFinished)
                        }
                    },
                    stopLine = SurveyStickyBannerModel.stopLine(
                        stop = selectedStop,
                        sequences = sequences,
                        displayName = selectedStop?.let { stopDisplayName(it) },
                    ),
                    gpsLabel = location.chipLabel,
                    gpsStatus = location.status,
                    reportSummary = SurveyStickyBannerModel.reportSummary(
                        selectedKinds = SurveyStickyBannerModel.selectedKinds(pendingKind),
                        newStopHasMapPosition = newStopHasPosition,
                    ),
                    pendingSyncLabel = SurveyStickyBannerModel.pendingSyncLabel(state.pendingSyncCount),
                    dragModifier = dragModifier,
                    onHandleToggle = onHandleToggle,
                )
            },
            content = { visibleStage ->
                Column(
                    Modifier
                        .fillMaxWidth()
                        .weight(1f, fill = true)
                        .imePadding(),
                ) {
                    // Nearby stays reachable at half-sheet without opening full form.
                    if (visibleNearbyStops.isNotEmpty()) {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 14.dp, vertical = 2.dp)
                                .testTag("survey_nearby_strip"),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
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
                    if (!SurveySheetLayout.showsScrollableForm(visibleStage)) {
                        return@Column
                    }
                    LazyColumn(
                        state = formListState,
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .testTag("survey_form_list"),
                        contentPadding = PaddingValues(
                            start = 16.dp,
                            end = 16.dp,
                            top = 4.dp,
                            bottom = 10.dp,
                        ),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        item("notices") {
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                if (state.selection != null && !state.directionSwitchEnabled) {
                                    Text(
                                        tr(OppositeVariantLookup.MISSING_COUNTERPART_MESSAGE),
                                        color = MaterialTheme.colorScheme.error,
                                        style = MaterialTheme.typography.labelSmall,
                                    )
                                }
                                state.duplicateWarning?.let {
                                    SurveyNotice(tr(it), warning = true)
                                }
                            }
                        }
                        item("stops") {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                SurveyStopStrip(
                                    stops = state.stops,
                                    selectedStopPublicId = state.selection?.selectedStopPublicId,
                                    reportedStopIds = state.reportedStopIds,
                                    onSelect = ::selectStop,
                                )
                                state.endOfRouteNotice?.let {
                                    Text(
                                        tr(it),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                        item("report_type") {
                            SurveySection(tr("Report issue")) {
                                ReportTypeSelector(
                                    selected = pendingKind,
                                    onSelect = { kind ->
                                        when {
                                            !state.running -> survey.setMessage("Start the survey first.")
                                            SurveyReportFlow.requiresStop(kind) &&
                                                state.selection?.selectedStopPublicId == null ->
                                                survey.setMessage("Select a stop first.")
                                            pendingKind == kind -> {
                                                resetDraft()
                                                survey.setMessage("")
                                            }
                                            else -> {
                                                clearMediaDrafts()
                                                setPendingKind(kind)
                                                note = ""
                                                setRouteIssue(null)
                                                proposedStopName = ""
                                                applyNewStopDraft(
                                                    NewStopReportFlow.newDraft(
                                                        NewStopReportFlow.reuseDraftUuid(
                                                            newStopClientId.ifBlank { null },
                                                        ),
                                                    ),
                                                )
                                                persistMapPick(null, NewStopPickMode.NONE)
                                                survey.setMessage("")
                                                survey.refreshDuplicateWarning(kind)
                                                setSheetStage(SurveySheetStage.STOPS)
                                            }
                                        }
                                    },
                                )
                            }
                        }
                        if (pendingKind != null) {
                            item("report_details") {
                                val kind = pendingKind!!
                                SurveySection(tr("Report details")) {
                                    ReportKindForm(
                                        kind = kind,
                                        note = note,
                                        onNote = { note = it },
                                        routeIssue = routeIssue,
                                        onRouteIssue = { setRouteIssue(it) },
                                        mapPick = restoredMapPick(),
                                        mapPickMode = mapPickMode(),
                                        onMapPickChange = ::persistMapPick,
                                        routeCode = state.selection?.routeCode,
                                        variantCode = state.selection?.variantCode,
                                        selectedStop = window.current,
                                        newStopDraft = newStopDraft(),
                                        onNewStopDraft = { applyNewStopDraft(it) },
                                        gps = location.displayFix ?: location.evidenceFix,
                                        previousStop = window.current,
                                        nextStop = window.next,
                                        sequences = state.stops.map { it.stopSequence },
                                        onChooseOnMap = {
                                            when (kind) {
                                                AnomalyKind.NEW_STOP -> {
                                                    applyNewStopDraft(
                                                        NewStopReportFlow.chooseAgain(newStopDraft()),
                                                    )
                                                }
                                                AnomalyKind.MOVED, AnomalyKind.OTHER -> {
                                                    persistMapPick(null, NewStopPickMode.PICKING)
                                                }
                                                else -> Unit
                                            }
                                            setSheetStage(SurveySheetStage.MAP)
                                        },
                                    )
                                }
                            }
                        }
                        item("evidence") {
                            SurveySection(tr(EvidenceUi.SECTION_TITLE)) {
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
                                            val dest = File(
                                                context.cacheDir,
                                                "field-voice-${System.currentTimeMillis()}.m4a",
                                            )
                                            runCatching {
                                                recorder.start(dest)
                                                recordStartedAt = System.currentTimeMillis()
                                                recording = true
                                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                            }.onFailure { error ->
                                                survey.setMessage(error.message ?: "Could not start recording")
                                            }
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
                                                        voiceDraftDuration =
                                                            duration.coerceAtMost(VoiceTarget.MAX_DURATION_MS.toLong())
                                                        draftStopId = state.selection?.selectedStopPublicId
                                                    }
                                                }.onFailure { error ->
                                                    survey.setMessage(error.message ?: "Could not save voice")
                                                }
                                        }
                                    },
                                    onClearEvidence = {
                                        photoDrafts.forEach { it.delete() }
                                        photoDrafts.clear()
                                        voiceDraft?.delete()
                                        voiceDraft = null
                                        voiceDraftDuration = 0L
                                    },
                                )
                            }
                        }
                        item("actions") {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    OutlinedButton(
                                        onClick = ::resetDraft,
                                        modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                                    ) { Text(tr("Cancel")) }
                                    Button(
                                        onClick = {
                                            val kind = pendingKind ?: return@Button
                                            if (kind != AnomalyKind.NEW_STOP &&
                                                ReportLocationPolicy.requiresPoorAccuracyConfirmation(
                                                    kind,
                                                    state.gps,
                                                    nowEpochMs,
                                                )
                                            ) {
                                                confirmPoorGpsReport = true
                                            } else {
                                                submitPendingReport()
                                            }
                                        },
                                        enabled = if (pendingKind == AnomalyKind.NEW_STOP) {
                                            NewStopReportFlow.canSave(state.running, window.current, newStopDraft())
                                        } else {
                                            pendingKind != null
                                        },
                                        modifier = Modifier
                                            .weight(1f)
                                            .heightIn(min = 48.dp)
                                            .testTag("survey_report_save"),
                                    ) { Text(tr(EvidenceUi.SAVE)) }
                                }
                            }
                        }
                        if (pendingKind == null && state.selection != null) {
                            item("finish") {
                                SurveyFinishChip(
                                    finished = state.variantFinished,
                                    onToggle = { survey.setVariantFinished(!state.variantFinished) },
                                )
                            }
                        }
                    }
                }
            },
        )
        SurveyNotifyHost(
            event = state.notice,
            onConsumed = survey::consumeNotice,
            onAction = { key ->
                if (key == SurveyNotifyCopy.ACTION_RETRY_SAVE) {
                    submitPendingReport()
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
                    setSheetStage(SurveySheetStage.STOPS)
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
        modifier = modifier.heightIn(min = 56.dp),
        colors = colors,
        shape = RoundedCornerShape(12.dp),
        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 4.dp),
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
    onClearEvidence: () -> Unit,
) {
    if (!hasReportContext) return
    val summary = EvidenceUi.summary(
        photoCount = photoDrafts.size,
        voiceDurationMs = voiceDraft?.let { voiceDraftDurationMs },
    )
    if (summary != null) {
        Row(
            Modifier
                .fillMaxWidth()
                .testTag("evidence_summary"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                tr(summary),
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.weight(1f),
            )
            if (voiceDraft != null) {
                AudioButton(voiceDraft)
            }
            TextButton(
                onClick = onClearEvidence,
                modifier = Modifier.heightIn(min = 48.dp).testTag("evidence_clear"),
            ) { Text(tr("Remove")) }
        }
    }
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedButton(
            onClick = onCamera,
            enabled = photoDrafts.size < JpegTarget.MAX_PHOTOS_PER_REPORT,
            modifier = Modifier
                .weight(1f)
                .heightIn(min = 48.dp)
                .testTag("evidence_photo"),
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
        ) {
            Text(tr(EvidenceUi.PHOTO), style = MaterialTheme.typography.labelMedium)
        }
        if (voiceDraft == null) {
            HoldToRecordButton(
                recording = recording,
                onHoldStart = onRecordStart,
                onHoldEnd = onRecordEnd,
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 48.dp)
                    .testTag("evidence_voice"),
            )
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
        modifier = modifier.heightIn(min = 48.dp),
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
    mapPickMode: NewStopPickMode,
    onMapPickChange: (GpsFix?, NewStopPickMode) -> Unit,
    routeCode: String?,
    variantCode: String?,
    selectedStop: com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow?,
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
                SelectedStopLine(selectedStop, sequences)
                ProposedLocationControls(
                    proposed = mapPick,
                    picking = mapPickMode == NewStopPickMode.PICKING,
                    gps = gps,
                    onUseMyLocation = {
                        val fix = gps ?: return@ProposedLocationControls
                        onMapPickChange(fix, NewStopPickMode.SELECTED)
                    },
                    onChooseOnMap = onChooseOnMap,
                    onRemove = { onMapPickChange(null, NewStopPickMode.NONE) },
                    onChooseAgain = onChooseOnMap,
                    pickingHint = EvidenceUi.MAP_TAP_HINT,
                )
                OptionalNote(note, onNote)
            }
            AnomalyKind.MISSING -> {
                SelectedStopLine(selectedStop, sequences)
                OptionalNote(note, onNote)
            }
            AnomalyKind.DATA -> {
                SelectedStopLine(selectedStop, sequences)
                RequiredNote(note, onNote, "Short explanation")
            }
            AnomalyKind.ROUTE -> {
                Text(
                    listOfNotNull(routeCode, variantCode).joinToString(" · ").ifBlank { tr("No route") },
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (selectedStop != null) {
                    SelectedStopLine(selectedStop, sequences, label = "Related stop")
                }
                RequiredNote(note, onNote, "Route explanation")
            }
            AnomalyKind.NEW_STOP -> NewStopForm(
                draft = newStopDraft,
                onDraft = onNewStopDraft,
                gps = gps,
                previousStop = previousStop,
                nextStop = nextStop,
                sequences = sequences,
                onChooseOnMap = onChooseOnMap,
            )
            AnomalyKind.OTHER -> {
                RequiredNote(note, onNote, "Explanation")
                ProposedLocationControls(
                    proposed = mapPick,
                    picking = mapPickMode == NewStopPickMode.PICKING,
                    gps = gps,
                    onUseMyLocation = {
                        val fix = gps ?: return@ProposedLocationControls
                        onMapPickChange(fix, NewStopPickMode.SELECTED)
                    },
                    onChooseOnMap = onChooseOnMap,
                    onRemove = { onMapPickChange(null, NewStopPickMode.NONE) },
                    onChooseAgain = onChooseOnMap,
                    pickingHint = EvidenceUi.MAP_TAP_HINT,
                )
            }
        }
    }
}

@Composable
private fun SelectedStopLine(
    stop: com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow?,
    sequences: List<Int>,
    label: String = "Selected stop",
) {
    val text = stop?.let {
        "${StopSequenceDisplay.uiLabel(it.stopSequence, sequences)} ${SurveyStopStripModel.displayName(it.nameMy, it.nameEn)}"
    } ?: tr("Select a stop first.")
    Text("${tr(label)}: $text", style = MaterialTheme.typography.bodySmall)
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
        "${StopSequenceDisplay.uiLabel(it.stopSequence, sequences)} ${SurveyStopStripModel.displayName(it.nameMy, it.nameEn)}"
    } ?: tr("Select a stop first.")
    val nextLabel = nextStop?.let {
        "${StopSequenceDisplay.uiLabel(it.stopSequence, sequences)} ${SurveyStopStripModel.displayName(it.nameMy, it.nameEn)}"
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
    ProposedLocationControls(
        proposed = draft.proposed,
        picking = draft.pickMode == NewStopPickMode.PICKING,
        gps = gps,
        onUseMyLocation = { onDraft(NewStopReportFlow.useMyLocation(draft, gps)) },
        onChooseOnMap = onChooseOnMap,
        onRemove = { onDraft(NewStopReportFlow.removeGeometry(draft)) },
        onChooseAgain = onChooseOnMap,
        pickingHint = EvidenceUi.MAP_TAP_HINT,
    )
    OptionalNote(draft.note) { onDraft(draft.copy(note = it.take(4000))) }
}

@Composable
private fun OptionalNote(note: String, onNote: (String) -> Unit) = NoteField(note, onNote, "Note (optional)")

@Composable
private fun RequiredNote(note: String, onNote: (String) -> Unit, label: String) = NoteField(note, onNote, label)

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
    // warning = soft notice (not red). blocking/error notices use error container.
    val container = if (warning) {
        MaterialTheme.colorScheme.secondaryContainer
    } else {
        MaterialTheme.colorScheme.errorContainer
    }
    val content = if (warning) {
        MaterialTheme.colorScheme.onSecondaryContainer
    } else {
        MaterialTheme.colorScheme.onErrorContainer
    }
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
private fun SurveyFinishChip(
    finished: Boolean,
    onToggle: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .testTag("survey_completion_row"),
        contentAlignment = Alignment.CenterEnd,
    ) {
        OutlinedButton(
            onClick = onToggle,
            modifier = Modifier
                .heightIn(min = 36.dp)
                .testTag("survey_completion_checkbox"),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
            border = BorderStroke(
                1.dp,
                if (finished) Color(0xFF1B7F3A) else MaterialTheme.colorScheme.outlineVariant,
            ),
            colors = ButtonDefaults.outlinedButtonColors(
                contentColor = if (finished) Color(0xFF1B7F3A) else MaterialTheme.colorScheme.onSurface,
            ),
        ) {
            Text(
                tr(if (finished) "✓ Finished" else "Mark finished"),
                style = MaterialTheme.typography.labelMedium,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun SurveySection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            title,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        content()
    }
}

@Composable
private fun HoldToRecordButton(
    recording: Boolean,
    onHoldStart: () -> Unit,
    onHoldEnd: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(12.dp)
    val outline = if (recording) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.outlineVariant
    }
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .border(1.dp, outline, shape)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown()
                    onHoldStart()
                    onHoldEnd(waitForUpOrCancellation() == null)
                }
            },
    ) {
        Text(
            tr(if (recording) EvidenceUi.RECORDING else EvidenceUi.HOLD_TO_RECORD),
            color = MaterialTheme.colorScheme.onSurface,
            style = MaterialTheme.typography.labelMedium,
            textAlign = TextAlign.Center,
            maxLines = 2,
        )
    }
}
