package com.coremapmm.fieldsurveyor.media

/** EXIF orientation values. Display size after rotation; never forces portrait or landscape. */
object JpegOrientation {
    const val NORMAL = 1
    const val FLIP_HORIZONTAL = 2
    const val ROTATE_180 = 3
    const val FLIP_VERTICAL = 4
    const val TRANSPOSE = 5
    const val ROTATE_90 = 6
    const val TRANSVERSE = 7
    const val ROTATE_270 = 8

    fun swapsWidthHeight(orientation: Int): Boolean = orientation in setOf(TRANSPOSE, ROTATE_90, TRANSVERSE, ROTATE_270)

    fun displaySize(pixelWidth: Int, pixelHeight: Int, orientation: Int): Pair<Int, Int> {
        return if (swapsWidthHeight(orientation)) pixelHeight to pixelWidth else pixelWidth to pixelHeight
    }
}
