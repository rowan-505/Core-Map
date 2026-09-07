package com.coremapmm.fieldsurveyor.data.transport

/** Counterpart D0/D1 lookup from the local snapshot. Never reverse stops or rewrite ids. */
object OppositeVariantLookup {
    const val MISSING_COUNTERPART_MESSAGE =
        "Opposite direction is not in this snapshot. Refresh routes to switch."

    fun counterpart(
        variants: List<CacheVariantEntity>,
        currentPublicId: String,
    ): CacheVariantEntity? {
        val current = variants.firstOrNull { it.publicId == currentPublicId } ?: return null
        val oppositeDirection = if (current.directionId == 0) 1 else 0
        val sameRoute = variants.filter { it.routePublicId == current.routePublicId }
        if (sameRoute.count { it.directionId == current.directionId } != 1) {
            return null
        }
        val matches = sameRoute.filter { it.directionId == oppositeDirection }
        return matches.singleOrNull()
    }

    fun idsByPublicId(variants: List<CacheVariantEntity>): Map<String, String> {
        return variants.mapNotNull { variant ->
            counterpart(variants, variant.publicId)?.let { variant.publicId to it.publicId }
        }.toMap()
    }
}

data class DirectionSwitchTarget(
    val selection: RouteSelectionRow,
    val oppositeCode: String,
    val stops: List<OrderedStopRow>,
    val pathJson: String,
)

object DirectionSwitchResolver {
    fun resolve(
        currentVariantPublicId: String?,
        variants: List<CacheVariantEntity>,
        selections: List<RouteSelectionRow>,
        counterpartStops: List<OrderedStopRow>,
        counterpartPathJson: String?,
    ): DirectionSwitchTarget? {
        val currentId = currentVariantPublicId ?: return null
        val counterpart = OppositeVariantLookup.counterpart(variants, currentId) ?: return null
        if (counterpart.publicId == currentId) return null
        val selection = selections.firstOrNull { it.variantPublicId == counterpart.publicId } ?: return null
        if (counterpartStops.isEmpty()) return null
        if (counterpartStops.any { it.variantPublicId.isNotEmpty() && it.variantPublicId != counterpart.publicId }) {
            return null
        }
        if (counterpartPathJson.isNullOrBlank() || !RoutePathGeometry.hasLineString(counterpartPathJson)) {
            return null
        }
        return DirectionSwitchTarget(
            selection = selection,
            oppositeCode = counterpart.variantCode,
            stops = counterpartStops,
            pathJson = counterpartPathJson,
        )
    }
}
