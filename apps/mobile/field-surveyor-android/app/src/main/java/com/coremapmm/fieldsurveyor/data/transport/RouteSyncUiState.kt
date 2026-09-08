package com.coremapmm.fieldsurveyor.data.transport

/**
 * Authoritative route-sync UI state. Success means validate + Room write + activation
 * completed. A nonzero cache count alone is never treated as refresh success.
 */
sealed class RouteSyncUiState {
    abstract val variantCount: Int
    abstract val revision: String?

    data object NotDownloaded : RouteSyncUiState() {
        override val variantCount: Int = 0
        override val revision: String? = null
    }

    data class Downloading(
        override val variantCount: Int = 0,
        override val revision: String? = null,
    ) : RouteSyncUiState()

    data class Importing(
        override val variantCount: Int = 0,
        override val revision: String? = null,
    ) : RouteSyncUiState()

    data class UpToDate(
        override val variantCount: Int,
        override val revision: String,
    ) : RouteSyncUiState()

    data class Updated(
        override val variantCount: Int,
        override val revision: String,
    ) : RouteSyncUiState()

    data class FailedWithCache(
        override val variantCount: Int,
        override val revision: String,
    ) : RouteSyncUiState()

    data class OfflineWithCache(
        override val variantCount: Int,
        override val revision: String,
    ) : RouteSyncUiState()

    data class FailedWithoutCache(
        override val variantCount: Int = 0,
        override val revision: String? = null,
    ) : RouteSyncUiState()
}

enum class BootstrapRefreshPhase {
    FETCHING,
    IMPORTING,
}

object RouteSyncUi {
    const val LABEL_NOT_DOWNLOADED = "Download routes"
    const val LABEL_DOWNLOADING = "Updating routes…"
    const val LABEL_IMPORTING = "Preparing routes…"
    const val LABEL_UP_TO_DATE = "Routes are up to date"
    const val LABEL_FAILED_WITH_CACHE = "Update failed · Using saved routes"
    const val LABEL_OFFLINE_WITH_CACHE = "Offline · Using saved routes"
    const val LABEL_FAILED_WITHOUT_CACHE = "Couldn't download routes"
    const val ACTION_TRY_AGAIN = "Try again"

    fun updatedLabel(variantCount: Int): String = "$variantCount routes updated"

    fun label(state: RouteSyncUiState): String = when (state) {
        RouteSyncUiState.NotDownloaded -> LABEL_NOT_DOWNLOADED
        is RouteSyncUiState.Downloading -> LABEL_DOWNLOADING
        is RouteSyncUiState.Importing -> LABEL_IMPORTING
        is RouteSyncUiState.UpToDate -> LABEL_UP_TO_DATE
        is RouteSyncUiState.Updated -> updatedLabel(state.variantCount)
        is RouteSyncUiState.FailedWithCache -> LABEL_FAILED_WITH_CACHE
        is RouteSyncUiState.OfflineWithCache -> LABEL_OFFLINE_WITH_CACHE
        is RouteSyncUiState.FailedWithoutCache -> LABEL_FAILED_WITHOUT_CACHE
    }

    fun showTryAgain(state: RouteSyncUiState): Boolean = when (state) {
        is RouteSyncUiState.FailedWithCache,
        is RouteSyncUiState.OfflineWithCache,
        is RouteSyncUiState.FailedWithoutCache,
        RouteSyncUiState.NotDownloaded,
        -> true
        else -> false
    }

    fun isBusy(state: RouteSyncUiState): Boolean =
        state is RouteSyncUiState.Downloading || state is RouteSyncUiState.Importing

    /** Strong error styling only when there is no usable cache. */
    fun isHardFailure(state: RouteSyncUiState): Boolean =
        state is RouteSyncUiState.FailedWithoutCache

    fun isSoftFailure(state: RouteSyncUiState): Boolean =
        state is RouteSyncUiState.FailedWithCache || state is RouteSyncUiState.OfflineWithCache

    fun isPositive(state: RouteSyncUiState): Boolean =
        state is RouteSyncUiState.UpToDate || state is RouteSyncUiState.Updated

    fun hasUsableCache(state: RouteSyncUiState): Boolean =
        !state.revision.isNullOrBlank() && state.variantCount > 0

