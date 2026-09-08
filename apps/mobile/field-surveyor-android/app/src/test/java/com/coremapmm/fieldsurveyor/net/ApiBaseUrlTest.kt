package com.coremapmm.fieldsurveyor.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ApiBaseUrlTest {
    @Test
    fun normalizeTrimsSlash() {
        assertEquals("http://127.0.0.1:3001", ApiBaseUrl.normalize(" http://127.0.0.1:3001/ "))
    }

    @Test
    fun usbAndEmulatorHelpers() {
        assertTrue(ApiBaseUrl.looksLikeUsbTunnel("http://127.0.0.1:3001"))
        assertTrue(ApiBaseUrl.looksLikeUsbTunnel("http://localhost:3001"))
        assertFalse(ApiBaseUrl.looksLikeUsbTunnel("http://172.21.39.36:3001"))
        assertTrue(ApiBaseUrl.looksLikeEmulatorLoopback("http://10.0.2.2:3001"))
        assertFalse(ApiBaseUrl.looksLikeEmulatorLoopback("http://127.0.0.1:3001"))
    }
}
