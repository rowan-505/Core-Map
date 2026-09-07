package com.coremapmm.fieldsurveyor.log

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FieldLogTest {
    @Test
    fun dropsSensitiveKeys() {
        val safe = FieldLog.sanitize(
            mapOf(
                "path" to "/field/bootstrap",
                "token" to "secret",
                "accessToken" to "abc",
                "email" to "a@b.c",
                "lat" to "16.8",
                "status" to "200",
            ),
        )
        assertEquals("/field/bootstrap", safe["path"])
        assertEquals("200", safe["status"])
        assertFalse(safe.containsKey("token"))
        assertFalse(safe.containsKey("accessToken"))
        assertFalse(safe.containsKey("email"))
        assertFalse(safe.containsKey("lat"))
    }

    @Test
    fun keepsShortNonSensitiveValues() {
        val safe = FieldLog.sanitize(mapOf("host" to "api.coremapmm.com"))
        assertEquals("api.coremapmm.com", safe["host"])
        assertTrue(safe.size == 1)
    }

    @Test
    fun dropsMediaUrlAndSignedQueryKeys() {
        val safe = FieldLog.sanitize(
            mapOf("media_url" to "https://storage/private?a=secret", "signedKey" to "secret"),
        )
        assertTrue(safe.isEmpty())
    }
}
