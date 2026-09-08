package com.coremapmm.fieldsurveyor.survey

/**
 * Screen-space CoreMap location puck (Naver-like shape, original drawing).
 * Glow, circle and arrow use fixed dp sizes — never geographic metres.
 */
object LocationPuck {
    const val COREMAP_BLUE = "#1565C0"
    const val GLOW_BLUE = "#64B5F6"
    const val CENTRE_WHITE = "#FFFFFF"
    const val ARROW_OUTLINE_WHITE = "#FFFFFF"

    /** Total puck footprint target (~40 dp). */
    const val TOTAL_SIZE_DP = 40f
    const val CIRCLE_DIAMETER_DP = 22f
    const val CIRCLE_BORDER_DP = 3.5f
    const val GLOW_DIAMETER_DP = 40f
    const val ARROW_WIDTH_DP = 11f
    const val ARROW_HEIGHT_DP = 12f
    const val ARROW_GAP_DP = 1f
    const val ARROW_OUTLINE_DP = 1.5f

    const val GLOW_OPACITY = 0.28f
    const val IMAGE_ARROW = "survey-location-puck-arrow"
    const val PROP_BEARING = "bearing"

    /** Readable survey zoom band; size does not change with zoom. */
    val READABLE_ZOOM_MIN = 5.0
    val READABLE_ZOOM_MAX = 20.0

    data class ScreenMetrics(
        val circleRadiusDp: Float,
        val circleBorderDp: Float,
        val glowRadiusDp: Float,
        val arrowWidthDp: Float,
        val arrowHeightDp: Float,
        val arrowGapDp: Float,
        val totalSizeDp: Float,
    )

    fun screenMetrics(): ScreenMetrics = ScreenMetrics(
        circleRadiusDp = CIRCLE_DIAMETER_DP / 2f,
        circleBorderDp = CIRCLE_BORDER_DP,
        glowRadiusDp = GLOW_DIAMETER_DP / 2f,
        arrowWidthDp = ARROW_WIDTH_DP,
        arrowHeightDp = ARROW_HEIGHT_DP,
        arrowGapDp = ARROW_GAP_DP,
        totalSizeDp = TOTAL_SIZE_DP,
    )

    /** Same metrics at every zoom — proves screen-space sizing. */
    fun screenMetricsAtZoom(zoom: Double): ScreenMetrics {
        require(zoom.isFinite()) { "zoom must be finite" }
        return screenMetrics()
    }

    fun isReadableAtZoom(zoom: Double): Boolean =
        zoom in READABLE_ZOOM_MIN..READABLE_ZOOM_MAX

    fun showArrow(headingDeg: Double?): Boolean = headingDeg != null && headingDeg.isFinite()

    /**
     * Icon rotate for [Property.ICON_ROTATION_ALIGNMENT_MAP].
     * MapLibre keeps the arrow aligned to geographic heading when the camera bearing changes.
     */
    fun mapAlignedIconRotateDeg(headingDeg: Double): Double =
        SurveyHeading.normalize(headingDeg)

    /**
     * Apparent screen angle of the arrow when the map camera is rotated.
     * heading 0° + camera bearing 90° → arrow points left on screen (toward geographic north).
     */
    fun screenHeadingDeg(headingDeg: Double, cameraBearingDeg: Double): Double =
        SurveyHeading.normalize(headingDeg - cameraBearingDeg)

    /** Viewport-aligned rotate if a caller prefers explicit camera compensation. */
    fun viewportAlignedIconRotateDeg(headingDeg: Double, cameraBearingDeg: Double): Double =
        screenHeadingDeg(headingDeg, cameraBearingDeg)

    /**
     * Offset from circle centre to arrow base, along heading ("up" in the icon).
     * Negative Y is toward the tip before rotation.
     */
    fun arrowIconOffsetDp(): FloatArray {
        val metrics = screenMetrics()
        val along = metrics.circleRadiusDp + metrics.arrowGapDp
        return floatArrayOf(0f, -along)
    }

    /** Render order above accuracy / route / stops; pick stays higher for edit taps. */
    fun layerOrderAboveAccuracy(): List<String> = listOf(
        SurveyMapOverlays.LAYER_GPS_ACCURACY,
        SurveyMapOverlays.LAYER_GPS_GLOW,
        SurveyMapOverlays.LAYER_GPS,
        SurveyMapOverlays.LAYER_GPS_HEADING,
    )

    fun usesGeographicArrowMeters(): Boolean = false

    fun hidesWithMinZoomOrOpacityRules(): Boolean = false

    fun ignoresLabelCollision(): Boolean = true

    /** Manual pan stops camera follow only; puck data keeps updating. */
    fun continuesUpdatingAfterManualPan(): Boolean = true
}
