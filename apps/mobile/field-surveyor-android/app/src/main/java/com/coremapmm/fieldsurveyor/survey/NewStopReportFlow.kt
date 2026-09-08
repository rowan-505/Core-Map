package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.OrderedStopRow
import java.util.UUID

enum class NewStopPickMode {
    NONE,
    PICKING,
    SELECTED,
}

enum class NewStopLocationSource {
    GPS,
    MAP_PICK,
}

data class NewStopDraft(
    val clientPublicId: String,
    val name: String = "",
    val note: String = "",
    val pickMode: NewStopPickMode = NewStopPickMode.NONE,
    val proposed: GpsFix? = null,
    val locationSource: NewStopLocationSource? = null,
)

data class NewStopAfterSave(
    val nextStopPublicId: String?,
    val endOfRoute: Boolean,
)

object NewStopReportFlow {
    const val NAME_MAX = 120
    const val REPORT_SAVED = ReportSaveReset.REPORT_SAVED
    const val SAVED_OFFLINE = ReportSaveReset.SAVED_OFFLINE
    const val END_OF_ROUTE = ReportSaveReset.END_OF_ROUTE

    fun newDraft(clientPublicId: String = UUID.randomUUID().toString()): NewStopDraft {
        return NewStopDraft(clientPublicId = clientPublicId)
    }

    fun reuseDraftUuid(existing: String?): String {
        return existing?.takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString()
    }

    fun withName(draft: NewStopDraft, name: String): NewStopDraft {
        return draft.copy(name = name.take(NAME_MAX))
    }

    fun useMyLocation(draft: NewStopDraft, gps: GpsFix?): NewStopDraft {
        if (gps == null || !validCoordinates(gps.lat, gps.lng)) {
            return draft
        }
        return draft.copy(
            pickMode = NewStopPickMode.SELECTED,
            proposed = gps,
            locationSource = NewStopLocationSource.GPS,
        )
    }

    fun beginMapPick(draft: NewStopDraft): NewStopDraft {
        return draft.copy(pickMode = NewStopPickMode.PICKING)
    }

    fun chooseAgain(draft: NewStopDraft): NewStopDraft {
        return draft.copy(
            pickMode = NewStopPickMode.PICKING,
            proposed = null,
            locationSource = null,
        )
    }

    fun removeGeometry(draft: NewStopDraft): NewStopDraft {
        return draft.copy(
            pickMode = NewStopPickMode.NONE,
            proposed = null,
            locationSource = null,
        )
    }

    fun onMapTap(draft: NewStopDraft, lat: Double, lng: Double, nowMs: Long): NewStopDraft {
        if (draft.pickMode != NewStopPickMode.PICKING) {
            return draft
        }
        if (!validCoordinates(lat, lng)) {
            return draft
        }
        return draft.copy(
            pickMode = NewStopPickMode.SELECTED,
            proposed = GpsFix(lat, lng, null, nowMs),
            locationSource = NewStopLocationSource.MAP_PICK,
        )
    }

    fun isPickMode(draft: NewStopDraft): Boolean = draft.pickMode == NewStopPickMode.PICKING

    fun validCoordinates(lat: Double, lng: Double): Boolean {
        return lat.isFinite() && lng.isFinite() && lat >= -90.0 && lat <= 90.0 && lng >= -180.0 && lng <= 180.0
    }

    fun validationError(
        running: Boolean,
        previousStop: OrderedStopRow?,
        draft: NewStopDraft,
    ): String? {
        if (!running) {
            return "Start Survey first. That keeps GPS on and the screen awake."
        }
        if (previousStop == null) {
            return "Select the previous stop on this variant."
        }
        val name = draft.name.trim()
        if (name.isEmpty()) {
            return "Enter the proposed stop name."
        }
        if (name.length > NAME_MAX) {
            return "Enter the proposed stop name."
        }
        val proposed = draft.proposed
        if (proposed == null || draft.locationSource == null) {
            return "Choose a location for the new stop."
        }
        if (!validCoordinates(proposed.lat, proposed.lng)) {
            return "Choose a valid map location."
        }
        return null
    }

    fun canSave(running: Boolean, previousStop: OrderedStopRow?, draft: NewStopDraft): Boolean {
        return validationError(running, previousStop, draft) == null
    }

    fun successBanner(online: Boolean): String = ReportSaveReset.successBanner(online)

    fun afterSave(stops: List<OrderedStopRow>, selectedStopPublicId: String?): NewStopAfterSave {
        val after = ReportSaveReset.afterLocalSave(stops, selectedStopPublicId)
        return NewStopAfterSave(
            nextStopPublicId = after.nextStopPublicId,
            endOfRoute = after.endOfRoute,
        )
    }

    fun locationSourceCode(source: NewStopLocationSource?): String? = when (source) {
        NewStopLocationSource.GPS -> "GPS"
        NewStopLocationSource.MAP_PICK -> "MAP_PICK"
        null -> null
    }

    fun locationSelectedLabel(fix: GpsFix): String {
        val meters = fix.accuracyM?.toInt()
        return if (meters != null) "Location selected · ±${meters}m" else "Location selected"
    }
}
