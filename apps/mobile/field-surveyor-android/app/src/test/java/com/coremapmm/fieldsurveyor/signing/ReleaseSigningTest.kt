package com.coremapmm.fieldsurveyor.signing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReleaseSigningTest {
    private val completeFile = mapOf(
        ReleaseSigning.STORE_FILE to "/secure/coremap-internal-release.jks",
        ReleaseSigning.STORE_PASSWORD to "store-secret",
        ReleaseSigning.KEY_ALIAS to "coremap-release",
        ReleaseSigning.KEY_PASSWORD to "key-secret",
    )

    @Test
    fun completeEnvironmentWinsOverFile() {
        val env = mapOf(
            ReleaseSigning.ENV_STORE_FILE to "/env/release.jks",
            ReleaseSigning.ENV_STORE_PASSWORD to "env-store",
            ReleaseSigning.ENV_KEY_ALIAS to "env-alias",
            ReleaseSigning.ENV_KEY_PASSWORD to "env-key",
        )
        val (values, source) = ReleaseSigning.selectedValues(env, completeFile)
        assertEquals("environment", source)
        assertEquals("/env/release.jks", values[ReleaseSigning.STORE_FILE])
        assertTrue(ReleaseSigning.canCreateSigningConfig(values) { it == "/env/release.jks" })
    }

    @Test
    fun incompleteEnvironmentFallsThroughToFileWithoutMixing() {
        val env = mapOf(ReleaseSigning.ENV_STORE_FILE to "/env/release.jks")
        val (values, source) = ReleaseSigning.selectedValues(env, completeFile)
        assertEquals("keystore.properties", source)
        assertEquals("/secure/coremap-internal-release.jks", values[ReleaseSigning.STORE_FILE])
        assertEquals("coremap-release", values[ReleaseSigning.KEY_ALIAS])
    }

    @Test
    fun placeholdersAndBlanksAreIncomplete() {
        val file = mapOf(
            ReleaseSigning.STORE_FILE to "/absolute/path/to/coremap-internal-release.jks",
            ReleaseSigning.STORE_PASSWORD to "REPLACE_LOCALLY",
            ReleaseSigning.KEY_ALIAS to "coremap-release",
            ReleaseSigning.KEY_PASSWORD to " ",
        )
        assertEquals(
            listOf(
                ReleaseSigning.STORE_FILE,
                ReleaseSigning.STORE_PASSWORD,
                ReleaseSigning.KEY_PASSWORD,
            ),
            ReleaseSigning.missingKeys(file),
        )
        assertFalse(ReleaseSigning.canCreateSigningConfig(file) { true })
    }

    @Test
    fun missingStoreFileOnDiskIsFailClosed() {
        assertFalse(
            ReleaseSigning.canCreateSigningConfig(completeFile) { false },
        )
        val message = ReleaseSigning.errorMessage(completeFile, "keystore.properties") { false }
        assertTrue(message.contains("storeFile"))
        assertFalse(message.contains("store-secret"))
        assertFalse(message.contains("key-secret"))
    }

    @Test
    fun errorNamesMissingKeysAndNeverIncludesSecretValues() {
        val incomplete = mapOf(
            ReleaseSigning.STORE_FILE to "/secure/coremap-internal-release.jks",
            ReleaseSigning.STORE_PASSWORD to "super-secret-password",
            ReleaseSigning.KEY_ALIAS to "",
            ReleaseSigning.KEY_PASSWORD to "another-secret",
        )
        val message = ReleaseSigning.errorMessage(incomplete, "keystore.properties") { true }
        assertTrue(message.contains(ReleaseSigning.KEY_ALIAS))
        assertFalse(message.contains("super-secret-password"))
        assertFalse(message.contains("another-secret"))
        assertFalse(ReleaseSigning.canCreateSigningConfig(incomplete) { true })
    }
}
