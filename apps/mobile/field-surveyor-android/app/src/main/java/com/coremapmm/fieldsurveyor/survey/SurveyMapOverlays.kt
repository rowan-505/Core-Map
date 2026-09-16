package com.coremapmm.fieldsurveyor.survey

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.FillLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point
import org.maplibre.geojson.Polygon
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.sin

object SurveyMapOverlays {
    const val MIN_ZOOM = 3.0
    const val MAX_ZOOM = 20.0
    const val GPS_ZOOM = 16.0
    /** All selected-route stop labels appear from this zoom. */
    const val STOP_LABEL_ZOOM = 15.0
    /** Selected stop label stays readable below the dense-label zoom. */
    const val SELECTED_STOP_LABEL_ZOOM = 12.0
    /** Forgiving finger target around a rendered stop marker or label. */
    const val STOP_TAP_RADIUS_DP = 24f
    const val SRC_PATH = "survey-path-src"
    const val SRC_STOPS = "survey-stops-src"
    const val SRC_SELECTED = "survey-selected-stop-src"
    const val SRC_NEARBY = "survey-nearby-stops-src"
    const val SRC_GPS = "survey-gps-src"
    const val SRC_GPS_ACCURACY = "survey-gps-accuracy-src"
    const val SRC_GPS_HEADING = "survey-gps-heading-src"
    const val SRC_PICK = "survey-pick-src"
    const val LAYER_PICK = "survey-pick"
    const val SRC_ANOMALIES = "survey-anomalies-src"
    const val LAYER_PATH = "survey-path"
    const val LAYER_STOPS = "survey-stops"
    const val LAYER_STOP_LABELS = "survey-stop-labels"
    const val LAYER_SELECTED = "survey-selected-stop"
    const val LAYER_SELECTED_STOP_LABEL = "survey-selected-stop-label"
    const val LAYER_NEARBY = "survey-nearby-stops"
    const val LAYER_GPS = "survey-gps"
    const val LAYER_GPS_ACCURACY = "survey-gps-accuracy"
    const val LAYER_GPS_HEADING = "survey-gps-heading"
    const val LAYER_ANOMALIES = "survey-anomalies"
    /** Legacy click property; keep in sync with [PROP_STOP_ID]. */
    const val PROP_STOP_PUBLIC_ID = "stopPublicId"
    const val PROP_STOP_ID = "stop_id"
    const val PROP_STOP_SEQUENCE = "stop_sequence"
    const val PROP_DISPLAY_NAME = "display_name"
    const val PROP_LABEL = "label"
    const val PROP_SELECTED = "selected"
    const val PROP_REPORTED = "reported"
    val STOP_LABEL_FONT = arrayOf("NotoSansMyanmar-Regular")
    /** Layers that can receive a stop-select tap (points + labels). */
    val STOP_HIT_LAYERS = arrayOf(
        LAYER_SELECTED_STOP_LABEL,
        LAYER_SELECTED,
        LAYER_STOP_LABELS,
        LAYER_NEARBY,
        LAYER_STOPS,
    )

    fun stopTapRadiusPx(density: Float): Float = STOP_TAP_RADIUS_DP * density.coerceAtLeast(1f)

