package com.coremapmm.fieldsurveyor.media

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.io.FileOutputStream

data class JpegCompressResult(
    val width: Int,
    val height: Int,
    val byteSize: Long,
    val elapsedMs: Long,
    val mimeType: String,
    val checksumSha256: String,
)

object JpegCompressor {
    fun compress(
        source: File,
        destination: File,
        usableSpaceBytes: Long = destination.parentFile?.usableSpace ?: Long.MAX_VALUE,
    ): JpegCompressResult {
        val started = System.nanoTime()
        destination.parentFile?.mkdirs()
        val free = destination.parentFile?.usableSpace ?: usableSpaceBytes
        if (minOf(usableSpaceBytes, free) < JpegTarget.MIN_FREE_BYTES) {
            error("Not enough storage for this photo.")
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.absolutePath, bounds)
        val srcW = bounds.outWidth
        val srcH = bounds.outHeight
        val orientation = runCatching {
            ExifInterface(source).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL,
            )
        }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
        val sample = JpegTarget.inSampleSize(srcW, srcH)
        val decoded = BitmapFactory.Options().run {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
            BitmapFactory.decodeFile(source.absolutePath, this)
        } ?: error("Could not decode photo")
        val oriented = applyOrientation(decoded, orientation)
        if (oriented !== decoded) {
            decoded.recycle()
        }
        val sampledW = oriented.width
        val sampledH = oriented.height
        val (outW, outH) = JpegTarget.outputSize(sampledW, sampledH)
        val scaled = if (outW == sampledW && outH == sampledH) {
            oriented
        } else {
            Bitmap.createScaledBitmap(oriented, outW, outH, true).also {
                if (it !== oriented) {
                    oriented.recycle()
                }
            }
        }
        FileOutputStream(destination).use { stream ->
            val ok = scaled.compress(Bitmap.CompressFormat.JPEG, JpegTarget.QUALITY, stream)
            if (!ok) {
                scaled.recycle()
                error("JPEG compress failed")
            }
        }
        scaled.recycle()
        val elapsedMs = (System.nanoTime() - started) / 1_000_000
        val size = destination.length()
        if (size <= 0L || size > JpegTarget.MAX_BYTES) {
            destination.delete()
            error("JPEG size out of range: $size")
        }
        return JpegCompressResult(
            width = outW,
            height = outH,
            byteSize = size,
            elapsedMs = elapsedMs,
            mimeType = JpegTarget.MIME_JPEG,
            checksumSha256 = MediaChecksum.sha256Hex(destination),
        )
    }

    fun loadPreview(file: File, maxEdge: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > maxEdge) {
            sample *= 2
        }
        val decoded = BitmapFactory.decodeFile(
            file.absolutePath,
            BitmapFactory.Options().apply { inSampleSize = sample },
        ) ?: return null
        val orientation = runCatching {
            ExifInterface(file).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL,
            )
        }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
        val oriented = applyOrientation(decoded, orientation)
        if (oriented !== decoded) {
            decoded.recycle()
        }
        return oriented
    }

    internal fun applyOrientation(bitmap: Bitmap, orientation: Int): Bitmap {
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.setRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.setRotate(-90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
            else -> return bitmap
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }
}
