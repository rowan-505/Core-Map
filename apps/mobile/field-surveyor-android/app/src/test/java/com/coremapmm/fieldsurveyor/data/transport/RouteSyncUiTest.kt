package com.coremapmm.fieldsurveyor.data.transport

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RouteSyncUiTest {
    @Test
    fun everyOutcomeMapsToExactCopy() {
        assertEquals(RouteSyncUi.LABEL_NOT_DOWNLOADED, RouteSyncUi.label(RouteSyncUiState.NotDownloaded))
        assertEquals(
            RouteSyncUi.LABEL_DOWNLOADING,
            RouteSyncUi.label(RouteSyncUiState.Downloading(12, "rev-a")),
        )
        assertEquals(
            RouteSyncUi.LABEL_IMPORTING,
            RouteSyncUi.label(RouteSyncUiState.Importing(12, "rev-a")),
        )
        assertEquals(
            RouteSyncUi.LABEL_UP_TO_DATE,
            RouteSyncUi.label(RouteSyncUiState.UpToDate(12, "rev-a")),
        )
        assertEquals("42 routes updated", RouteSyncUi.label(RouteSyncUiState.Updated(42, "rev-b")))
        assertEquals(
            RouteSyncUi.LABEL_FAILED_WITH_CACHE,
            RouteSyncUi.label(RouteSyncUiState.FailedWithCache(12, "rev-a")),
        )
        assertEquals(
            RouteSyncUi.LABEL_OFFLINE_WITH_CACHE,
            RouteSyncUi.label(RouteSyncUiState.OfflineWithCache(12, "rev-a")),
        )
        assertEquals(
            RouteSyncUi.LABEL_FAILED_WITHOUT_CACHE,
            RouteSyncUi.label(RouteSyncUiState.FailedWithoutCache()),
        )
    }

    @Test
    fun successOnlyAfterRefreshResultNotFromCacheCountAlone() {
        val cachedButStaleUi = RouteSyncUi.initial(variantCount = 80, revision = "rev-old", online = true)
        assertTrue(cachedButStaleUi is RouteSyncUiState.UpToDate)
        val failedKeep = RouteSyncUi.fromRefreshResult(
            result = BootstrapRefreshResult.Failed("timeout", "rev-old", 80),
            online = true,
            fallbackCount = 80,
            fallbackRevision = "rev-old",
        )
        assertTrue(failedKeep is RouteSyncUiState.FailedWithCache)
        assertFalse(RouteSyncUi.isPositive(failedKeep))
        assertTrue(RouteSyncUi.hasUsableCache(failedKeep))
        assertEquals(80, failedKeep.variantCount)
    }

    @Test
    fun failedRefreshRetainsPreviousSnapshot() {
        val state = RouteSyncUi.fromRefreshResult(
            BootstrapRefreshResult.Failed("boom", "kept-rev", 17),
            online = true,
        )
        assertEquals(RouteSyncUiState.FailedWithCache(17, "kept-rev"), state)
        assertTrue(RouteSyncUi.showTryAgain(state))
        assertFalse(RouteSyncUi.isHardFailure(state))
        assertTrue(RouteSyncUi.isSoftFailure(state))
    }

    @Test
    fun offlineWithCacheIsDistinctFromHardFailure() {
        val offline = RouteSyncUi.fromRefreshResult(
            BootstrapRefreshResult.Failed("unreachable", "kept-rev", 9),
            online = false,
        )
        assertEquals(RouteSyncUiState.OfflineWithCache(9, "kept-rev"), offline)
        assertEquals(RouteSyncUi.LABEL_OFFLINE_WITH_CACHE, RouteSyncUi.label(offline))
        val hard = RouteSyncUi.fromRefreshResult(
            BootstrapRefreshResult.Failed("unreachable", null, 0),
            online = false,
        )
        assertEquals(RouteSyncUiState.FailedWithoutCache(), hard)
        assertTrue(RouteSyncUi.isHardFailure(hard))
    }

    @Test
    fun neverShowsSuccessAndFailureTogether() {
        listOf(
            RouteSyncUiState.NotDownloaded,
            RouteSyncUiState.Downloading(),
            RouteSyncUiState.Importing(),
            RouteSyncUiState.UpToDate(1, "r"),
            RouteSyncUiState.Updated(2, "r"),
            RouteSyncUiState.FailedWithCache(3, "r"),
            RouteSyncUiState.OfflineWithCache(4, "r"),
            RouteSyncUiState.FailedWithoutCache(),
        ).forEach { state ->
            assertTrue(RouteSyncUi.neverShowsSuccessAndFailure(state))
            assertFalse(RouteSyncUi.isPositive(state) && RouteSyncUi.isHardFailure(state))
            assertFalse(RouteSyncUi.isPositive(state) && RouteSyncUi.isSoftFailure(state))
        }
    }

    @Test
    fun downloadingAndImportingPhasesPreserveCacheMetadata() {
        val start = RouteSyncUiState.UpToDate(11, "rev-1")
        val downloading = RouteSyncUi.downloading(start)
        assertEquals(11, downloading.variantCount)
        assertEquals("rev-1", downloading.revision)
        assertTrue(RouteSyncUi.isBusy(downloading))
        val importing = RouteSyncUi.importing(downloading)
        assertTrue(importing is RouteSyncUiState.Importing)
        assertEquals(11, importing.variantCount)
    }

    @Test
    fun updatedAndUpToDateComeFromSuccessfulResults() {
        assertEquals(
            RouteSyncUiState.UpToDate(11, "rev-1"),
            RouteSyncUi.fromRefreshResult(
                BootstrapRefreshResult.Unchanged("rev-1"),
                online = true,
                fallbackCount = 11,
            ),
        )
        assertEquals(
            RouteSyncUiState.Updated(22, "rev-2"),
            RouteSyncUi.fromRefreshResult(
                BootstrapRefreshResult.Updated("rev-2", 22),
                online = true,
            ),
        )
    }

    @Test
    fun interruptedBusyStateRestoresWithoutClaimingSuccess() {
        val restored = RouteSyncUi.restore(
            name = "Downloading",
            variantCount = 5,
            revision = "rev",
            online = true,
        )
        assertTrue(restored is RouteSyncUiState.Downloading)
        val afterColdStart = if (restored is RouteSyncUiState.Downloading) {
            RouteSyncUi.initial(5, "rev", online = true)
        } else {
            restored
        }
        assertEquals(RouteSyncUiState.UpToDate(5, "rev"), afterColdStart)
        assertFalse(RouteSyncUi.isPositive(RouteSyncUiState.FailedWithCache(5, "rev")))
    }

    @Test
    fun processRecreationRoundTripsStateNames() {
        val samples = listOf(
            RouteSyncUiState.NotDownloaded,
            RouteSyncUiState.Downloading(1, "a"),
            RouteSyncUiState.Importing(1, "a"),
            RouteSyncUiState.UpToDate(2, "b"),
            RouteSyncUiState.Updated(3, "c"),
            RouteSyncUiState.FailedWithCache(4, "d"),
            RouteSyncUiState.OfflineWithCache(5, "e"),
            RouteSyncUiState.FailedWithoutCache(),
        )
        samples.forEach { state ->
            val name = RouteSyncUi.persistenceName(state)
            val back = RouteSyncUi.restore(name, state.variantCount, state.revision, online = true)
            assertEquals(name, RouteSyncUi.persistenceName(back))
        }
    }

    @Test
    fun tryAgainOnlyOnRecoverableOrMissingStates() {
        assertTrue(RouteSyncUi.showTryAgain(RouteSyncUiState.NotDownloaded))
        assertTrue(RouteSyncUi.showTryAgain(RouteSyncUiState.FailedWithCache(1, "r")))
        assertTrue(RouteSyncUi.showTryAgain(RouteSyncUiState.OfflineWithCache(1, "r")))
        assertTrue(RouteSyncUi.showTryAgain(RouteSyncUiState.FailedWithoutCache()))
        assertFalse(RouteSyncUi.showTryAgain(RouteSyncUiState.UpToDate(1, "r")))
        assertFalse(RouteSyncUi.showTryAgain(RouteSyncUiState.Updated(1, "r")))
        assertFalse(RouteSyncUi.showTryAgain(RouteSyncUiState.Downloading()))
    }
}