    fun install(style: Style, density: Float = 1f) {
        if (!styleFullyLoaded(style)) return
        val existing = try {
            style.getSource(SRC_PATH)
        } catch (_: IllegalStateException) {
            return
        }
        if (existing != null) {
            ensureLocationPuck(style, density)
            ensureStopLabelLayers(style)
            return
        }
        style.addSource(GeoJsonSource(SRC_PATH, emptyCollection()))
        style.addSource(GeoJsonSource(SRC_STOPS, emptyCollection()))
        style.addSource(GeoJsonSource(SRC_SELECTED, emptyCollection()))
        style.addSource(GeoJsonSource(SRC_NEARBY, emptyCollection()))
        style.addSource(GeoJsonSource(SRC_GPS, emptyCollection()))
        style.addSource(GeoJsonSource(SRC_GPS_ACCURACY, emptyCollection()))
        style.addSource(GeoJsonSource(SRC_GPS_HEADING, emptyCollection()))
        style.addSource(GeoJsonSource(SRC_PICK, emptyCollection()))
        style.addSource(GeoJsonSource(SRC_ANOMALIES, emptyCollection()))
        style.addLayer(
            LineLayer(LAYER_PATH, SRC_PATH).withProperties(
                PropertyFactory.lineColor(Color.parseColor("#1565C0")),
                PropertyFactory.lineWidth(4f),
                PropertyFactory.lineOpacity(0.9f),
            ),
        )
        style.addLayer(
            CircleLayer(LAYER_STOPS, SRC_STOPS).withProperties(
                PropertyFactory.circleColor(Color.parseColor("#424242")),
                PropertyFactory.circleRadius(5f),
                PropertyFactory.circleStrokeColor(Color.WHITE),
                PropertyFactory.circleStrokeWidth(1.2f),
            ),
        )
        style.addLayer(
            CircleLayer(LAYER_NEARBY, SRC_NEARBY).withProperties(
                PropertyFactory.circleColor(Color.parseColor("#26D6B2")),
                PropertyFactory.circleRadius(7f),
                PropertyFactory.circleStrokeColor(Color.WHITE),
                PropertyFactory.circleStrokeWidth(1.8f),
            ),
        )
        style.addLayer(
            CircleLayer(LAYER_SELECTED, SRC_SELECTED).withProperties(
                PropertyFactory.circleColor(Color.parseColor("#FFE082")),
                PropertyFactory.circleRadius(9f),
                PropertyFactory.circleStrokeColor(Color.WHITE),
                PropertyFactory.circleStrokeWidth(2f),
            ),
        )
        addStopLabelLayers(style)
        style.addLayer(
            CircleLayer(LAYER_ANOMALIES, SRC_ANOMALIES).withProperties( // markers only; no photo thumbnails
                PropertyFactory.circleColor(Color.parseColor("#FF6D00")),
                PropertyFactory.circleRadius(4.5f),
                PropertyFactory.circleStrokeColor(Color.WHITE),
                PropertyFactory.circleStrokeWidth(1f),
            ),
        )
        // Fixed screen-space puck: bounded halo → blue dot → optional heading arrow.
        addLocationPuckLayers(style, density)
        style.addLayer(
            CircleLayer(LAYER_PICK, SRC_PICK).withProperties(
                PropertyFactory.circleColor(Color.parseColor("#C2185B")),
                PropertyFactory.circleRadius(8f),
                PropertyFactory.circleStrokeColor(Color.WHITE),
                PropertyFactory.circleStrokeWidth(2f),
            ),
        )
    }

    private fun addLocationPuckLayers(style: Style, density: Float) {
        val metrics = LocationPuck.screenMetrics()
        ensureArrowImage(style, density)
        if (style.getLayer(LAYER_GPS_ACCURACY) == null) {
            style.addLayer(
                CircleLayer(LAYER_GPS_ACCURACY, SRC_GPS).withProperties(
                    PropertyFactory.circleColor(Color.parseColor(LocationPuck.HALO_BLUE)),
                    PropertyFactory.circleRadius(metrics.haloRadiusDp),
                    PropertyFactory.circleOpacity(LocationPuck.HALO_OPACITY),
                    PropertyFactory.circlePitchAlignment(Property.CIRCLE_PITCH_ALIGNMENT_VIEWPORT),
                ),
            )
        }
        if (style.getLayer(LAYER_GPS) == null) {
            style.addLayer(
                CircleLayer(LAYER_GPS, SRC_GPS).withProperties(
                    PropertyFactory.circleColor(Color.parseColor(LocationPuck.COREMAP_BLUE)),
                    PropertyFactory.circleRadius(metrics.dotRadiusDp),
                    PropertyFactory.circleStrokeColor(Color.parseColor(LocationPuck.BORDER_WHITE)),
                    PropertyFactory.circleStrokeWidth(metrics.dotBorderDp),
                    PropertyFactory.circlePitchAlignment(Property.CIRCLE_PITCH_ALIGNMENT_VIEWPORT),
                ),
            )
        }
        if (style.getLayer(LAYER_GPS_HEADING) == null) {
            style.addLayer(
                SymbolLayer(LAYER_GPS_HEADING, SRC_GPS_HEADING).withProperties(
                    PropertyFactory.iconImage(LocationPuck.IMAGE_ARROW),
                    PropertyFactory.iconSize(1f),
                    PropertyFactory.iconAllowOverlap(true),
                    PropertyFactory.iconIgnorePlacement(true),
                    PropertyFactory.iconOptional(false),
                    PropertyFactory.iconRotationAlignment(Property.ICON_ROTATION_ALIGNMENT_MAP),
                    PropertyFactory.iconPitchAlignment(Property.ICON_PITCH_ALIGNMENT_VIEWPORT),
                    PropertyFactory.iconAnchor(Property.ICON_ANCHOR_BOTTOM),
                    PropertyFactory.iconOffset(LocationPuck.arrowIconOffsetDp().toTypedArray()),
                    PropertyFactory.iconRotate(Expression.get(LocationPuck.PROP_BEARING)),
                ),
            )
        }
    }

