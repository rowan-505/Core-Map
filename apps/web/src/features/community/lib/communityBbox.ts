/**
 * Viewport / "Search this area" helpers for Community geotagged markers.
 * Feed lists do not auto-refetch on every map move — only after an explicit search.
 */

export type CommunityBbox = readonly [west: number, south: number, east: number, north: number];

export function formatCommunityBbox(bbox: CommunityBbox): string {
  return `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`;
}

export function communityBboxCenter(bbox: CommunityBbox): readonly [number, number] {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

/**
 * True when the live viewport has moved enough to warrant a "Search this area" prompt.
 * Uses relative center drift (fraction of viewport span) and absolute zoom delta.
 */
export function shouldOfferCommunityAreaSearch(input: {
  readonly committed: CommunityBbox;
  readonly live: CommunityBbox;
  readonly committedZoom: number;
  readonly liveZoom: number;
  readonly centerDriftFraction?: number;
  readonly zoomDelta?: number;
}): boolean {
  const driftThreshold = input.centerDriftFraction ?? 0.18;
  const zoomThreshold = input.zoomDelta ?? 0.6;

  if (Math.abs(input.liveZoom - input.committedZoom) >= zoomThreshold) {
    return true;
  }

  const [cWest, cSouth, cEast, cNorth] = input.committed;
  const [lWest, lSouth, lEast, lNorth] = input.live;
  const cWidth = Math.max(cEast - cWest, 1e-9);
  const cHeight = Math.max(cNorth - cSouth, 1e-9);
  const [cLng, cLat] = communityBboxCenter(input.committed);
  const [lLng, lLat] = communityBboxCenter(input.live);
  const lngDrift = Math.abs(lLng - cLng) / cWidth;
  const latDrift = Math.abs(lLat - cLat) / cHeight;
  if (lngDrift >= driftThreshold || latDrift >= driftThreshold) {
    return true;
  }

  // Large resize of the box (rotate/pitch/resize) also counts.
  const liveWidth = Math.max(lEast - lWest, 1e-9);
  const liveHeight = Math.max(lNorth - lSouth, 1e-9);
  const widthRatio = liveWidth / cWidth;
  const heightRatio = liveHeight / cHeight;
  return widthRatio < 0.7 || widthRatio > 1.4 || heightRatio < 0.7 || heightRatio > 1.4;
}