    fun neverShowsSuccessAndFailure(state: RouteSyncUiState): Boolean {
        val success = isPositive(state)
        val failure = isHardFailure(state) || isSoftFailure(state)
        return !(success && failure)
    }

    fun initial(
        variantCount: Int,
        revision: String?,
        online: Boolean,
    ): RouteSyncUiState {
        val hasCache = !revision.isNullOrBlank() && variantCount > 0
        return when {
            !hasCache -> RouteSyncUiState.NotDownloaded
            !online -> RouteSyncUiState.OfflineWithCache(variantCount, revision!!)
            else -> RouteSyncUiState.UpToDate(variantCount, revision!!)
        }
    }

    fun downloading(previous: RouteSyncUiState): RouteSyncUiState =
        RouteSyncUiState.Downloading(previous.variantCount, previous.revision)

    fun importing(previous: RouteSyncUiState): RouteSyncUiState =
        RouteSyncUiState.Importing(previous.variantCount, previous.revision)

    fun fromRefreshResult(
        result: BootstrapRefreshResult,
        online: Boolean,
        fallbackCount: Int = 0,
        fallbackRevision: String? = null,
    ): RouteSyncUiState = when (result) {
        is BootstrapRefreshResult.Unchanged ->
            RouteSyncUiState.UpToDate(fallbackCount.coerceAtLeast(0), result.snapshotRevision)
        is BootstrapRefreshResult.Updated ->
            RouteSyncUiState.Updated(result.variantCount, result.snapshotRevision)
        is BootstrapRefreshResult.Failed -> {
            val keptRevision = result.keptRevision ?: fallbackRevision
            val keptCount = if (result.keptVariantCount > 0) {
                result.keptVariantCount
            } else {
                fallbackCount
            }
            val hasCache = !keptRevision.isNullOrBlank() && keptCount > 0
            when {
                hasCache && !online ->
                    RouteSyncUiState.OfflineWithCache(keptCount, keptRevision!!)
                hasCache ->
                    RouteSyncUiState.FailedWithCache(keptCount, keptRevision!!)
                else ->
                    RouteSyncUiState.FailedWithoutCache()
            }
        }
    }

    fun restore(
        name: String?,
        variantCount: Int,
        revision: String?,
        online: Boolean,
    ): RouteSyncUiState {
        val hasCache = !revision.isNullOrBlank() && variantCount > 0
        return when (name) {
            "NotDownloaded" -> RouteSyncUiState.NotDownloaded
            "Downloading" -> RouteSyncUiState.Downloading(variantCount, revision)
            "Importing" -> RouteSyncUiState.Importing(variantCount, revision)
            "UpToDate" -> if (hasCache) {
                RouteSyncUiState.UpToDate(variantCount, revision!!)
            } else {
                initial(variantCount, revision, online)
            }
            "Updated" -> if (hasCache) {
                RouteSyncUiState.Updated(variantCount, revision!!)
            } else {
                initial(variantCount, revision, online)
            }
            "FailedWithCache" -> if (hasCache) {
                RouteSyncUiState.FailedWithCache(variantCount, revision!!)
            } else {
                RouteSyncUiState.FailedWithoutCache()
            }
            "OfflineWithCache" -> if (hasCache) {
                RouteSyncUiState.OfflineWithCache(variantCount, revision!!)
            } else {
                RouteSyncUiState.NotDownloaded
            }
            "FailedWithoutCache" -> RouteSyncUiState.FailedWithoutCache()
            else -> initial(variantCount, revision, online)
        }
    }

    fun persistenceName(state: RouteSyncUiState): String = when (state) {
        RouteSyncUiState.NotDownloaded -> "NotDownloaded"
        is RouteSyncUiState.Downloading -> "Downloading"
        is RouteSyncUiState.Importing -> "Importing"
        is RouteSyncUiState.UpToDate -> "UpToDate"
        is RouteSyncUiState.Updated -> "Updated"
        is RouteSyncUiState.FailedWithCache -> "FailedWithCache"
        is RouteSyncUiState.OfflineWithCache -> "OfflineWithCache"
        is RouteSyncUiState.FailedWithoutCache -> "FailedWithoutCache"
    }
}
