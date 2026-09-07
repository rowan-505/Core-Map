package com.coremapmm.fieldsurveyor.signing

/**
 * Selection rules for release signing. Used by unit tests to lock fail-closed behavior.
 * Gradle `app/build.gradle.kts` must keep the same order and completeness checks.
 */
object ReleaseSigning {
    const val STORE_FILE = "storeFile"
    const val STORE_PASSWORD = "storePassword"
    const val KEY_ALIAS = "keyAlias"
    const val KEY_PASSWORD = "keyPassword"

    val requiredKeys = listOf(STORE_FILE, STORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD)

    const val ENV_STORE_FILE = "FIELD_RELEASE_STORE_FILE"
    const val ENV_STORE_PASSWORD = "FIELD_RELEASE_STORE_PASSWORD"
    const val ENV_KEY_ALIAS = "FIELD_RELEASE_KEY_ALIAS"
    const val ENV_KEY_PASSWORD = "FIELD_RELEASE_KEY_PASSWORD"

    fun isUsableValue(value: String?): Boolean {
        val trimmed = value?.trim().orEmpty()
        if (trimmed.isEmpty()) {
            return false
        }
        if (trimmed.equals("REPLACE_LOCALLY", ignoreCase = true)) {
            return false
        }
        if (trimmed.contains("/absolute/path/to/")) {
            return false
        }
        return true
    }

    fun missingKeys(values: Map<String, String?>): List<String> =
        requiredKeys.filter { !isUsableValue(values[it]) }

    fun envValues(env: Map<String, String?>): Map<String, String?> = mapOf(
        STORE_FILE to env[ENV_STORE_FILE],
        STORE_PASSWORD to env[ENV_STORE_PASSWORD],
        KEY_ALIAS to env[ENV_KEY_ALIAS],
        KEY_PASSWORD to env[ENV_KEY_PASSWORD],
    )

    /**
     * Complete environment variables win. Otherwise the local properties file is used.
     * Incomplete env does not mix with the file.
     */
    fun selectedValues(
        env: Map<String, String?>,
        fileValues: Map<String, String?>,
    ): Pair<Map<String, String?>, String> {
        val fromEnv = envValues(env)
        if (missingKeys(fromEnv).isEmpty()) {
            return fromEnv to "environment"
        }
        return fileValues to "keystore.properties"
    }

    fun canCreateSigningConfig(
        values: Map<String, String?>,
        storeFileExists: (String) -> Boolean,
    ): Boolean {
        if (missingKeys(values).isNotEmpty()) {
            return false
        }
        val path = values.getValue(STORE_FILE)!!.trim()
        return storeFileExists(path)
    }

    fun errorMessage(
        values: Map<String, String?>,
        source: String,
        storeFileExists: (String) -> Boolean,
    ): String {
        val missing = missingKeys(values)
        if (missing.isNotEmpty()) {
            return "Release signing credentials are required; debug signing is forbidden. " +
                "Missing or unusable: ${missing.joinToString(", ")}. " +
                "Set a complete FIELD_RELEASE_STORE_FILE, FIELD_RELEASE_STORE_PASSWORD, " +
                "FIELD_RELEASE_KEY_ALIAS, and FIELD_RELEASE_KEY_PASSWORD set, " +
                "or fill keystore.properties ($source)."
        }
        if (!storeFileExists(values.getValue(STORE_FILE)!!.trim())) {
            return "Release signing credentials are required; debug signing is forbidden. " +
                "storeFile is not an existing file ($source)."
        }
        return "Release signing credentials are required; debug signing is forbidden."
    }
}
