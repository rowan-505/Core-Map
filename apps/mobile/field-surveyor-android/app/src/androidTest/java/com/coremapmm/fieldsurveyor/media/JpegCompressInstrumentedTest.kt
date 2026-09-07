package com.coremapmm.fieldsurveyor.media

import android.graphics.Bitmap
import android.graphics.Color
import androidx.exifinterface.media.ExifInterface
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream

@RunWith(AndroidJUnit4::class)
class JpegCompressInstrumentedTest {
    @Test
    fun noisyPhotoStaysInTargetSizeAndTime() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val source = File(context.cacheDir, "perf-source.jpg")
        val dest = File(context.cacheDir, "perf-out.jpg")
        val bitmap = Bitmap.createBitmap(3200, 2400, Bitmap.Config.ARGB_8888)
        val pixels = IntArray(3200 * 2400)
        var seed = 17
        for (i in pixels.indices) {
            seed = seed * 1103515245 + 12345
            val v = (seed ushr 16) and 0xFF
            pixels[i] = Color.rgb(v, (v * 3) and 0xFF, (v * 7) and 0xFF)
        }
        bitmap.setPixels(pixels, 0, 3200, 0, 0, 3200, 2400)
        FileOutputStream(source).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it) }
        bitmap.recycle()

        val result = JpegCompressor.compress(source, dest)
        val longest = maxOf(result.width, result.height)
        assertTrue("longest edge ${result.width}x${result.height}", longest in JpegTarget.MIN_LONG_EDGE..JpegTarget.MAX_LONG_EDGE)
        assertTrue("bytes ${result.byteSize}", result.byteSize in 80_000L..2_000_000L)
        assertTrue("elapsed ${result.elapsedMs}ms", result.elapsedMs < 8_000)
        assertEquals(JpegTarget.MIME_JPEG, result.mimeType)
        assertEquals(64, result.checksumSha256.length)
        assertEquals(result.byteSize, dest.length())
        android.util.Log.i("JpegCompress", "typical noisy 3200x2400 -> ${result.width}x${result.height} ${result.byteSize} bytes in ${result.elapsedMs}ms")
    }

    @Test
    fun portraitExifRotationBecomesLandscapePixels() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val source = File(context.cacheDir, "portrait-exif.jpg")
        val dest = File(context.cacheDir, "portrait-out.jpg")
        writeJpegWithExif(source, 900, 1600, ExifInterface.ORIENTATION_ROTATE_90)
        val result = JpegCompressor.compress(source, dest)
        assertEquals(1600, result.width)
        assertEquals(900, result.height)
        assertTrue(result.width > result.height)
    }

    @Test
    fun landscapeExifRotationBecomesPortraitPixels() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val source = File(context.cacheDir, "landscape-exif.jpg")
        val dest = File(context.cacheDir, "landscape-out.jpg")
        writeJpegWithExif(source, 1600, 900, ExifInterface.ORIENTATION_ROTATE_90)
        val result = JpegCompressor.compress(source, dest)
        assertEquals(900, result.width)
        assertEquals(1600, result.height)
        assertTrue(result.height > result.width)
    }

    @Test
    fun oversizedPhotoCapsLongEdgeAt2048() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val source = File(context.cacheDir, "oversize.jpg")
        val dest = File(context.cacheDir, "oversize-out.jpg")
        val bitmap = Bitmap.createBitmap(4096, 2304, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.rgb(40, 80, 120))
        FileOutputStream(source).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it) }
        bitmap.recycle()
        val result = JpegCompressor.compress(source, dest)
        assertEquals(2048, maxOf(result.width, result.height))
        assertEquals(1152, minOf(result.width, result.height))
    }

    @Test
    fun lowStorageFailsBeforeWriting() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val source = File(context.cacheDir, "low-src.jpg")
        val dest = File(context.cacheDir, "low-out.jpg")
        val bitmap = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888)
        FileOutputStream(source).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 80, it) }
        bitmap.recycle()
        dest.delete()
        val error = runCatching { JpegCompressor.compress(source, dest, usableSpaceBytes = 1024) }.exceptionOrNull()
        assertTrue(error?.message?.contains("Not enough storage") == true)
        assertTrue(!dest.isFile || dest.length() == 0L)
    }

    private fun writeJpegWithExif(file: File, width: Int, height: Int, orientation: Int) {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(if (width > height) Color.BLUE else Color.GREEN)
        FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
        bitmap.recycle()
        ExifInterface(file.absolutePath).apply {
            setAttribute(ExifInterface.TAG_ORIENTATION, orientation.toString())
            saveAttributes()
        }
    }
}
