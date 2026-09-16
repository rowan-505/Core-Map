package com.coremapmm.fieldsurveyor.survey

/**
 * Personal variant completion is separate from GPS session lifecycle.
 * Finish may stop active tracking; reopen never restarts GPS.
 */
object SurveyPersonalFinish {
    /** When marking finished while tracking is active, invoke the existing Stop teardown. */
    fun shouldStopTracking(finished: Boolean, trackingActive: Boolean): Boolean =
        finished && trackingActive

    /** Reopen returns Partial only; never restarts GPS. */
    fun shouldRestartGps(finished: Boolean): Boolean = false

    /** Outbox upsert only when the finished flag actually changes. */
    fun shouldEnqueue(changed: Boolean): Boolean = changed
}
