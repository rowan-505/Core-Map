package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.LocalSurveySessionDao
import com.coremapmm.fieldsurveyor.data.transport.TransportCacheDao
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class NearbyRouteRecommender(
    private val cache: TransportCacheDao,
    private val sessions: LocalSurveySessionDao,
) {
    suspend fun recommend(fix: GpsFix, nowMs: Long): List<NearbyRouteRecommendation> = withContext(Dispatchers.IO) {
        val box = NearbyRoutePolicy.boundingBox(fix.lat, fix.lng)
        val rows = cache.servingVariantsInBounds(box.minLat, box.maxLat, box.minLng, box.maxLng)
        val history = sessions.lastSurveyByVariant().associate { it.variantPublicId to it.lastStartedAtEpochMs }
        NearbyRouteRanker.rank(fix.lat, fix.lng, rows, history, nowMs)
    }
}
