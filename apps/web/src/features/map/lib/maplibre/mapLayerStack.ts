import type { MapEngine } from '../mapEngineTypes';
import { isMapStyleUsable } from './isMapStyleUsable';

/**
 * Reorders existing layers so the array runs bottom → top (last entry is topmost).
 * Each id is moved to the top in sequence; missing layers are skipped.
 */
export function applyMapLayerStackBottomToTop(
  map: MapEngine,
  layerIds: readonly string[],
): void {
  if (!isMapStyleUsable(map)) return;
  for (const layerId of layerIds) {
    if (!map.getLayer(layerId)) continue;
    map.moveLayer(layerId);
  }
}
