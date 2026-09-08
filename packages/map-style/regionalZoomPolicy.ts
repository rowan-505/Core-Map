/**
 * Regional basemap zoom policy (PMTiles native detail vs public map camera).
 *
 * - Native regional PMTiles: z8–z16 (tippecanoe)
 * - Public map camera: up to z20
 * - Camera z17–z20: MapLibre overzooms the native z16 tiles
 *
 * Important: vector `source.maxzoom` must equal the archive native max (16), not the
 * camera max (20). If source.maxzoom is set to 20 while tiles only exist through 16,
 * MapLibre requests nonexistent z17–z20 PMTiles coordinates.
 */

/** Native max zoom baked into regional PMTiles archives (tippecanoe). */
export const NATIVE_REGION_TILE_MAX_ZOOM = 16 as const;

/** Public web map camera max zoom (overzooms native tiles above {@link NATIVE_REGION_TILE_MAX_ZOOM}). */
export const PUBLIC_MAP_MAX_ZOOM = 20 as const;

/**
 * MapLibre vector source maxzoom for regional archives.
 * Equals native tile max so z17–z20 overzoom instead of fetching missing tiles.
 */
export const REGIONAL_VECTOR_SOURCE_OVERZOOM_MAX_ZOOM = NATIVE_REGION_TILE_MAX_ZOOM;

/**
 * Minimum MapLibre layer maxzoom for basemap geometry that must stay visible
 * through {@link PUBLIC_MAP_MAX_ZOOM} (layers stay on while the source overzooms).
 */
export const REGIONAL_LAYER_OVERZOOM_MIN_MAX_ZOOM = PUBLIC_MAP_MAX_ZOOM;

/** Recommended public map max zoom written to regional current.json pointers. */
export const RECOMMENDED_REGIONAL_MAP_MAX_ZOOM = PUBLIC_MAP_MAX_ZOOM;

/**
 * Clamp a declared archive maxzoom to the native regional ceiling.
 * Prevents MapLibre from requesting nonexistent z17–z20 PMTiles when a pointer
 * still advertises camera-era maxzoom values.
 */
export function clampRegionalVectorSourceMaxZoom(declaredMaxZoom?: number): number {
  if (typeof declaredMaxZoom === 'number' && Number.isFinite(declaredMaxZoom)) {
    return Math.min(declaredMaxZoom, NATIVE_REGION_TILE_MAX_ZOOM);
  }
  return NATIVE_REGION_TILE_MAX_ZOOM;
}
