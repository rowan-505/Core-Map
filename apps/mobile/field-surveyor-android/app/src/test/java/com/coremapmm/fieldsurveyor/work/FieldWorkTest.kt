package com.coremapmm.fieldsurveyor.work

import com.coremapmm.fieldsurveyor.data.SyncClaimPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FieldWorkTest {
    @Test
    fun mediaUsesOneSerializedQueueAndDefaultEnqueueRunsBothStages() {
        assertEquals("field-outbox-sync", FieldWork.UNIQUE_NAME)
        assertEquals(FieldWork.MEDIA_WIFI, FieldWork.MEDIA_CELLULAR)
        assertTrue(FieldWork.UNIQUE_NAME != FieldWork.MEDIA_WIFI)
        assertEquals(listOf(SyncStage.REPORTS, SyncStage.MEDIA), FieldWorkPolicy.defaultStages())
        assertEquals(listOf(SyncStage.MEDIA), FieldWorkPolicy.meteredOverrideStages())
    }

    @Test
    fun aFreshSyncingClaimCannotBeClaimedByAnotherWorker() {
        val now = 1_000_000L
        assertTrue(SyncClaimPolicy.eligible("LOCAL", now, now))
        assertTrue(!SyncClaimPolicy.eligible("SYNCING", now, now))
        assertTrue(SyncClaimPolicy.eligible("SYNCING", now - SyncClaimPolicy.LEASE_MS - 1L, now))
    }

    @Test
    fun syncWorkUsesReplaceSoNewCapturesRunImmediately() {
        assertEquals("REPLACE", FieldWorkPolicy.uniqueMediaWorkPolicy(allowMetered = false))
        assertEquals("REPLACE", FieldWorkPolicy.uniqueMediaWorkPolicy(allowMetered = true))
        assertEquals(FieldWork.MEDIA_WIFI, FieldWork.MEDIA_CELLULAR)
    }

    @Test
    fun workerRetriesWhileAFreshSyncingLeaseBlocksClaims() {
        assertTrue(FieldWorkPolicy.mediaShouldRetry(retryLater = false, hasEligible = false, hasFreshSyncing = true))
        assertTrue(FieldWorkPolicy.mediaShouldRetry(retryLater = true, hasEligible = false, hasFreshSyncing = false))
        assertTrue(!FieldWorkPolicy.mediaShouldRetry(retryLater = false, hasEligible = false, hasFreshSyncing = false))
    }

    @Test
    fun sessionRetryDoesNotSkipReportStageInSamePass() {
        assertTrue(FieldWorkPolicy.shouldContinueAfterUpstreamRetry(upstreamRetryLater = true))
        assertTrue(
            FieldWorkPolicy.shouldRetryWorker(
                retryLater = true,
                moreSessions = false,
                moreCompletions = false,
                moreReports = false,
            ),
        )
        assertTrue(
            !FieldWorkPolicy.shouldRetryWorker(
                retryLater = false,
                moreSessions = false,
                moreCompletions = false,
                moreReports = false,
            ),
        )
    }
}
