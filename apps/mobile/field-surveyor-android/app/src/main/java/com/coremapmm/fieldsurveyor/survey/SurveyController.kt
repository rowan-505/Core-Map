package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.LocalReportDao
import com.coremapmm.fieldsurveyor.data.LocalReportEntity
import com.coremapmm.fieldsurveyor.data.LocalSurveySessionEntity
import com.coremapmm.fieldsurveyor.data.SurveySessionRepository
import com.coremapmm.fieldsurveyor.data.transport.BootstrapRepository
import com.coremapmm.fieldsurveyor.data.transport.DirectionSwitchResolver
import com.coremapmm.fieldsurveyor.data.transport.DirectionSwitchTarget
import com.coremapmm.fieldsurveyor.data.transport.OppositeVariantLookup
import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import com.coremapmm.fieldsurveyor.data.transport.RouteSelectionRow
import com.coremapmm.fieldsurveyor.media.ReportPhotoStore
import com.coremapmm.fieldsurveyor.media.ReportVoiceStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

data class SurveyUiState(
    val running: Boolean = false,
    val locationMode: LocationMode = LocationMode.IDLE,
    val cameraFollowEnabled: Boolean = false,
    val centerOncePending: Boolean = false,
    val selection: SurveySelection? = null,
    val stops: List<OrderedStopRow> = emptyList(),
    val pathCoordinates: List<Pair<Double, Double>> = emptyList(),
    val gps: GpsFix? = null,
    val location: SurveyLocationSnapshot = SurveyLocationSnapshot.idle(),
    val gpsLabel: String = SurveyLocationLabels.CHIP_NONE,
    val nearbyStops: List<NearbyStop> = emptyList(),
    val capturedBanner: String? = null,
    val message: String? = null,
    val snapshotRevision: String? = null,
    val anomalies: List<GpsFix> = emptyList(),
    val openSurveyRequestId: Long = 0L,
    val oppositeVariantCode: String? = null,
    val directionSwitchEnabled: Boolean = false,
    val sessionReportCount: Int = 0,
    val pendingSyncCount: Int = 0,
    val duplicateWarning: String? = null,
    val endOfRouteNotice: String? = null,
)

