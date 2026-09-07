package com.coremapmm.fieldsurveyor.data

/** Prevents concurrent workers from reclaiming an active upload while allowing crash recovery. */
object SyncClaimPolicy {
    const val LEASE_MS = 15 * 60 * 1_000L

    fun eligible(state: String, updatedAtEpochMs: Long, nowEpochMs: Long): Boolean =
        state in setOf("LOCAL", "QUEUED", "RETRY") ||
            (state == "SYNCING" && updatedAtEpochMs <= nowEpochMs - LEASE_MS)
}