    fun ensureLocationPuck(style: Style, density: Float = 1f) {
        if (!styleFullyLoaded(style)) return
        try {
            if (geoJsonSource(style, SRC_GPS) == null) {
                style.addSource(GeoJsonSource(SRC_GPS, emptyCollection()))
            }
            if (geoJsonSource(style, SRC_GPS_HEADING) == null) {
                style.addSource(GeoJsonSource(SRC_GPS_HEADING, emptyCollection()))
            }
            // Remove any geographic regression layers before installing the fixed puck.
            style.getLayer(LAYER_GPS_ACCURACY)?.let { layer ->
                if (layer !is CircleLayer) style.removeLayer(LAYER_GPS_ACCURACY)
            }
            style.getLayer(LAYER_GPS_HEADING)?.let { layer ->
                if (layer !is SymbolLayer) style.removeLayer(LAYER_GPS_HEADING)
            }
            addLocationPuckLayers(style, density)
        } catch (_: Exception) {
        }
    }

    fun ensureArrowImage(style: Style, density: Float) {
        if (!styleFullyLoaded(style)) return
        try {
            if (style.getImage(LocationPuck.IMAGE_ARROW) == null) {
                style.addImage(LocationPuck.IMAGE_ARROW, createArrowBitmap(density), false)
            }
        } catch (_: Exception) {
        }
    }

