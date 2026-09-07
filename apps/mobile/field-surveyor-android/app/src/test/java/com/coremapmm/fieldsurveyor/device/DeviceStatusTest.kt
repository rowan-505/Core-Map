package com.coremapmm.fieldsurveyor.device

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceStatusTest {
    @Test
    fun flagsLowStorageBelowThreshold() {
        assertTrue(DeviceStatus.isLowStorage(50L * 1024L * 1024L))
        assertFalse(DeviceStatus.isLowStorage(DeviceStatus.LOW_STORAGE_BYTES))
        assertFalse(DeviceStatus.isLowStorage(500L * 1024L * 1024L))
    }
}
