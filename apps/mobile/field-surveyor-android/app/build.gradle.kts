import java.io.File
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
}

val repoRoot = rootProject.projectDir.resolve("../../..")
val overviewPmtiles = repoRoot.resolve(
    "infrastructure/tiles/pmtiles/overview/regions/myanmar-overview-v1.pmtiles",
)
val webFonts = repoRoot.resolve("apps/web/public/fonts")
/** Concrete File, not a Provider — AGP 9 forbids Provider in SourceSet.srcDir. */
val generatedAssetsDir = file("build/generated/offlineAssets")

fun localProperty(name: String): String? {
    val file = rootProject.file("local.properties")
    if (!file.isFile) {
        return null
    }
    val props = Properties()
    file.inputStream().use { props.load(it) }
    return props.getProperty(name)?.trim()?.takeIf { it.isNotEmpty() }
}

fun apiBaseUrlFor(buildType: String): String {
    val fromCli = gradle.startParameter.projectProperties["fieldApiBaseUrl"]?.trim().orEmpty()
    if (fromCli.isNotEmpty()) {
        return fromCli.trimEnd('/')
    }
    val fromEnv = System.getenv("FIELD_API_BASE_URL")?.trim().orEmpty()
    if (fromEnv.isNotEmpty()) {
        return fromEnv.trimEnd('/')
    }
    if (buildType == "debug") {
        val fromLocal = localProperty("fieldApiBaseUrl")
        if (!fromLocal.isNullOrEmpty()) {
            return fromLocal.trimEnd('/')
        }
    }
    val fromGradle = (project.findProperty("fieldApiBaseUrl") as String?)?.trim().orEmpty()
    if (fromGradle.isNotEmpty()) {
        return fromGradle.trimEnd('/')
    }
    return if (buildType == "debug") {
        "http://10.0.2.2:3001"
    } else {
        "https://api.coremapmm.com"
    }
}

fun sentryDsn(): String {
    val fromEnv = System.getenv("FIELD_SENTRY_DSN")?.trim().orEmpty()
    if (fromEnv.isNotEmpty()) {
        return fromEnv
    }
    return localProperty("fieldSentryDsn").orEmpty()
}

fun escapeBuildConfig(value: String): String {
    return value.replace("\\", "\\\\").replace("\"", "\\\"")
}

val releaseSigningRequiredKeys = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")

