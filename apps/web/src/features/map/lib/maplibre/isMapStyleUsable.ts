/**
 * MapLibre sets `map.style` to undefined after `map.remove()`.
 * Callers must check this before getLayer/getSource/moveLayer.
 */
import type { MapEngine } from '../mapEngineTypes';

export function isMapStyleUsable(map: MapEngine | null | undefined): map is MapEngine {
  return Boolean(map && map.style);
}
