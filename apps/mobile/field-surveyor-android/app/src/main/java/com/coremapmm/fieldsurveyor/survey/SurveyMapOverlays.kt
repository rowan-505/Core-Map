package com.coremapmm.fieldsurveyor.survey

import android.graphics.Color
import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.FillLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point
import org.maplibre.geojson.Polygon
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

object SurveyMapOverlays {
    const val MIN_ZOOM = 3.0
    const val MAX_ZOOM = 20.0
    const val GPS_ZOOM = 16.0
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
    const val LAYER_SELECTED = "survey-selected-stop"
    const val LAYER_NEARBY = "survey-nearby-stops"
    const val LAYER_GPS = "survey-gps"
    const val LAYER_GPS_ACCURACY = "survey-gps-accuracy"
    const val LAYER_GPS_HEADING = "survey-gps-heading"
    const val LAYER_ANOMALIES = "survey-anomalies"
    const val PROP_STOP_ID = "stopPublicId"

    fun install(style: Style) {
        if (!styleFullyLoaded(style)) return
        val existing = try {
            style.getSource(SRC_PATH)
        } catch (_: IllegalStateException) {
            return
        }
        if (existing != null) {
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
        style.addLayer(
            CircleLayer(LAYER_ANOMALIES, SRC_ANOMALIES).withProperties( // markers only; no photo thumbnails
                PropertyFactory.circleColor(Color.parseColor("#FF6D00")),
                PropertyFactory.circleRadius(4.5f),
                PropertyFactory.circleStrokeColor(Color.WHITE),
                PropertyFactory.circleStrokeWidth(1f),
            ),
        )
        style.addLayer(
            FillLayer(LAYER_GPS_ACCURACY, SRC_GPS_ACCURACY).withProperties(
                PropertyFactory.fillColor(Color.parseColor("#00B8D4")),
                PropertyFactory.fillOpacity(0.16f),
                PropertyFactory.fillOutlineColor(Color.parseColor("#008FA3")),
            ),
        )
        style.addLayer(
            FillLayer(LAYER_GPS_HEADING, SRC_GPS_HEADING).withProperties(
                PropertyFactory.fillColor(Color.parseColor("#00838F")),
                PropertyFactory.fillOpacity(0.92f),
                PropertyFactory.fillOutlineColor(Color.WHITE),
            ),
        )
        style.addLayer(
            CircleLayer(LAYER_GPS, SRC_GPS).withProperties(
                PropertyFactory.circleColor(Color.parseColor("#00B8D4")),
                PropertyFactory.circleRadius(7f),
                PropertyFactory.circleStrokeColor(Color.WHITE),
                PropertyFactory.circleStrokeWidth(2f),
            ),
        )
        style.addLayer(
            CircleLayer(LAYER_PICK, SRC_PICK).withProperties(
                PropertyFactory.circleColor(Color.parseColor("#C2185B")),
                PropertyFactory.circleRadius(8f),
                PropertyFactory.circleStrokeColor(Color.WHITE),
                PropertyFactory.circleStrokeWidth(2f),
            ),
        )
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
    ) {
        val stopSource = geoJsonSource(style, SRC_STOPS) ?: return
        val selectedSource = geoJsonSource(style, SRC_SELECTED) ?: return
        val nearbySource = geoJsonSource(style, SRC_NEARBY) ?: return
        val features = stops.map { stop ->
            val feature = Feature.fromGeometry(Point.fromLngLat(stop.lng, stop.lat))
            feature.addStringProperty(PROP_STOP_ID, stop.stopPublicId)
            feature
        }
        stopSource.setGeoJson(FeatureCollection.fromFeatures(features))
        val nearbyFeatures = stops.filter { it.stopPublicId in nearbyStopPublicIds }.map { stop ->
            val feature = Feature.fromGeometry(Point.fromLngLat(stop.lng, stop.lat))
            feature.addStringProperty(PROP_STOP_ID, stop.stopPublicId)
            feature
        }
        nearbySource.setGeoJson(FeatureCollection.fromFeatures(nearbyFeatures))
        val selected = stops.firstOrNull { it.stopPublicId == selectedStopPublicId }
        if (selected == null) {
            selectedSource.setGeoJson(emptyCollection())
        } else {
            val feature = Feature.fromGeometry(Point.fromLngLat(selected.lng, selected.lat))
            feature.addStringProperty(PROP_STOP_ID, selected.stopPublicId)
            selectedSource.setGeoJson(FeatureCollection.fromFeature(feature))
        }
    }

    fun setGps(style: Style, gps: GpsFix?, headingDeg: Double? = null) {
        ensureGpsHeading(style)
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
        val ring = accuracyRing(gps)
        if (ring.isEmpty()) {
            accuracySource.setGeoJson(emptyCollection())
        } else {
            val polygon = Polygon.fromLngLats(
                listOf(ring.map { (lng, lat) -> Point.fromLngLat(lng, lat) }),
            )
            accuracySource.setGeoJson(FeatureCollection.fromFeature(Feature.fromGeometry(polygon)))
        }
        val chevron = if (headingDeg == null) emptyList() else headingChevron(gps, headingDeg)
        if (headingSource == null) {
            return
        }
        if (chevron.isEmpty()) {
            headingSource.setGeoJson(emptyCollection())
        } else {
            val polygon = Polygon.fromLngLats(
                listOf(chevron.map { (lng, lat) -> Point.fromLngLat(lng, lat) }),
            )
            headingSource.setGeoJson(FeatureCollection.fromFeature(Feature.fromGeometry(polygon)))
        }
    }

    fun ensureGpsHeading(style: Style) {
        if (!styleFullyLoaded(style)) return
        if (geoJsonSource(style, SRC_GPS_HEADING) != null) return
        try {
            style.addSource(GeoJsonSource(SRC_GPS_HEADING, emptyCollection()))
            val layer = FillLayer(LAYER_GPS_HEADING, SRC_GPS_HEADING).withProperties(
                PropertyFactory.fillColor(Color.parseColor("#00838F")),
                PropertyFactory.fillOpacity(0.92f),
                PropertyFactory.fillOutlineColor(Color.WHITE),
            )
            if (style.getLayer(LAYER_GPS) != null) {
                style.addLayerBelow(layer, LAYER_GPS)
            } else {
                style.addLayer(layer)
            }
        } catch (_: Exception) {
        }
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
