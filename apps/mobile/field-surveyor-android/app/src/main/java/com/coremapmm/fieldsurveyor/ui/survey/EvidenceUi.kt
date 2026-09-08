package com.coremapmm.fieldsurveyor.ui.survey

/** Compact evidence copy for the survey form. Payload storage is unchanged. */
object EvidenceUi {
    const val SECTION_TITLE = "Evidence · Optional"
    const val PHOTO = "Photo"
    const val HOLD_TO_RECORD = "Hold to record"
    const val RECORDING = "Recording…"
    const val SAVE = "Save"
    const val MAP_TAP_HINT = "Tap the map once."

    fun summary(photoCount: Int, voiceDurationMs: Long?): String? {
        if (photoCount <= 0 && (voiceDurationMs == null || voiceDurationMs <= 0L)) return null
        val parts = mutableListOf<String>()
        if (photoCount > 0) {
            parts += if (photoCount == 1) "1 photo" else "$photoCount photos"
        }
        if (voiceDurationMs != null && voiceDurationMs > 0L) {
            val seconds = (voiceDurationMs / 1_000L).coerceAtLeast(1L)
            parts += "$seconds-sec voice"
        }
        return parts.joinToString(" · ")
    }
}
