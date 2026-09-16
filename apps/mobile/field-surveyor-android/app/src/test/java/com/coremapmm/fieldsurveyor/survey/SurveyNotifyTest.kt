package com.coremapmm.fieldsurveyor.survey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SurveyNotifyTest {
    @Test
    fun successOfflineFailureCopyAndDurations() {
        val online = SurveyNotify.afterLocalSave(online = true, id = 1)
        assertEquals(SurveyNotifyCopy.REPORT_SAVED, online.message)
        assertEquals(SurveyNotifyTone.SUCCESS, online.tone)
        assertEquals(1_500L, online.durationMs)

        val offline = SurveyNotify.afterLocalSave(online = false, id = 2)
        assertEquals(SurveyNotifyCopy.SAVED_OFFLINE, offline.message)
        assertEquals(SurveyNotifyTone.OFFLINE, offline.tone)
        assertEquals(2_000L, offline.durationMs)

        val failed = SurveyNotify.afterRoomFailure(id = 3)
        assertEquals(SurveyNotifyCopy.SAVE_FAILED, failed.message)
        assertEquals("Could not save", failed.message)
        assertEquals(SurveyNotifyTone.FAILURE, failed.tone)
        assertEquals(3_000L, failed.durationMs)
        assertEquals(SurveyNotifyCopy.RETRY, failed.actionLabel)
        assertEquals(SurveyNotifyCopy.ACTION_RETRY_SAVE, failed.actionKey)
    }

    @Test
    fun startSurveyFirstIsWarningNotFailure() {
        val warning = SurveyNotify.fromMessage("Start the survey first.", id = 4)
        assertEquals(SurveyNotifyTone.WARNING, warning.tone)
        assertEquals(2_000L, warning.durationMs)
        assertTrue(SurveyNotify.isWarningMessage("Select a stop first."))
    }

    @Test
    fun surveyLifecycleUsesAccurateStates() {
        assertEquals(SurveyNotifyCopy.SURVEY_STARTED, SurveyNotify.surveyStarted(1).message)
        assertEquals(SurveyNotifyCopy.SURVEY_STOPPED, SurveyNotify.surveyStopped(2).message)
        assertEquals(SurveyNotifyTone.SUCCESS, SurveyNotify.surveyStarted(1).tone)
        assertEquals(SurveyNotifyTone.SUCCESS, SurveyNotify.surveyStopped(2).tone)
        assertEquals(1_500L, SurveyNotify.surveyStarted(1).durationMs)
    }

    @Test
    fun replaceCurrentDismissesPreviousWithoutQueueOverlap() {
        val first = SurveyNotify.success(SurveyNotifyCopy.REPORT_SAVED, 1)
        val second = SurveyNotify.warning("Start the survey first.", 2)
        val (current, pending) = SurveyNotify.replaceCurrent(second)
        assertEquals(second, current)
        assertTrue(pending.isEmpty())
        assertEquals(listOf(first), SurveyNotify.enqueue(emptyList(), first))
        assertNull(SurveyNotify.nextQueued(null, emptyList()).first)
    }

    @Test
    fun roomSaveIsNotTreatedAsSyncFailureCopy() {
        assertEquals("Saved offline — sync pending", ReportSaveReset.successBanner(false))
        assertEquals("Report saved", ReportSaveReset.successBanner(true))
        assertEquals("Could not save", ReportSaveReset.ROOM_SAVE_FAILED)
        assertTrue(ReportSaveReset.allowedSuccessBanners().contains(ReportSaveReset.SAVED_OFFLINE))
        assertTrue(!ReportSaveReset.allowedSuccessBanners().any { it.contains("sync failed", ignoreCase = true) })
    }

    @Test
    fun failureKeepsFormResetGuards() {
        assertTrue(!ReportSaveReset.shouldResetForm(false))
        assertTrue(!ReportSaveReset.shouldClearDraftMedia(false))
    }
}
