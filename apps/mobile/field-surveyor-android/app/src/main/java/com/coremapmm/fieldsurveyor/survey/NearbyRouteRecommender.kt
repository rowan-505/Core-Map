package com.coremapmm.fieldsurveyor.survey

import com.coremapmm.fieldsurveyor.data.transport.TransportCacheDao
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class NearbyRouteRecommender(
    private val cache: TransportCacheDao,
) {
    suspend fun recommend(fix: GpsFix, nowMs: Long = 0L): List<NearbyRouteRecommendation> =
        withContext(Dispatchers.IO) {
            val radius = NearbyRoutePolicy.candidateRadiusM(fix.accuracyM)
            val box = NearbyRoutePolicy.boundingBox(fix.lat, fix.lng, radius)
            val rows = cache.servingVariantsInBounds(box.minLat, box.maxLat, box.minLng, box.maxLng)
            NearbyRouteRanker.rank(fix.lat, fix.lng, rows, radius)
        }
}
