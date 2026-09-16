package com.coremapmm.fieldsurveyor.survey

/** Fixed screen-space metrics for the compact self-location puck. */
object LocationPuck {
    const val COREMAP_BLUE = "#1A73E8"
    const val HALO_BLUE = "#64B5F6"
    const val BORDER_WHITE = "#FFFFFF"

    /** Dot + arrow footprint, excluding the accuracy halo. */
    const val TOTAL_SIZE_DP = 30f
    const val DOT_DIAMETER_DP = 14f
    const val DOT_BORDER_DP = 2.5f
    const val HALO_DIAMETER_DP = 46f
    const val ARROW_WIDTH_DP = 9f
    const val ARROW_HEIGHT_DP = 9f
    const val ARROW_GAP_DP = 1f
    const val ARROW_OUTLINE_DP = 1.25f
    const val HALO_OPACITY = 0.22f

    const val IMAGE_ARROW = "survey-location-puck-arrow"
    const val PROP_BEARING = "bearing"

    data class ScreenMetrics(
        val dotRadiusDp: Float,
        val dotBorderDp: Float,
        val haloRadiusDp: Float,
        val arrowWidthDp: Float,
        val arrowHeightDp: Float,
        val arrowGapDp: Float,
        val totalSizeDp: Float,
    )

    fun screenMetrics(): ScreenMetrics = ScreenMetrics(
        dotRadiusDp = DOT_DIAMETER_DP / 2f,
        dotBorderDp = DOT_BORDER_DP,
        haloRadiusDp = HALO_DIAMETER_DP / 2f,
        arrowWidthDp = ARROW_WIDTH_DP,
        arrowHeightDp = ARROW_HEIGHT_DP,
        arrowGapDp = ARROW_GAP_DP,
        totalSizeDp = TOTAL_SIZE_DP,
    )

    /** Screen-space metrics intentionally do not vary by map zoom. */
    fun screenMetricsAtZoom(zoom: Double): ScreenMetrics {
        require(zoom.isFinite()) { "zoom must be finite" }
        return screenMetrics()
    }

    fun showArrow(headingDeg: Double?): Boolean = headingDeg != null && headingDeg.isFinite()

    fun mapAlignedIconRotateDeg(headingDeg: Double): Double = SurveyHeading.normalize(headingDeg)

    /** Negative Y places the arrow immediately above the dot before rotation. */
    fun arrowIconOffsetDp(): FloatArray = floatArrayOf(
        0f,
        -(DOT_DIAMETER_DP / 2f + ARROW_GAP_DP),
    )

    fun layerOrder(): List<String> = listOf(
        SurveyMapOverlays.LAYER_GPS_ACCURACY,
        SurveyMapOverlays.LAYER_GPS,
        SurveyMapOverlays.LAYER_GPS_HEADING,
    )
}
