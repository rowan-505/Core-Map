package com.coremapmm.fieldsurveyor.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class MediaChecksumTest {
    @Test
    fun hashesFileBytes() {
        val file = File.createTempFile("sum", ".bin").apply { writeBytes(byteArrayOf(1, 2, 3, 4)) }
        val hash = MediaChecksum.sha256Hex(file)
        assertEquals(64, hash.length)
        assertEquals(hash, MediaChecksum.sha256Hex(file))
        file.writeBytes(byteArrayOf(9))
        assertTrue(hash != MediaChecksum.sha256Hex(file))
    }
}
