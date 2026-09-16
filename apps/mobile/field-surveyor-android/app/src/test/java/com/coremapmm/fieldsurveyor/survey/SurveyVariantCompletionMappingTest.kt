package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.LocalSurveyVariantCompletionEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveyVariantCompletionMappingTest {
    @Test
    fun badgeLabels() {
        assertEquals("Finished", SurveyVariantCompletionMapping.badge(true))
        assertEquals("Partial", SurveyVariantCompletionMapping.badge(false))
        assertNull(SurveyVariantCompletionMapping.badge(null))
    }

    @Test
    fun finishedMapKeepsVariantKeys() {
        val map = SurveyVariantCompletionMapping.finishedMap(
            listOf("v-d0" to true, "v-d1" to false),
        )
        assertEquals(true, map["v-d0"])
        assertEquals(false, map["v-d1"])
    }

    @Test
    fun applyLocalPutSetsFinishedAtOnFirstFinish() {
        val put = SurveyVariantCompletionMapping.applyLocalPut(
            existingFinished = null,
            finished = true,
            nowMs = 100L,
            previousFinishedAt = null,
        )
        assertTrue(put.isFinished)
        assertEquals(100L, put.finishedAtEpochMs)
        assertTrue(put.changed)
    }

    @Test
    fun applyLocalPutKeepsFinishedAtOnIdempotentFinish() {
        val put = SurveyVariantCompletionMapping.applyLocalPut(
            existingFinished = true,
            finished = true,
            nowMs = 200L,
            previousFinishedAt = 50L,
        )
        assertEquals(50L, put.finishedAtEpochMs)
        assertFalse(put.changed)
    }

    @Test
    fun applyLocalPutClearsFinishedAtOnReopen() {
        val put = SurveyVariantCompletionMapping.applyLocalPut(
            existingFinished = true,
            finished = false,
            nowMs = 300L,
            previousFinishedAt = 50L,
        )
        assertFalse(put.isFinished)
        assertNull(put.finishedAtEpochMs)
        assertTrue(put.changed)
    }

    @Test
    fun canApplyRemoteOnlyWhenSettled() {
        assertTrue(SurveyVariantCompletionMapping.canApplyRemote(null))
        assertTrue(SurveyVariantCompletionMapping.canApplyRemote(LocalSurveyVariantCompletionEntity.SYNC_SYNCED))
        assertTrue(SurveyVariantCompletionMapping.canApplyRemote(LocalSurveyVariantCompletionEntity.SYNC_PERMANENT_ERROR))
        assertFalse(SurveyVariantCompletionMapping.canApplyRemote(LocalSurveyVariantCompletionEntity.SYNC_LOCAL))
        assertFalse(SurveyVariantCompletionMapping.canApplyRemote(LocalSurveyVariantCompletionEntity.SYNC_RETRY))
        assertFalse(SurveyVariantCompletionMapping.canApplyRemote(LocalSurveyVariantCompletionEntity.SYNC_SYNCING))
    }
}