fun isUsableReleaseSigningValue(value: String?): Boolean {
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

fun envReleaseSigningValues(): Map<String, String> = mapOf(
    "storeFile" to System.getenv("FIELD_RELEASE_STORE_FILE")?.trim().orEmpty(),
    "storePassword" to System.getenv("FIELD_RELEASE_STORE_PASSWORD")?.trim().orEmpty(),
    "keyAlias" to System.getenv("FIELD_RELEASE_KEY_ALIAS")?.trim().orEmpty(),
    "keyPassword" to System.getenv("FIELD_RELEASE_KEY_PASSWORD")?.trim().orEmpty(),
)

fun keystorePropertiesValues(): Map<String, String> {
    val file = rootProject.file("keystore.properties")
    if (!file.isFile) {
        return emptyMap()
    }
    val props = Properties()
    file.inputStream().use { props.load(it) }
    return releaseSigningRequiredKeys.associateWith { key ->
        props.getProperty(key)?.trim().orEmpty()
    }
}

fun selectedReleaseSigningValues(): Pair<Map<String, String>, String> {
    val fromEnv = envReleaseSigningValues()
    if (releaseSigningRequiredKeys.all { isUsableReleaseSigningValue(fromEnv[it]) }) {
        return fromEnv to "environment"
    }
    return keystorePropertiesValues() to "keystore.properties"
}

fun missingReleaseSigningKeys(values: Map<String, String>): List<String> =
    releaseSigningRequiredKeys.filter { !isUsableReleaseSigningValue(values[it]) }

fun resolveReleaseStoreFile(path: String): File {
    val asFile = File(path)
    if (asFile.isAbsolute) {
        return asFile
    }
    return rootProject.file(path)
}

fun releaseSigningUnavailableMessage(
    values: Map<String, String>,
    source: String,
): String {
    val missing = missingReleaseSigningKeys(values)
    if (missing.isNotEmpty()) {
        return "Release signing credentials are required; debug signing is forbidden for release builds. " +
            "Missing or unusable: ${missing.joinToString(", ")}. " +
            "Set complete FIELD_RELEASE_STORE_FILE, FIELD_RELEASE_STORE_PASSWORD, " +
            "FIELD_RELEASE_KEY_ALIAS, and FIELD_RELEASE_KEY_PASSWORD, " +
            "or fill keystore.properties."
    }
    return "Release signing credentials are required; debug signing is forbidden for release builds. " +
        "storeFile is not an existing file ($source)."
}

var releaseSigningFailure: String? = null

fun yangonPmtilesUrl(): String {
    val fromProperty = (project.findProperty("fieldYangonPmtilesUrl") as String?)?.trim().orEmpty()
    if (fromProperty.isNotEmpty()) {
        return fromProperty
    }
    return "https://tiles.coremapmm.com/basemaps/yangon/v2/basemap.pmtiles"
}

android {
    namespace = "com.coremapmm.fieldsurveyor"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.coremapmm.fieldsurveyor"
        minSdk = 31
        targetSdk = 35
        versionCode = 9
        versionName = "0.8.1-pilot"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk {
            abiFilters += "arm64-v8a"
        }
    }

    signingConfigs {
        val (values, source) = selectedReleaseSigningValues()
        val missing = missingReleaseSigningKeys(values)
        val store = values["storeFile"]?.trim().orEmpty()
        val resolvedStore = if (store.isNotEmpty()) resolveReleaseStoreFile(store) else null
        if (missing.isEmpty() && resolvedStore != null && resolvedStore.isFile) {
            create("release") {
                storeFile = resolvedStore
                storePassword = values.getValue("storePassword")
                keyAlias = values.getValue("keyAlias")
                keyPassword = values.getValue("keyPassword")
            }
            releaseSigningFailure = null
        } else {
            releaseSigningFailure = releaseSigningUnavailableMessage(values, source)
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            buildConfigField("String", "API_BASE_URL", "\"${escapeBuildConfig(apiBaseUrlFor("release"))}\"")
            buildConfigField("String", "YANGON_PMTILES_URL", "\"${escapeBuildConfig(yangonPmtilesUrl())}\"")
            buildConfigField("String", "SENTRY_DSN", "\"${escapeBuildConfig(sentryDsn())}\"")
        }
        debug {
            isMinifyEnabled = false
            buildConfigField("String", "API_BASE_URL", "\"${escapeBuildConfig(apiBaseUrlFor("debug"))}\"")
            buildConfigField("String", "YANGON_PMTILES_URL", "\"${escapeBuildConfig(yangonPmtilesUrl())}\"")
            buildConfigField("String", "SENTRY_DSN", "\"${escapeBuildConfig(sentryDsn())}\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    sourceSets {
        named("main") {
            assets.srcDir(generatedAssetsDir)
        }
    }
}

tasks.register("releaseConfigSmoke") {
    group = "verification"
    description = "Check release API origin is HTTPS production and not a secret."
    doLast {
        val url = apiBaseUrlFor("release")
        check(!url.contains("service_role")) { "Release API URL must not contain secrets" }
        check(!url.contains("invalid.coremap")) { "Release API URL is still a placeholder: $url" }
        check(url.startsWith("https://")) { "Release API URL must be HTTPS: $url" }
        check(android.signingConfigs.findByName("release") != null) {
            releaseSigningFailure
                ?: "Release signing credentials are required; debug signing is forbidden for release builds"
        }
        val override = System.getenv("FIELD_API_BASE_URL")?.trim().orEmpty()
            .ifEmpty { gradle.startParameter.projectProperties["fieldApiBaseUrl"]?.trim().orEmpty() }
        if (override.isEmpty()) {
            check(url == "https://api.coremapmm.com") { "Unexpected release API URL: $url" }
        }
    }
}

afterEvaluate {
    listOf("assembleRelease", "bundleRelease").forEach { releaseTask ->
        tasks.named(releaseTask).configure {
            dependsOn("releaseConfigSmoke")
        }
    }
}

val prepareOfflineAssets by tasks.registering(Copy::class) {
    description = "Copy CoreMap overview PMTiles, style JSON, and glyph PBFs into generated assets."
    group = "build"
    doFirst {
        check(overviewPmtiles.isFile) {
            "Missing $overviewPmtiles. Build or copy myanmar-overview-v1.pmtiles first."
        }
        check(webFonts.resolve("NotoSansMyanmar-Regular").isDirectory) {
            "Missing Myanmar glyphs at $webFonts/NotoSansMyanmar-Regular"
        }
    }
    from(overviewPmtiles) {
        into("basemap")
        rename { "overview.pmtiles" }
    }
    from(repoRoot.resolve("packages/map-style/overview-map.json")) {
        into("style")
    }
    from(repoRoot.resolve("packages/map-style/base-map.json")) {
        into("style")
    }
    from(webFonts.resolve("NotoSansMyanmar-Regular")) {
        into("fonts/NotoSansMyanmar-Regular")
    }
    into(generatedAssetsDir)
}

tasks.named("preBuild").configure {
    dependsOn(prepareOfflineAssets)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation("androidx.compose.material:material-icons-extended")
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.security.crypto)
    implementation(libs.okhttp)
    implementation(libs.maplibre.android)
    implementation(libs.play.services.location)
    implementation(libs.androidx.exifinterface)
    implementation(libs.sentry.android)
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation("org.json:json:20240303")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test:core:1.7.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
