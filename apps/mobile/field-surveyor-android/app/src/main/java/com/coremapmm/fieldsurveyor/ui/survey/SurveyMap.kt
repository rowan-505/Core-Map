package com.coremapmm.fieldsurveyor.ui.survey

import android.os.SystemClock
import android.widget.FrameLayout
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.material.icons.outlined.Navigation
import androidx.compose.material.icons.outlined.Route
import androidx.compose.material.icons.outlined.ZoomOutMap
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import com.coremapmm.fieldsurveyor.offline.OfflineBasemap
import com.coremapmm.fieldsurveyor.survey.GpsCameraFollow
import com.coremapmm.fieldsurveyor.survey.GpsFix
import com.coremapmm.fieldsurveyor.survey.HeadingListenerLifecycle
import com.coremapmm.fieldsurveyor.survey.MapCameraThrottle
import com.coremapmm.fieldsurveyor.survey.MapFollowMode
import com.coremapmm.fieldsurveyor.survey.MapFollowPolicy
import com.coremapmm.fieldsurveyor.survey.RotationVectorHeadingSource
import com.coremapmm.fieldsurveyor.survey.SurveyHeading
import com.coremapmm.fieldsurveyor.survey.SurveyMapOverlays
import com.coremapmm.fieldsurveyor.ui.settings.tr
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import kotlin.math.roundToInt

internal object SurveyMapControlLayout {
    fun visible(sheetVisibleFraction: Float): Boolean = sheetVisibleFraction < 0.99f
}