    /** Small original blue chevron with a white edge; the tip initially points north. */
    fun createArrowBitmap(density: Float): Bitmap {
        val d = density.coerceAtLeast(0.5f)
        val metrics = LocationPuck.screenMetrics()
        val outline = LocationPuck.ARROW_OUTLINE_DP * d
        val widthPx = ceil((metrics.arrowWidthDp + LocationPuck.ARROW_OUTLINE_DP * 2f) * d)
            .toInt().coerceAtLeast(8)
        val heightPx = ceil((metrics.arrowHeightDp + LocationPuck.ARROW_OUTLINE_DP * 2f) * d)
            .toInt().coerceAtLeast(8)
        val bitmap = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val path = Path().apply {
            moveTo(widthPx / 2f, outline)
            lineTo(widthPx - outline, heightPx - outline)
            lineTo(widthPx / 2f, heightPx - outline * 2.2f)
            lineTo(outline, heightPx - outline)
            close()
        }
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            color = Color.parseColor(LocationPuck.BORDER_WHITE)
            strokeWidth = outline.coerceAtLeast(1f)
            strokeJoin = Paint.Join.ROUND
        }
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = Color.parseColor(LocationPuck.COREMAP_BLUE)
        }
        canvas.drawPath(path, stroke)
        canvas.drawPath(path, fill)
        return bitmap
    }

    private fun addStopLabelLayers(style: Style) {
        if (style.getLayer(LAYER_STOP_LABELS) == null) {
            val normalLabels = SymbolLayer(LAYER_STOP_LABELS, SRC_STOPS).withProperties(
                PropertyFactory.textField(Expression.get(PROP_LABEL)),
                PropertyFactory.textFont(STOP_LABEL_FONT),
                PropertyFactory.textSize(11f),
                PropertyFactory.textColor(Color.parseColor("#37474F")),
                PropertyFactory.textHaloColor(Color.WHITE),
                PropertyFactory.textHaloWidth(1.4f),
                PropertyFactory.textHaloBlur(0.2f),
                PropertyFactory.textOffset(arrayOf(0f, 1.15f)),
                PropertyFactory.textAnchor(Property.TEXT_ANCHOR_TOP),
                PropertyFactory.textMaxWidth(7f),
                PropertyFactory.textJustify(Property.TEXT_JUSTIFY_CENTER),
                PropertyFactory.textAllowOverlap(false),
                PropertyFactory.textIgnorePlacement(false),
                PropertyFactory.textOptional(true),
                PropertyFactory.textPadding(2f),
                PropertyFactory.symbolSortKey(Expression.get(PROP_STOP_SEQUENCE)),
            ).withFilter(
                Expression.neq(Expression.get(PROP_SELECTED), Expression.literal(1)),
            )
            normalLabels.minZoom = STOP_LABEL_ZOOM.toFloat()
            style.addLayer(normalLabels)
        }
        if (style.getLayer(LAYER_SELECTED_STOP_LABEL) == null) {
            // Above normal labels so the selected stop wins collisions and stays readable.
            val selectedLabel = SymbolLayer(LAYER_SELECTED_STOP_LABEL, SRC_SELECTED).withProperties(
                PropertyFactory.textField(Expression.get(PROP_LABEL)),
                PropertyFactory.textFont(STOP_LABEL_FONT),
                PropertyFactory.textSize(12.5f),
                PropertyFactory.textColor(Color.parseColor("#1B5E20")),
                PropertyFactory.textHaloColor(Color.WHITE),
                PropertyFactory.textHaloWidth(1.8f),
                PropertyFactory.textHaloBlur(0.25f),
                PropertyFactory.textOffset(arrayOf(0f, 1.2f)),
                PropertyFactory.textAnchor(Property.TEXT_ANCHOR_TOP),
                PropertyFactory.textMaxWidth(8f),
                PropertyFactory.textJustify(Property.TEXT_JUSTIFY_CENTER),
                PropertyFactory.textAllowOverlap(true),
                PropertyFactory.textIgnorePlacement(true),
                PropertyFactory.textOptional(false),
            )
            selectedLabel.minZoom = SELECTED_STOP_LABEL_ZOOM.toFloat()
            style.addLayer(selectedLabel)
        }
    }

    fun ensureStopLabelLayers(style: Style) {
        if (!styleFullyLoaded(style)) return
        try {
            addStopLabelLayers(style)
        } catch (_: Exception) {
        }
    }

    /** Pure label copy: `#sequence Display name`. */
    fun stopLabelText(sequenceLabel: String, displayName: String): String =
        "$sequenceLabel $displayName".trim()

    fun stopFeature(
        stop: OrderedStopRow,
        sequences: List<Int>,
        selectedStopPublicId: String?,
        reportedStopIds: Set<String>,
        preferMyanmar: Boolean,
    ): Feature {
        val sequenceLabel = StopSequenceDisplay.uiLabel(stop.stopSequence, sequences)
        val displayName = SurveyStopStripModel.displayName(stop.nameMy, stop.nameEn, preferMyanmar)
        val selected = stop.stopPublicId == selectedStopPublicId
        val feature = Feature.fromGeometry(Point.fromLngLat(stop.lng, stop.lat))
        feature.addStringProperty(PROP_STOP_ID, stop.stopPublicId)
        feature.addStringProperty(PROP_STOP_PUBLIC_ID, stop.stopPublicId)
        feature.addNumberProperty(PROP_STOP_SEQUENCE, stop.stopSequence)
        feature.addStringProperty(PROP_DISPLAY_NAME, displayName)
        feature.addStringProperty(PROP_LABEL, stopLabelText(sequenceLabel, displayName))
        feature.addNumberProperty(PROP_SELECTED, if (selected) 1 else 0)
        feature.addNumberProperty(PROP_REPORTED, if (stop.stopPublicId in reportedStopIds) 1 else 0)
        return feature
    }

    fun stopIdFromFeature(feature: Feature): String? {
        return feature.getStringProperty(PROP_STOP_ID)
            ?.takeIf { it.isNotBlank() }
            ?: feature.getStringProperty(PROP_STOP_PUBLIC_ID)?.takeIf { it.isNotBlank() }
    }

    fun setPath(style: Style, coordinates: List<Pair<Double, Double>>) {
        val source = geoJsonSource(style, SRC_PATH) ?: return
        if (coordinates.size < 2) {
            source.setGeoJson(emptyCollection())
            return
        }
        val line = LineString.fromLngLats(coordinates.map { Point.fromLngLat(it.first, it.second) })
        source.setGeoJson(FeatureCollection.fromFeature(Feature.fromGeometry(line)))
    }

    fun setStops(
        style: Style,
        stops: List<OrderedStopRow>,
        selectedStopPublicId: String?,
        nearbyStopPublicIds: Set<String> = emptySet(),
        reportedStopIds: Set<String> = emptySet(),
        preferMyanmar: Boolean = true,
    ) {
        ensureStopLabelLayers(style)
        val stopSource = geoJsonSource(style, SRC_STOPS) ?: return
        val selectedSource = geoJsonSource(style, SRC_SELECTED) ?: return
        val nearbySource = geoJsonSource(style, SRC_NEARBY) ?: return
        val ordered = StopContext.ordered(stops)
        val sequences = ordered.map { it.stopSequence }
        val features = ordered.map { stop ->
            stopFeature(
                stop = stop,
                sequences = sequences,
                selectedStopPublicId = selectedStopPublicId,
                reportedStopIds = reportedStopIds,
                preferMyanmar = preferMyanmar,
            )
        }
        stopSource.setGeoJson(FeatureCollection.fromFeatures(features))
        val nearbyFeatures = ordered.filter { it.stopPublicId in nearbyStopPublicIds }.map { stop ->
            stopFeature(
                stop = stop,
                sequences = sequences,
                selectedStopPublicId = selectedStopPublicId,
                reportedStopIds = reportedStopIds,
                preferMyanmar = preferMyanmar,
            )
        }
        nearbySource.setGeoJson(FeatureCollection.fromFeatures(nearbyFeatures))
        val selected = ordered.firstOrNull { it.stopPublicId == selectedStopPublicId }
        if (selected == null) {
            selectedSource.setGeoJson(emptyCollection())
        } else {
            selectedSource.setGeoJson(
                FeatureCollection.fromFeature(
                    stopFeature(
                        stop = selected,
                        sequences = sequences,
                        selectedStopPublicId = selectedStopPublicId,
                        reportedStopIds = reportedStopIds,
                        preferMyanmar = preferMyanmar,
                    ),
                ),
            )
        }
    }

    /** Updates the fixed screen-space puck; GPS accuracy remains numeric in the survey chip. */
    fun setGps(style: Style, gps: GpsFix?, headingDeg: Double? = null) {
        ensureLocationPuck(style)
        val source = geoJsonSource(style, SRC_GPS) ?: return
        val accuracySource = geoJsonSource(style, SRC_GPS_ACCURACY) ?: return
        val headingSource = geoJsonSource(style, SRC_GPS_HEADING)
        if (gps == null) {
            source.setGeoJson(emptyCollection())
            accuracySource.setGeoJson(emptyCollection())
            headingSource?.setGeoJson(emptyCollection())
            return
        }
        source.setGeoJson(
            FeatureCollection.fromFeature(
                Feature.fromGeometry(Point.fromLngLat(gps.lng, gps.lat)),
            ),
        )
        // The former geographic accuracy polygon could cover the map on weak fixes.
        accuracySource.setGeoJson(emptyCollection())
        if (headingSource == null) {
            return
        }
        if (!LocationPuck.showArrow(headingDeg)) {
            headingSource.setGeoJson(emptyCollection())
        } else {
            headingSource.setGeoJson(
                FeatureCollection.fromFeature(headingArrowFeature(gps, headingDeg!!)),
            )
        }
    }

    fun headingArrowFeature(gps: GpsFix, headingDeg: Double): Feature =
        Feature.fromGeometry(Point.fromLngLat(gps.lng, gps.lat)).apply {
            addNumberProperty(
                LocationPuck.PROP_BEARING,
                LocationPuck.mapAlignedIconRotateDeg(headingDeg),
            )
        }

    /** Closed triangle pointing along [headingDeg], as (longitude, latitude) pairs. */
    fun headingChevron(
        gps: GpsFix,
        headingDeg: Double,
        tipMeters: Double = 16.0,
        halfWidthMeters: Double = 7.5,
    ): List<Pair<Double, Double>> {
        val heading = SurveyHeading.normalize(headingDeg)
        val tip = destination(gps.lat, gps.lng, heading, tipMeters)
        val left = destination(gps.lat, gps.lng, heading + 150.0, halfWidthMeters)
        val right = destination(gps.lat, gps.lng, heading - 150.0, halfWidthMeters)
        return listOf(tip, left, right, tip)
    }

    /** Returns a geodesic accuracy ring as (longitude, latitude) pairs. */
    fun accuracyRing(gps: GpsFix, vertices: Int = 48): List<Pair<Double, Double>> {
        val radiusM = gps.accuracyM?.toDouble()?.takeIf { it > 0.0 } ?: return emptyList()
        val count = vertices.coerceAtLeast(8)
        val ring = (0 until count).map { index ->
            val bearingDeg = 360.0 * index / count
            destination(gps.lat, gps.lng, bearingDeg, radiusM)
        }
        return ring + ring.first()
    }

    fun destination(lat: Double, lng: Double, bearingDeg: Double, meters: Double): Pair<Double, Double> {
        val angularDistance = meters / EARTH_RADIUS_M
        val bearing = Math.toRadians(SurveyHeading.normalize(bearingDeg))
        val lat1 = Math.toRadians(lat)
        val lng1 = Math.toRadians(lng)
        val lat2 = asin(
            sin(lat1) * cos(angularDistance) +
                cos(lat1) * sin(angularDistance) * cos(bearing),
        )
        val lng2 = lng1 + atan2(
            sin(bearing) * sin(angularDistance) * cos(lat1),
            cos(angularDistance) - sin(lat1) * sin(lat2),
        )
        return Math.toDegrees(lng2) to Math.toDegrees(lat2)
    }

    fun setAnomalies(style: Style, points: List<GpsFix>) {
        val source = geoJsonSource(style, SRC_ANOMALIES) ?: return
        val features = points.map {
            Feature.fromGeometry(Point.fromLngLat(it.lng, it.lat))
        }
        source.setGeoJson(FeatureCollection.fromFeatures(features))
    }

    fun setPick(style: Style, point: GpsFix?) {
        val source = geoJsonSource(style, SRC_PICK) ?: return
        if (point == null) {
            source.setGeoJson(emptyCollection())
            return
        }
        source.setGeoJson(
            FeatureCollection.fromFeature(
                Feature.fromGeometry(Point.fromLngLat(point.lng, point.lat)),
            ),
        )
    }

    fun applyCameraLimits(map: MapLibreMap) {
        map.setMinZoomPreference(MIN_ZOOM)
        map.setMaxZoomPreference(MAX_ZOOM)
        val settings = map.uiSettings
        settings.isRotateGesturesEnabled = true
        settings.isTiltGesturesEnabled = false
        settings.isZoomGesturesEnabled = true
        settings.isScrollGesturesEnabled = true
        settings.isDoubleTapGesturesEnabled = true
        settings.isQuickZoomGesturesEnabled = true
        settings.isCompassEnabled = false
        settings.isAttributionEnabled = true
        settings.isLogoEnabled = false
    }

    fun fitPathOnce(map: MapLibreMap, coordinates: List<Pair<Double, Double>>) {
        fitRoute(map, coordinates, emptyList())
    }

    /** Path pairs are (lng, lat). Includes every stop even if it sits off the drawn path. */
    fun routeFitLatLngs(
        pathCoordinates: List<Pair<Double, Double>>,
        stops: List<OrderedStopRow>,
    ): List<LatLng> {
        val points = ArrayList<LatLng>(pathCoordinates.size + stops.size)
        pathCoordinates.forEach { points.add(LatLng(it.second, it.first)) }
        stops.forEach { points.add(LatLng(it.lat, it.lng)) }
        return points
    }

    fun fitRoute(
        map: MapLibreMap,
        pathCoordinates: List<Pair<Double, Double>>,
        stops: List<OrderedStopRow>,
    ): Boolean {
        val points = routeFitLatLngs(pathCoordinates, stops)
        if (points.isEmpty()) {
            return false
        }
        if (points.size == 1) {
            val only = points.first()
            focusStop(map, only.latitude, only.longitude, GPS_ZOOM)
            return true
        }
        val bounds = LatLngBounds.Builder()
        points.forEach { bounds.include(it) }
        map.easeCamera(CameraUpdateFactory.newLatLngBounds(bounds.build(), 72), 700)
        return true
    }

    fun followGps(
        map: MapLibreMap,
        gps: GpsFix,
        zoom: Double,
        durationMs: Int = 450,
        mapBearingDeg: Double? = null,
    ) {
        val builder = CameraPosition.Builder(map.cameraPosition)
            .target(LatLng(gps.lat, gps.lng))
            .zoom(zoom)
        if (mapBearingDeg != null) {
            builder.bearing(mapBearingDeg)
        }
        map.easeCamera(CameraUpdateFactory.newCameraPosition(builder.build()), durationMs)
    }

    fun flyToGpsOnce(map: MapLibreMap, gps: GpsFix) {
        followGps(map, gps, GPS_ZOOM, 500)
    }

    fun focusStop(map: MapLibreMap, lat: Double, lng: Double, zoom: Double) {
        map.easeCamera(
            CameraUpdateFactory.newLatLngZoom(LatLng(lat, lng), zoom),
            450,
        )
    }

    fun fitGpsAndStop(map: MapLibreMap, gps: GpsFix, stop: OrderedStopRow) {
        val samePoint = kotlin.math.abs(gps.lat - stop.lat) < 0.000001 &&
            kotlin.math.abs(gps.lng - stop.lng) < 0.000001
        if (samePoint) {
            focusStop(map, stop.lat, stop.lng, GPS_ZOOM)
            return
        }
        val bounds = LatLngBounds.Builder()
            .include(LatLng(gps.lat, gps.lng))
            .include(LatLng(stop.lat, stop.lng))
            .build()
        map.easeCamera(CameraUpdateFactory.newLatLngBounds(bounds, 72), 500)
    }

    fun resetNorth(map: MapLibreMap) {
        val position = CameraPosition.Builder(map.cameraPosition)
            .bearing(0.0)
            .tilt(0.0)
            .build()
        map.easeCamera(CameraUpdateFactory.newCameraPosition(position), 350)
    }

    private fun emptyCollection(): FeatureCollection = FeatureCollection.fromFeatures(emptyArray())

    private fun styleFullyLoaded(style: Style): Boolean {
        return try {
            style.isFullyLoaded
        } catch (_: Exception) {
            false
        }
    }

    private fun geoJsonSource(style: Style, id: String): GeoJsonSource? {
        if (!styleFullyLoaded(style)) return null
        return try {
            style.getSourceAs(id)
        } catch (_: IllegalStateException) {
            null
        }
    }

    private const val EARTH_RADIUS_M = 6_371_000.0
}