class SurveyController(
    private val selectionStore: SurveySelectionStore,
    private val bootstrap: BootstrapRepository,
    private val reports: LocalReportDao,
    private val sessions: SurveySessionRepository,
    private val photos: ReportPhotoStore,
    private val voice: ReportVoiceStore,
    private val gpsEngine: GpsEngine,
    private val onCaptured: () -> Unit = {},
    private val onForegroundStart: () -> Boolean = { true },
    private val onForegroundStop: () -> Unit = {},
    private val nowMs: () -> Long = { System.currentTimeMillis() },
    private val uptimeMs: () -> Long = { android.os.SystemClock.uptimeMillis() },
    private val locationClock: LocationClock = SystemLocationClock,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutex = Mutex()
    private val gpsBuffer = ArrayDeque<GpsFix>(GpsBuffer.MAX_FIXES)
    private var lastKind: AnomalyKind? = null
    private var lastCaptureUptime = 0L
    private var startupRequested = false
    private var trackingStarted = false
    private var lastNearbyFix: GpsFix? = null
    private var lastNearbyComputedAtMs = 0L
    private var activeSessionId: String? = selectionStore.activeSessionId()
    private var watchdog = TrackingWatchdog.stopped()

    private val restoredSelection = selectionStore.load()
    private val restoredActive = selectionStore.isSurveyActive() && restoredSelection != null
    private val foreground = SurveyForegroundCoordinator(
        initiallyRequested = restoredActive,
        startService = onForegroundStart,
        stopService = onForegroundStop,
    )
    private val stateFlow = MutableStateFlow(
        SurveyUiState(
            running = restoredActive,
            locationMode = if (restoredActive) LocationMode.SURVEY_TRACKING else LocationMode.IDLE,
            cameraFollowEnabled = restoredActive,
            selection = restoredSelection,
        ),
    )
    val state: StateFlow<SurveyUiState> = stateFlow.asStateFlow()
    private val runningFlow = MutableStateFlow(restoredActive)
    val isRunning: StateFlow<Boolean> = runningFlow.asStateFlow()

    suspend fun loadCachedVariant() {
        val active = withContext(Dispatchers.IO) { sessions.active() }
        if (active != null) {
            activeSessionId = active.clientSessionId
            selectionStore.setActiveSessionId(active.clientSessionId)
            selectionStore.setSurveyActive(true)
            setRunning(true)
            stateFlow.value = stateFlow.value.copy(locationMode = LocationMode.SURVEY_TRACKING)
        } else if (selectionStore.isSurveyActive()) {
            activeSessionId = null
            selectionStore.setActiveSessionId(null)
            selectionStore.setSurveyActive(false)
            setRunning(false)
        }
        val stored = stateFlow.value.selection ?: selectionStore.load()
        val selection = DirectionSwitchPolicy.restoredSelection(
            active = active?.let {
                LocalSessionSnapshot(it.routePublicId, it.routeCode, it.variantPublicId, it.variantCode)
            },
            stored = stored,
        ) ?: return
        applySelection(selection, keepSelectedStop = true)
        refreshCounts()
    }

    suspend fun selectVariant(row: RouteSelectionRow) {
        applySelection(
            SurveySelection(
                routePublicId = row.routePublicId,
                routeCode = row.routeCode,
                variantPublicId = row.variantPublicId,
                variantCode = row.variantCode,
                selectedStopPublicId = null,
            ),
            keepSelectedStop = false,
        )
    }

    fun hasLocationPermission(): Boolean = gpsEngine.hasLocationPermission()

    /**
     * Uses the centralized location snapshot when a coordinate exists.
     * Live, degraded, and last-known/stale coordinates are all eligible.
     * Does not start survey tracking.
     */
    suspend fun locationForNearbyRecommend(): GpsFix? {
        NearbyRouteLocationPolicy.select(stateFlow.value.location, stateFlow.value.gps)?.let {
            return it.fix
        }
        if (!hasLocationPermission()) return null
        if (stateFlow.value.locationMode == LocationMode.SURVEY_TRACKING || gpsEngine.isTracking()) {
            return stateFlow.value.gps
        }
        return suspendCancellableCoroutine { continuation ->
            var latest: GpsFix? = null
            gpsEngine.requestOneShot(
                includeCached = true,
                onFix = { latest = it },
                onFinished = {
                    if (continuation.isActive) continuation.resume(latest)
                },
            )
            continuation.invokeOnCancellation { gpsEngine.stop() }
        }
    }

    fun requestDirectionSwitch(): DirectionSwitchAction {
        val action = DirectionSwitchPolicy.action(
            running = stateFlow.value.running,
            enabled = stateFlow.value.directionSwitchEnabled,
        )
        if (action == DirectionSwitchAction.DISABLED) {
            stateFlow.value = stateFlow.value.copy(message = OppositeVariantLookup.MISSING_COUNTERPART_MESSAGE)
        }
        return action
    }

    fun switchToOppositeDirection() {
        scope.launch { switchToOppositePersisted() }
    }

    suspend fun openHistoryRoute(session: LocalSurveySessionEntity) {
        if (stateFlow.value.running && activeSessionId != session.clientSessionId) {
            stateFlow.value = stateFlow.value.copy(message = "Finish the active survey before viewing another route.")
            requestOpenSurvey()
            return
        }
        applySelection(
            SurveySelection(
                routePublicId = session.routePublicId,
                routeCode = session.routeCode,
                variantPublicId = session.variantPublicId,
                variantCode = session.variantCode,
                selectedStopPublicId = null,
            ),
            keepSelectedStop = false,
        )
        requestOpenSurvey()
    }

    fun selectStop(stopPublicId: String?) {
        val current = stateFlow.value.selection ?: return
        val next = current.copy(selectedStopPublicId = stopPublicId)
        selectionStore.save(next)
        stateFlow.value = stateFlow.value.copy(
            selection = next,
            duplicateWarning = null,
            endOfRouteNotice = null,
        )
    }

    fun markStopCorrect(): Boolean {
        if (!stateFlow.value.running) {
            stateFlow.value = stateFlow.value.copy(message = "Start the survey first.")
            return false
        }
        val selectedId = stateFlow.value.selection?.selectedStopPublicId
        if (selectedId == null) {
            stateFlow.value = stateFlow.value.copy(message = "Select a stop first.")
            return false
        }
        val nextId = CorrectStopAction.nextStopPublicId(stateFlow.value.stops, selectedId)
        if (nextId == null) {
            stateFlow.value = stateFlow.value.copy(message = "This is the last stop on this direction.")
            return false
        }
        selectStop(nextId)
        stateFlow.value = stateFlow.value.copy(
            capturedBanner = "Stop marked correct",
            message = null,
        )
        return true
    }

    fun refreshDuplicateWarning(kind: AnomalyKind) {
        scope.launch { applyDuplicateWarning(kind) }
    }

    fun selectPrevious() {
        val window = StopContext.window(stateFlow.value.stops, stateFlow.value.selection?.selectedStopPublicId)
        window.previous?.let { selectStop(it.stopPublicId) }
    }

    fun selectNext() {
        val window = StopContext.window(stateFlow.value.stops, stateFlow.value.selection?.selectedStopPublicId)
        window.next?.let { selectStop(it.stopPublicId) }
    }

    fun startSurvey(): String? {
        val decision = SurveyRuntimePolicy.visibleStart(
            running = stateFlow.value.running,
            hasSelection = stateFlow.value.selection != null,
            hasPermission = gpsEngine.hasLocationPermission(),
            locationEnabled = gpsEngine.locationEnabled(),
        )
        if (decision == SurveyStartDecision.ALREADY_ACTIVE) return null
        val error = when (decision) {
            SurveyStartDecision.NO_SELECTION -> "Select a D0/D1 variant first."
            SurveyStartDecision.NO_PERMISSION -> "Location permission is required to start survey."
            SurveyStartDecision.LOCATION_DISABLED -> "Turn on GPS to start survey."
            else -> null
        }
        if (error != null) {
            stateFlow.value = stateFlow.value.copy(message = error)
            return error
        }
        scope.launch { startSurveyPersisted() }
        return null
    }

    fun endSurvey() {
        scope.launch {
            finishSurveyPersisted(
                LocalSurveySessionEntity.STATUS_COMPLETED,
                "Survey ended. Start again to save reports.",
            )
        }
    }

    fun abandonSurvey() {
        scope.launch {
            finishSurveyPersisted(LocalSurveySessionEntity.STATUS_ABANDONED, "Survey abandoned.")
        }
    }

    fun stopFromNotification() {
        scope.launch {
            finishSurveyPersisted(
                LocalSurveySessionEntity.STATUS_ABANDONED,
                "Survey stopped from notification.",
                notifyService = false,
            )
        }
    }

    /** Reconnects the single fused pipeline after a service/process recreation. */
    fun restoreActiveSurvey(): Boolean {
        val decision = SurveyRuntimePolicy.restore(
            persistedActive = selectionStore.isSurveyActive(),
            hasSelection = stateFlow.value.selection != null,
            hasPermission = gpsEngine.hasLocationPermission(),
            locationEnabled = gpsEngine.locationEnabled(),
        )
        if (decision == SurveyStartDecision.NOT_ACTIVE) return false
        if (trackingStarted && gpsEngine.isTracking()) return true
        if (decision == SurveyStartDecision.NO_PERMISSION || decision == SurveyStartDecision.NO_SELECTION) {
            val message = when (decision) {
                SurveyStartDecision.NO_PERMISSION -> "Location permission was removed; survey stopped."
                else -> "Survey selection is unavailable; survey stopped."
            }
            scope.launch {
                finishSurveyPersisted(LocalSurveySessionEntity.STATUS_ABANDONED, message)
            }
            return false
        }
        setRunning(true)
        val location = LocationStateModel.startSurvey()
        stateFlow.value = stateFlow.value.copy(
            locationMode = location.mode,
            cameraFollowEnabled = location.cameraFollowEnabled,
            centerOncePending = location.centerOncePending,
            message = if (decision == SurveyStartDecision.LOCATION_DISABLED) {
                "Location services are disabled."
            } else null,
        )
        return startTracking()
    }

    fun requestOpenSurvey() {
        stateFlow.value = stateFlow.value.copy(
            openSurveyRequestId = stateFlow.value.openSurveyRequestId + 1L,
        )
    }

    fun startupLocation(): String? {
        if (startupRequested || stateFlow.value.running) return null
        if (!gpsEngine.locationEnabled()) {
            val error = "Turn on GPS."
            stateFlow.value = stateFlow.value.copy(message = error)
            return error
        }
        startupRequested = true
        requestOneShot(
            location = LocationStateModel.startup(locationState()),
            includeCached = true,
            deferCenterUntilFix = false,
        )
        return null
    }

    fun locate(): String? {
        if (!gpsEngine.locationEnabled()) {
            val error = "Turn on GPS."
            stateFlow.value = stateFlow.value.copy(message = error)
            return error
        }
        val location = LocationStateModel.locate(locationState())
        stateFlow.value = stateFlow.value.copy(
            locationMode = location.mode,
            cameraFollowEnabled = location.cameraFollowEnabled,
            centerOncePending = location.centerOncePending,
            message = null,
        )
        if (location.mode == LocationMode.ONE_SHOT) {
            requestOneShot(location, includeCached = false, deferCenterUntilFix = true)
        } else if (stateFlow.value.running) {
            gpsEngine.requestFreshWhileTracking(::acceptFix)
        }
        return null
    }

    fun manualMapPan() {
        val location = LocationStateModel.manualPan(locationState())
        stateFlow.value = stateFlow.value.copy(
            cameraFollowEnabled = location.cameraFollowEnabled,
            centerOncePending = location.centerOncePending,
        )
    }

    fun cameraCentered() {
        val location = LocationStateModel.centered(locationState())
        stateFlow.value = stateFlow.value.copy(centerOncePending = location.centerOncePending)
    }

    fun releaseMapGps() {
        if (stateFlow.value.running) {
            return
        }
        gpsEngine.stop()
        val location = LocationStateModel.oneShotFinished(locationState())
        stateFlow.value = stateFlow.value.copy(
            locationMode = location.mode,
            cameraFollowEnabled = location.cameraFollowEnabled,
            centerOncePending = location.centerOncePending,
        )
    }

    suspend fun submitReport(
        kind: AnomalyKind,
        note: String = "",
        reportLocation: GpsFix? = null,
        routeIssue: RouteIssueKind? = null,
        proposedStopName: String = "",
        photoDrafts: List<File> = emptyList(),
        voiceDraft: File? = null,
        voiceDurationMs: Long = 0L,
        clientPublicId: String? = null,
        locationSource: String? = null,
        online: Boolean = true,
    ): Boolean {
        if (!CaptureDebounce.shouldAccept(lastKind, lastCaptureUptime, kind, uptimeMs())) {
            return false
        }
        val snapshot = stateFlow.value
        val selection = snapshot.selection ?: return false
        val selectedStop = snapshot.stops.firstOrNull {
            it.stopPublicId == selection.selectedStopPublicId
        }
        val proposedForValidation =
            if (kind == AnomalyKind.NEW_STOP) (reportLocation ?: evidenceGps(snapshot)) else reportLocation
        val flowError = SurveyReportFlow.saveError(
            running = snapshot.running,
            kind = kind,
            hasStop = selectedStop != null,
            mapPick = proposedForValidation,
            note = note,
            routeIssue = routeIssue,
            proposedStopName = proposedStopName,
        )
        if (flowError != null) {
            stateFlow.value = snapshot.copy(message = flowError)
            return false
        }
        val duplicate = duplicateWarningFor(kind, selectedStop?.stopPublicId, selection)
        ReportBundlePolicy.error(photoDrafts, voiceDraft, voiceDurationMs)?.let { error ->
            stateFlow.value = snapshot.copy(message = error)
            return false
        }
        val revision = snapshot.snapshotRevision
        if (revision.isNullOrBlank()) {
            stateFlow.value = snapshot.copy(message = "No local snapshot. Sync first.")
            return false
        }
        val gps = evidenceGps(stateFlow.value)
        val newStopHasProposed = kind == AnomalyKind.NEW_STOP && reportLocation != null
        if (gps == null && !newStopHasProposed) {
            stateFlow.value = snapshot.copy(message = "Need a GPS fix")
            return false
        }
        val observedAtMs = gps?.epochMs ?: nowMs()
        val input = AnomalyCaptureInput(
            kind = kind,
            snapshotRevision = revision,
            routePublicId = selection.routePublicId,
            routeCode = selection.routeCode,
            variantPublicId = selection.variantPublicId,
            variantCode = selection.variantCode,
            selectedStop = selectedStop,
            gps = gps,
            note = SurveyReportFlow.composedNote(note, routeIssue),
            reportLocation = reportLocation,
            observedAtIso = Instant.ofEpochMilli(observedAtMs).toString(),
            clientPublicId = NewStopReportFlow.reuseDraftUuid(clientPublicId),
            createdAtEpochMs = nowMs(),
            proposedStopName = proposedStopName,
            nextStopPublicId = if (kind == AnomalyKind.NEW_STOP) {
                CorrectStopAction.nextStopPublicId(snapshot.stops, selectedStop?.stopPublicId)
            } else {
                null
            },
            locationSource = locationSource,
        )
        val row = LocalReportEntity(
            clientPublicId = input.clientPublicId,
            status = LocalReportEntity.STATUS_LOCAL,
            payloadJson = AnomalyPayload.toJson(input),
            createdAtEpochMs = input.createdAtEpochMs,
            updatedAtEpochMs = input.createdAtEpochMs,
            sessionClientSessionId = activeSessionId,
        )
        try {
            mutex.withLock {
                withContext(Dispatchers.IO) {
                    // Media is written first. The sync DAO cannot claim it until the
                    // matching report exists and has synced successfully.
                    photoDrafts.forEach { photos.addFromCapture(input.clientPublicId, it) }
                    voiceDraft?.let { voice.addFromRecording(input.clientPublicId, it, voiceDurationMs) }
                    reports.upsert(row)
                }
            }
        } catch (error: Exception) {
            withContext(Dispatchers.IO) { photos.deleteForReport(input.clientPublicId) }
            stateFlow.value = stateFlow.value.copy(
                message = error.message ?: "Could not save report",
            )
            return false
        }
        onCaptured()
        lastKind = kind
        lastCaptureUptime = uptimeMs()
        refreshAnomalies()
        refreshCounts()
        val after = if (kind == AnomalyKind.NEW_STOP) {
            NewStopReportFlow.afterSave(snapshot.stops, selectedStop?.stopPublicId)
        } else {
            null
        }
        if (after?.nextStopPublicId != null) {
            selectStop(after.nextStopPublicId)
        }
        stateFlow.value = stateFlow.value.copy(
            capturedBanner = if (kind == AnomalyKind.NEW_STOP) {
                NewStopReportFlow.successBanner(online)
            } else {
                "✓ Captured"
            },
            message = null,
            duplicateWarning = duplicate,
            endOfRouteNotice = if (after?.endOfRoute == true) NewStopReportFlow.END_OF_ROUTE else null,
        )
        return true
    }

    private fun evidenceGps(snapshot: SurveyUiState): GpsFix? {
        return snapshot.location.evidenceFix
            ?: GpsBuffer.bestRecent(gpsBuffer.toList() + listOfNotNull(snapshot.gps), locationClock, snapshot.gps)
    }

    fun setMessage(message: String) {
        stateFlow.value = stateFlow.value.copy(message = message.ifBlank { null })
    }

    fun clearBanner() {
        stateFlow.value = stateFlow.value.copy(capturedBanner = null)
    }

    suspend fun refreshAnomalies() {
        val variantId = stateFlow.value.selection?.variantPublicId ?: return
        val rows = withContext(Dispatchers.IO) { reports.listAll() }
        val points = rows.mapNotNull { row ->
            if (AnomalyPayload.variantPublicId(row.payloadJson) != variantId) {
                null
            } else {
                AnomalyPayload.location(row.payloadJson)
            }
        }
        stateFlow.value = stateFlow.value.copy(anomalies = points)
    }

    private fun requestOneShot(
        location: LocationState,
        includeCached: Boolean,
        deferCenterUntilFix: Boolean,
    ) {
        stateFlow.value = stateFlow.value.copy(
            locationMode = location.mode,
            cameraFollowEnabled = location.cameraFollowEnabled,
            centerOncePending = location.centerOncePending && !deferCenterUntilFix,
            message = null,
        )
        applyLocationEvent(SurveyLocationEvent.OneShotStarted)
        gpsEngine.requestOneShot(
            includeCached = includeCached,
            onFix = { fix ->
                acceptFix(fix)
                if (deferCenterUntilFix && stateFlow.value.gps != null) {
                    stateFlow.value = stateFlow.value.copy(centerOncePending = true)
                }
            },
            onFinished = {
                applyLocationEvent(SurveyLocationEvent.OneShotFinished)
                val finished = LocationStateModel.oneShotFinished(locationState())
                stateFlow.value = stateFlow.value.copy(
                    locationMode = finished.mode,
                    cameraFollowEnabled = finished.cameraFollowEnabled,
                    centerOncePending = finished.centerOncePending,
                )
            },
        )
    }

    fun onLocationTick() {
        applyLocationEvent(SurveyLocationEvent.Tick)
        if (!stateFlow.value.running) {
            return
        }
        val (next, action) = TrackingWatchdog.onTick(watchdog, elapsedMs())
        watchdog = next
        when (action) {
            TrackingWatchdogAction.REQUEST_FRESH -> {
                applyLocationEvent(SurveyLocationEvent.WatchdogSilence)
                gpsEngine.requestFreshWhileTracking(::acceptFix)
            }
            TrackingWatchdogAction.RESTART_ONCE -> {
                gpsEngine.restartTracking()
            }
            TrackingWatchdogAction.NONE -> Unit
        }
    }

    fun onHostResumed() {
        if (!stateFlow.value.running) {
            return
        }
        if (!gpsEngine.hasLocationPermission()) {
            onTrackingFailure(TrackingFailure.PERMISSION_REVOKED)
            return
        }
        applyLocationEvent(SurveyLocationEvent.PermissionGranted)
        if (gpsEngine.locationEnabled()) {
            applyLocationEvent(SurveyLocationEvent.LocationEnabled)
        } else {
            applyLocationEvent(SurveyLocationEvent.LocationDisabled)
        }
        when (
            SurveyTrackingResumePolicy.resumeAfterSettingsOrPermission(
                surveyRunning = true,
                hasPermission = true,
                alreadyTracking = gpsEngine.isTracking(),
            )
        ) {
            SurveyStartDecision.START -> {
                trackingStarted = false
                startTracking()
                foreground.start()
            }
            SurveyStartDecision.ALREADY_ACTIVE -> foreground.start()
            else -> Unit
        }
    }

    private fun elapsedMs(): Long = locationClock.elapsedRealtimeNanos() / 1_000_000L

    private fun applyLocationEvent(event: SurveyLocationEvent) {
        val next = SurveyLocationReducer.reduce(
            previous = stateFlow.value.location,
            event = event,
            clock = locationClock,
            evidenceBuffer = gpsBuffer.toList(),
        )
        val gpsMessage = stateFlow.value.message
            ?.takeIf { it != SurveyLocationLabels.TEMPORARILY_UNAVAILABLE }
        stateFlow.value = stateFlow.value.copy(
            gps = next.displayFix,
            location = next,
            gpsLabel = next.chipLabel,
            message = gpsMessage,
        )
    }

    private fun acceptFix(fix: GpsFix) {
        watchdog = TrackingWatchdog.onCallback(watchdog, elapsedMs())
        val previous = stateFlow.value.location.displayFix
        applyLocationEvent(SurveyLocationEvent.FixReceived(fix))
        val published = stateFlow.value.location.displayFix ?: return
        if (published != previous) {
            GpsBuffer.push(gpsBuffer, published)
        }
        val now = nowMs()
        val recomputeNearby = NearbyStopRefreshPolicy.shouldRecompute(
            previous = lastNearbyFix,
            next = published,
            lastComputedAtMs = lastNearbyComputedAtMs,
            nowMs = now,
        )
        val nearby = if (recomputeNearby) {
            lastNearbyFix = published
            lastNearbyComputedAtMs = now
            nearbyFrom(published)
        } else {
            stateFlow.value.nearbyStops
        }
        stateFlow.value = stateFlow.value.copy(nearbyStops = nearby)
    }

    private fun startTracking(): Boolean {
        if (gpsEngine.isTracking()) {
            trackingStarted = true
            if (!watchdog.tracking) {
                watchdog = TrackingWatchdog.started(elapsedMs())
            }
            applyLocationEvent(SurveyLocationEvent.TrackingStarted)
            return true
        }
        applyLocationEvent(SurveyLocationEvent.TrackingStarted)
        val started = gpsEngine.startTracking(
            onFix = ::acceptFix,
            onUnavailable = ::onTrackingFailure,
            onAvailable = { applyLocationEvent(SurveyLocationEvent.ProviderAvailable(true)) },
        )
        trackingStarted = started
        if (started) {
            watchdog = TrackingWatchdog.started(elapsedMs())
        } else {
            applyLocationEvent(SurveyLocationEvent.TrackingStopped)
            watchdog = TrackingWatchdog.stopped()
        }
        return started
    }

    private fun onTrackingFailure(failure: TrackingFailure) {
        if (SurveyRuntimePolicy.failureStopsSurvey(failure)) {
            applyLocationEvent(SurveyLocationEvent.PermissionDenied)
            scope.launch {
                finishSurveyPersisted(
                    LocalSurveySessionEntity.STATUS_ABANDONED,
                    "Location permission was removed; survey stopped.",
                )
            }
            return
        }
        when (failure) {
            TrackingFailure.LOCATION_DISABLED ->
                applyLocationEvent(SurveyLocationEvent.LocationDisabled)
            TrackingFailure.PROVIDER_ERROR ->
                applyLocationEvent(SurveyLocationEvent.ProviderAvailable(false))
            TrackingFailure.PERMISSION_REVOKED -> Unit
        }
    }

    private suspend fun startSurveyPersisted() = mutex.withLock {
        if (stateFlow.value.running) return@withLock
        val selection = stateFlow.value.selection ?: return@withLock
        val revision = stateFlow.value.snapshotRevision ?: bootstrap.snapshotRevision()
        if (revision.isNullOrBlank()) {
            stateFlow.value = stateFlow.value.copy(message = "No local snapshot. Sync first.")
            return@withLock
        }
        val route = bootstrap.listSelections().firstOrNull {
            it.variantPublicId == selection.variantPublicId
        }
        if (route == null) {
            stateFlow.value = stateFlow.value.copy(message = "Select a D0/D1 variant first.")
            return@withLock
        }
        val local = withContext(Dispatchers.IO) { sessions.start(route, revision, nowMs()) }
        activeSessionId = local.clientSessionId
        selectionStore.setActiveSessionId(local.clientSessionId)
        selectionStore.setSurveyActive(true)
        gpsBuffer.clear()
        lastNearbyFix = null
        lastNearbyComputedAtMs = 0L
        val location = LocationStateModel.startSurvey()
        stateFlow.value = stateFlow.value.copy(
            locationMode = location.mode,
            cameraFollowEnabled = location.cameraFollowEnabled,
            centerOncePending = location.centerOncePending,
        )
        setRunning(true)
        if (!foreground.start() || !startTracking()) {
            finishSurveyPersisted(
                LocalSurveySessionEntity.STATUS_ABANDONED,
                "Could not start location tracking.",
            )
            return@withLock
        }
        onCaptured()
        stateFlow.value = stateFlow.value.copy(message = null)
        refreshCounts()
    }

    private suspend fun switchToOppositePersisted() = mutex.withLock {
        val current = stateFlow.value.selection ?: return@withLock
        val target = loadSwitchTarget(current) ?: run {
            refreshSwitchAvailability(current)
            stateFlow.value = stateFlow.value.copy(
                message = OppositeVariantLookup.MISSING_COUNTERPART_MESSAGE,
            )
            return@withLock
        }
        val revision = stateFlow.value.snapshotRevision ?: bootstrap.snapshotRevision()
        if (revision.isNullOrBlank()) {
            stateFlow.value = stateFlow.value.copy(message = "No local snapshot. Sync first.")
            return@withLock
        }
        if (stateFlow.value.running) {
            val activeId = activeSessionId ?: return@withLock
            val next = withContext(Dispatchers.IO) {
                sessions.completeAndStartOpposite(activeId, target.selection, revision, nowMs())
            }
            if (next == null) {
                stateFlow.value = stateFlow.value.copy(
                    message = OppositeVariantLookup.MISSING_COUNTERPART_MESSAGE,
                )
                return@withLock
            }
            activeSessionId = next.clientSessionId
            selectionStore.setActiveSessionId(next.clientSessionId)
            selectionStore.setSurveyActive(true)
            onCaptured()
        }
        lastNearbyFix = null
        lastNearbyComputedAtMs = 0L
        val location = LocationStateModel.manualPan(locationState())
        stateFlow.value = stateFlow.value.copy(
            cameraFollowEnabled = location.cameraFollowEnabled,
            centerOncePending = false,
        )
        applySelection(
            SurveySelection(
                routePublicId = target.selection.routePublicId,
                routeCode = target.selection.routeCode,
                variantPublicId = target.selection.variantPublicId,
                variantCode = target.selection.variantCode,
                selectedStopPublicId = null,
            ),
            keepSelectedStop = false,
        )
        stateFlow.value = stateFlow.value.copy(message = null)
        refreshCounts()
    }

    private suspend fun finishSurveyPersisted(
        status: String,
        message: String,
        notifyService: Boolean = true,
    ) {
        activeSessionId?.let { id ->
            withContext(Dispatchers.IO) {
                if (status == LocalSurveySessionEntity.STATUS_COMPLETED) sessions.complete(id, nowMs())
                else sessions.abandon(id, nowMs())
            }
            onCaptured()
        }
        finishSurvey(message, notifyService)
        refreshCounts()
    }

    private fun finishSurvey(message: String, notifyService: Boolean = true) {
        gpsEngine.stop()
        trackingStarted = false
        watchdog = TrackingWatchdog.stopped()
        applyLocationEvent(SurveyLocationEvent.TrackingStopped)
        selectionStore.setSurveyActive(false)
        selectionStore.setActiveSessionId(null)
        activeSessionId = null
        val location = LocationStateModel.finishSurvey()
        setRunning(false)
        gpsBuffer.clear()
        lastNearbyFix = null
        lastNearbyComputedAtMs = 0L
        stateFlow.value = stateFlow.value.copy(
            locationMode = location.mode,
            cameraFollowEnabled = location.cameraFollowEnabled,
            centerOncePending = location.centerOncePending,
            nearbyStops = emptyList(),
            message = message,
        )
        if (notifyService) foreground.stop()
    }

    private fun locationState(): LocationState = LocationState(
        mode = stateFlow.value.locationMode,
        cameraFollowEnabled = stateFlow.value.cameraFollowEnabled,
        centerOncePending = stateFlow.value.centerOncePending,
    )

    private suspend fun applySelection(selection: SurveySelection, keepSelectedStop: Boolean = true) {
        val stops = bootstrap.orderedStops(selection.variantPublicId)
        val pathJson = bootstrap.routePathJson(selection.variantPublicId)
        val revision = bootstrap.snapshotRevision()
        val selected = selection.copy(
            selectedStopPublicId = if (keepSelectedStop) {
                selection.selectedStopPublicId?.takeIf { id -> stops.any { it.stopPublicId == id } }
            } else {
                null
            },
        )
        selectionStore.save(selected)
        val gps = stateFlow.value.location.displayFix ?: stateFlow.value.gps
        lastNearbyFix = gps
        lastNearbyComputedAtMs = nowMs()
        val nearby = if (gps == null) {
            emptyList()
        } else StopContext.nearby(
            stops = stops,
            lat = gps.lat,
            lng = gps.lng,
            variantPublicId = selected.variantPublicId,
        )
        val switchTarget = loadSwitchTarget(selected)
        val intendedOpposite = if (selected.variantCode == "D0") "D1" else "D0"
        stateFlow.value = stateFlow.value.copy(
            selection = selected,
            stops = stops,
            pathCoordinates = parseLine(pathJson),
            snapshotRevision = revision,
            nearbyStops = nearby,
            oppositeVariantCode = switchTarget?.oppositeCode ?: intendedOpposite,
            directionSwitchEnabled = switchTarget != null,
        )
        refreshAnomalies()
        refreshCounts()
    }

    private suspend fun duplicateWarningFor(
        kind: AnomalyKind,
        stopPublicId: String?,
        selection: SurveySelection,
    ): String? {
        val sessionId = activeSessionId ?: return null
        val rows = withContext(Dispatchers.IO) { reports.listForSession(sessionId) }
        val existing = rows.mapNotNull { row ->
            AnomalyPayload.fingerprint(row.payloadJson, row.sessionClientSessionId)
        }
        return SurveyReportFlow.duplicateWarning(
            existing = existing,
            sessionId = sessionId,
            kind = kind,
            stopPublicId = stopPublicId,
            routePublicId = selection.routePublicId,
            variantPublicId = selection.variantPublicId,
        )
    }

    private suspend fun applyDuplicateWarning(kind: AnomalyKind) {
        val selection = stateFlow.value.selection ?: return
        val warning = duplicateWarningFor(kind, selection.selectedStopPublicId, selection)
        stateFlow.value = stateFlow.value.copy(duplicateWarning = warning)
    }

    private suspend fun refreshCounts() {
        val sessionId = activeSessionId
        val counts = withContext(Dispatchers.IO) {
            val sessionCount = if (sessionId == null) 0 else reports.countForSession(sessionId)
            sessionCount to reports.countPendingSync()
        }
        stateFlow.value = stateFlow.value.copy(
            sessionReportCount = counts.first,
            pendingSyncCount = counts.second,
        )
    }

    private suspend fun loadSwitchTarget(selection: SurveySelection): DirectionSwitchTarget? {
        val variants = bootstrap.variantsForRoute(selection.routePublicId)
        val counterpart = OppositeVariantLookup.counterpart(variants, selection.variantPublicId) ?: return null
        return DirectionSwitchResolver.resolve(
            currentVariantPublicId = selection.variantPublicId,
            variants = variants,
            selections = bootstrap.listSelections(),
            counterpartStops = bootstrap.orderedStops(counterpart.publicId),
            counterpartPathJson = bootstrap.routePathJson(counterpart.publicId),
        )
    }

    private suspend fun refreshSwitchAvailability(selection: SurveySelection) {
        val target = loadSwitchTarget(selection)
        stateFlow.value = stateFlow.value.copy(
            oppositeVariantCode = target?.oppositeCode ?: if (selection.variantCode == "D0") "D1" else "D0",
            directionSwitchEnabled = target != null,
        )
    }

    private fun nearbyFrom(gps: GpsFix): List<NearbyStop> {
        val variantPublicId = stateFlow.value.selection?.variantPublicId ?: return emptyList()
        return StopContext.nearby(
            stops = stateFlow.value.stops,
            lat = gps.lat,
            lng = gps.lng,
            variantPublicId = variantPublicId,
            previous = stateFlow.value.nearbyStops,
        )
    }

    private fun setRunning(running: Boolean) {
        runningFlow.value = running
        stateFlow.value = stateFlow.value.copy(running = running)
    }

    companion object {
        fun formatGps(fix: GpsFix): String = SurveyLocationLabels.chip(
            SurveyLocationStatus.Live,
            fix,
        )

        fun parseLine(geometryJson: String?): List<Pair<Double, Double>> {
            if (geometryJson.isNullOrBlank()) {
                return emptyList()
            }
            return runCatching {
                val geometry = JSONObject(geometryJson)
                val coordinates = geometry.optJSONArray("coordinates") ?: JSONArray()
                buildList {
                    for (i in 0 until coordinates.length()) {
                        val pair = coordinates.optJSONArray(i) ?: continue
                        val lng = pair.optDouble(0, Double.NaN)
                        val lat = pair.optDouble(1, Double.NaN)
                        if (lng.isFinite() && lat.isFinite()) {
                            add(lng to lat)
                        }
                    }
                }
            }.getOrDefault(emptyList())
        }
    }
}