@Composable
fun SurveyMap(
    variantPublicId: String?,
    pathCoordinates: List<Pair<Double, Double>>,
    stops: List<OrderedStopRow>,
    selectedStopPublicId: String?,
    nearbyStopPublicIds: Set<String>,
    gps: GpsFix?,
    cameraFollowEnabled: Boolean,
    centerOncePending: Boolean,
    anomalies: List<GpsFix>,
    pickMovedGeom: Boolean,
    pickedPoint: GpsFix?,
    sheetVisibleFraction: Float,
    onStopClick: (String) -> Unit,
    onMapPick: (Double, Double) -> Unit,
    onManualPan: () -> Unit,
    onCenterOnceConsumed: () -> Unit,
    onLocate: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var mapRef by remember { mutableStateOf<MapLibreMap?>(null) }
    var styleRef by remember { mutableStateOf<Style?>(null) }
    var fittedVariant by remember { mutableStateOf<String?>(null) }
    val stopFocusSeq = remember { mutableIntStateOf(0) }
    // Follow the first live fix automatically; a deliberate map pan turns follow off.
    val followGps = remember { mutableStateOf(true) }
    val focusOnUser = remember { mutableStateOf(true) }
    val followMode = remember { mutableStateOf(MapFollowMode.LOCATE) }
    val picking = remember { mutableStateOf(false) }
    var lastCameraGps by remember { mutableStateOf<GpsFix?>(null) }
    var lastCameraHeading by remember { mutableStateOf<Double?>(null) }
    var lastCameraAtMs by remember { mutableLongStateOf(0L) }
    var previousGps by remember { mutableStateOf<GpsFix?>(null) }
    var compassHeading by remember { mutableStateOf<Float?>(null) }
    var compassUsable by remember { mutableStateOf(false) }
    var displayHeading by remember { mutableStateOf<Double?>(null) }
    val mapView = remember {
        MapView(context).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            )
            onCreate(null)
        }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    DisposableEffect(HeadingListenerLifecycle.STABLE_KEY) {
        val source = RotationVectorHeadingSource(context) { headingDeg, usable ->
            compassHeading = headingDeg
            compassUsable = usable
        }
        source.start()
        onDispose { source.stop() }
    }

    LaunchedEffect(cameraFollowEnabled) {
        if (cameraFollowEnabled) {
            followGps.value = true
            if (MapFollowPolicy.cameraNorthUp(followMode.value)) {
                focusOnUser.value = true
            }
        } else {
            followGps.value = false
        }
    }

    LaunchedEffect(gps, compassHeading, compassUsable) {
        val last = previousGps
        previousGps = gps
        val fix = gps
        if (fix == null) {
            displayHeading = null
            return@LaunchedEffect
        }
        val sample = SurveyHeading.select(
            speedMps = SurveyHeading.speedMps(fix, last),
            locationBearingDeg = fix.bearingDeg,
            locationBearingAccuracyDeg = fix.bearingAccuracyDeg,
            compassHeadingDeg = compassHeading,
            compassUsable = compassUsable,
        )
        displayHeading = if (sample.visible) {
            SurveyHeading.smooth(displayHeading, sample.degrees)
        } else {
            null
        }
    }

    LaunchedEffect(mapRef, sheetVisibleFraction) {
        val map = mapRef ?: return@LaunchedEffect
        val bottomPadding = (mapView.height * sheetVisibleFraction)
            .roundToInt()
            .coerceIn(0, (mapView.height - 1).coerceAtLeast(0))
        map.setPadding(0, 0, 0, bottomPadding)
    }

    LaunchedEffect(pickMovedGeom) {
        picking.value = pickMovedGeom
    }

    DisposableEffect(lifecycle, mapView) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> mapView.onStart()
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                Lifecycle.Event.ON_STOP -> mapView.onStop()
                Lifecycle.Event.ON_DESTROY -> mapView.onDestroy()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        mapView.onStart()
        mapView.onResume()
        onDispose {
            lifecycle.removeObserver(observer)
            mapView.onPause()
            mapView.onStop()
            mapView.onDestroy()
        }
    }

    BoxWithConstraints(modifier = modifier) {
        AndroidView(
            factory = {
                mapView.getMapAsync { map ->
                    mapRef = map
                    map.addOnCameraMoveStartedListener { reason ->
                        if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) {
                            followGps.value = GpsCameraFollow.followingAfterMoveStarted(reason, followGps.value)
                            focusOnUser.value = false
                            onManualPan()
                        }
                    }
                    map.addOnMapClickListener { latLng ->
                        if (picking.value) {
                            followGps.value = false
                            onMapPick(latLng.latitude, latLng.longitude)
                            true
                        } else {
                            val screen = map.projection.toScreenLocation(latLng)
                            val hits = map.queryRenderedFeatures(
                                screen,
                                SurveyMapOverlays.LAYER_STOPS,
                                SurveyMapOverlays.LAYER_NEARBY,
                                SurveyMapOverlays.LAYER_SELECTED,
                            )
                            val id = hits.firstOrNull()?.getStringProperty(SurveyMapOverlays.PROP_STOP_ID)
                            if (id != null) {
                                stopFocusSeq.intValue += 1
                                onStopClick(id)
                                true
                            } else {
                                false
                            }
                        }
                    }
                    try {
                        val styleJson = OfflineBasemap.loadRewrittenStyle(context)
                        map.setStyle(Style.Builder().fromJson(styleJson)) { style ->
                            SurveyMapOverlays.applyCameraLimits(map)
                            SurveyMapOverlays.install(style)
                            styleRef = style
                        }
                    } catch (_: Exception) {
                        styleRef = null
                    }
                }
                mapView
            },
            modifier = Modifier.fillMaxSize(),
        )
        if (SurveyMapControlLayout.visible(sheetVisibleFraction)) {
            val selectedStop = stops.firstOrNull { it.stopPublicId == selectedStopPublicId }
            Column(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(
                        end = 10.dp,
                        bottom = (maxHeight * sheetVisibleFraction) + 10.dp,
                    ),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                MapControlButton(
                    icon = Icons.Outlined.MyLocation,
                    description = tr("Current location"),
                    enabled = true,
                    selected = followGps.value && followMode.value == MapFollowMode.LOCATE,
                    onClick = {
                        followMode.value = MapFollowPolicy.restore(MapFollowMode.LOCATE)
                        followGps.value = true
                        focusOnUser.value = true
                        onLocate()
                    },
                )
                MapControlButton(
                    icon = Icons.Outlined.Navigation,
                    description = tr("Follow heading"),
                    enabled = true,
                    selected = followGps.value && followMode.value == MapFollowMode.DIRECTION,
                    onClick = {
                        followMode.value = MapFollowPolicy.restore(MapFollowMode.DIRECTION)
                        followGps.value = true
                        focusOnUser.value = true
                        onLocate()
                    },
                )
                MapControlButton(
                    icon = Icons.Outlined.ZoomOutMap,
                    description = tr("Show location and selected stop"),
                    enabled = gps != null && selectedStop != null,
                    onClick = {
                        val map = mapRef ?: return@MapControlButton
                        val fix = gps ?: return@MapControlButton
                        val stop = selectedStop ?: return@MapControlButton
                        followGps.value = false
                        SurveyMapOverlays.fitGpsAndStop(map, fix, stop)
                    },
                )
                MapControlButton(
                    icon = Icons.Outlined.Route,
                    description = tr("Show whole route"),
                    enabled = pathCoordinates.isNotEmpty() || stops.isNotEmpty(),
                    onClick = {
                        val map = mapRef ?: return@MapControlButton
                        followGps.value = false
                        SurveyMapOverlays.fitRoute(map, pathCoordinates, stops)
                    },
                )
                MapControlButton(
                    icon = Icons.Outlined.Explore,
                    description = tr("Reset north"),
                    enabled = mapRef != null,
                    onClick = { mapRef?.let(SurveyMapOverlays::resetNorth) },
                )
            }
        }
    }

    LaunchedEffect(styleRef, variantPublicId, pathCoordinates, stops) {
        val style = styleRef ?: return@LaunchedEffect
        SurveyMapOverlays.setPath(style, pathCoordinates)
        SurveyMapOverlays.setStops(style, stops, selectedStopPublicId, nearbyStopPublicIds)
        val map = mapRef ?: return@LaunchedEffect
        if (variantPublicId != null && variantPublicId != fittedVariant) {
            if (SurveyMapOverlays.fitRoute(map, pathCoordinates, stops)) {
                fittedVariant = variantPublicId
            }
        }
    }

    LaunchedEffect(
        styleRef,
        stops,
        selectedStopPublicId,
        nearbyStopPublicIds,
        stopFocusSeq.intValue,
        sheetVisibleFraction,
    ) {
        val style = styleRef ?: return@LaunchedEffect
        val map = mapRef ?: return@LaunchedEffect
        SurveyMapOverlays.setStops(style, stops, selectedStopPublicId, nearbyStopPublicIds)
        val stop = stops.firstOrNull { it.stopPublicId == selectedStopPublicId } ?: return@LaunchedEffect
        followGps.value = false
        val zoom = GpsCameraFollow.stopFocusZoom(map.cameraPosition.zoom)
        SurveyMapOverlays.focusStop(map, stop.lat, stop.lng, zoom)
    }

    LaunchedEffect(styleRef, gps, anomalies, pickedPoint, displayHeading) {
        val style = styleRef ?: return@LaunchedEffect
        SurveyMapOverlays.setGps(style, gps, displayHeading)
        SurveyMapOverlays.setAnomalies(style, anomalies)
        SurveyMapOverlays.setPick(style, pickedPoint)
    }

    LaunchedEffect(styleRef, gps, centerOncePending) {
        val map = mapRef ?: return@LaunchedEffect
        val fix = gps ?: return@LaunchedEffect
        if (!centerOncePending) return@LaunchedEffect
        SurveyMapOverlays.followGps(map, fix, SurveyMapOverlays.GPS_ZOOM)
        lastCameraGps = fix
        lastCameraAtMs = SystemClock.elapsedRealtime()
        focusOnUser.value = false
        onCenterOnceConsumed()
    }

    LaunchedEffect(styleRef, gps, followGps.value, focusOnUser.value, followMode.value, displayHeading) {
        val map = mapRef ?: return@LaunchedEffect
        val headingUp = MapFollowPolicy.cameraHeadingUp(followMode.value, displayHeading != null)
        val nowMs = SystemClock.elapsedRealtime()
        val move = MapCameraThrottle.shouldApply(
            following = followGps.value,
            focusOnUser = focusOnUser.value,
            previous = lastCameraGps,
            next = gps,
            previousHeadingDeg = lastCameraHeading,
            nextHeadingDeg = displayHeading,
            lastAppliedAtMs = lastCameraAtMs,
            nowMs = nowMs,
            headingUp = headingUp,
        )
        if (move && gps != null) {
            val zoom = GpsCameraFollow.cameraZoom(focusOnUser.value, map.cameraPosition.zoom)
            val mapBearing = when {
                MapFollowPolicy.cameraNorthUp(followMode.value) -> 0.0
                headingUp -> displayHeading
                else -> null
            }
            SurveyMapOverlays.followGps(map, gps, zoom, mapBearingDeg = mapBearing)
            lastCameraGps = gps
            lastCameraHeading = displayHeading
            lastCameraAtMs = nowMs
            focusOnUser.value = false
        }
    }
}

@Composable
private fun MapControlButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    enabled: Boolean,
    onClick: () -> Unit,
    selected: Boolean = false,
) {
    FilledTonalButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.size(42.dp),
        shape = CircleShape,
        contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
        colors = ButtonDefaults.filledTonalButtonColors(
            containerColor = if (selected) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.secondaryContainer
            },
        ),
    ) {
        Icon(imageVector = icon, contentDescription = description, modifier = Modifier.size(20.dp))
    }
}
