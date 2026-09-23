import type { AddProtocolAction, LayerSpecification, StyleSpecification } from "maplibre-gl";
import BaseMapStyle from "../../../../../packages/map-style/base-map.json";
import OverviewMapStyle from "../../../../../packages/map-style/overview-map.json";
import webBasemapManifest from "../../../../../apps/web/public/basemaps/manifest.json";

export const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#e8eef5" },
    },
  ],
};

type BBox = [number, number, number, number];

type Package = {
  id: string;
  version: string;
  url: string;
  bounds: BBox;
  minZoom?: number;
  maxZoom?: number;
};

type Manifest = {
  overview: Package;
  regions: Package[];
};

/** Same production manifest the public web map uses (`apps/web/public/basemaps/manifest.json`). */
const MANIFEST = webBasemapManifest as Manifest;

const CDN_HOST = "tiles.coremapmm.com";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toPmtilesUrl(httpUrl: string): string {
  return httpUrl.startsWith("pmtiles://") ? httpUrl : `pmtiles://${httpUrl}`;
}

function pointInBounds(lon: number, lat: number, bounds: BBox): boolean {
  const [west, south, east, north] = bounds;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

function containmentScore(lon: number, lat: number, bounds: BBox): number {
  if (!pointInBounds(lon, lat, bounds)) return 0;
  const [west, south, east, north] = bounds;
  return 1 / ((east - west) * (north - south) + 1e-9);
}

/** Pick the tightest regional package whose bounds contain lon/lat (same idea as web region loader). */
export function pickRegionId(lon: number, lat: number): string {
  let best = "yangon";
  let bestScore = -1;
  for (const region of MANIFEST.regions) {
    const score = containmentScore(lon, lat, region.bounds);
    if (score > bestScore) {
      bestScore = score;
      best = region.id;
    }
  }
  return best;
}

export function getRegionPackage(regionId: string): Package {
  return (
    MANIFEST.regions.find((r) => r.id === regionId) ||
    MANIFEST.regions.find((r) => r.id === "yangon") ||
    MANIFEST.regions[0]
  );
}

export function getOverviewPackage(): Package {
  return MANIFEST.overview;
}

/** Local fallback only when CDN is unreachable. */
function localFallbackUrls(origin: string, regionId: string): { overview: string; regional: string } {
  return {
    overview: `${origin}/local-tiles/overview/myanmar-overview-v1.pmtiles`,
    regional: `${origin}/local-tiles/regions/${regionId}/${regionId}-v1.pmtiles`,
  };
}

export type BasemapUrls = {
  regionId: string;
  overviewHttp: string;
  regionalHttp: string;
  source: "cdn" | "local-fallback";
};

/**
 * Resolve overview + regional HTTP URLs.
 * Primary = tiles.coremapmm.com from the public web manifest.
 * Do not preflight HEAD from the browser — CORS often blocks it even when
 * MapLibre/pmtiles Range requests succeed. Use forceLocal only for debug.
 */
export async function resolveBasemapUrls(args: {
  origin: string;
  regionId: string;
  forceLocal?: boolean;
}): Promise<BasemapUrls> {
  const overviewPkg = getOverviewPackage();
  const regionPkg = getRegionPackage(args.regionId);

  if (args.forceLocal) {
    const local = localFallbackUrls(args.origin, regionPkg.id);
    return {
      regionId: regionPkg.id,
      overviewHttp: local.overview,
      regionalHttp: local.regional,
      source: "local-fallback",
    };
  }

  void args.origin;
  void CDN_HOST;
  return {
    regionId: regionPkg.id,
    overviewHttp: overviewPkg.url,
    regionalHttp: regionPkg.url,
    source: "cdn",
  };
}

/**
 * Overview + one regional package — same CDN files as the public web map.
 * Glyphs stay local (`/fonts`) so Myanmar labels render without the web app.
 */
export function buildReviewBasemapStyle(args: {
  overviewHttp: string;
  regionalHttp: string;
  regionId: string;
}): StyleSpecification {
  const regional = cloneJson(BaseMapStyle) as StyleSpecification;
  const overview = cloneJson(OverviewMapStyle) as StyleSpecification;

  const overviewLayers = (overview.layers ?? []).filter(
    (l) => l.id !== "background",
  ) as LayerSpecification[];
  const regionalLayers = (regional.layers ?? []) as LayerSpecification[];
  const background = regionalLayers.find((l) => l.id === "background");
  const regionalRest = regionalLayers.filter((l) => l.id !== "background");

  return {
    ...regional,
    name: `Phase3 review — overview + ${args.regionId}`,
    glyphs: "/fonts/{fontstack}/{range}.pbf",
    sources: {
      overview: {
        type: "vector",
        url: toPmtilesUrl(args.overviewHttp),
        minzoom: 0,
        maxzoom: getOverviewPackage().maxZoom ?? 8,
      },
      "local-basemap": {
        type: "vector",
        url: toPmtilesUrl(args.regionalHttp),
        minzoom: 0,
        maxzoom: 16,
      },
    },
    layers: [...(background ? [background] : []), ...overviewLayers, ...regionalRest],
  };
}

/** @deprecated Use {@link buildReviewBasemapStyle} after {@link resolveBasemapUrls}. */
export function buildLocalBasemapStyle(args: {
  origin: string;
  regionId: string;
}): StyleSpecification {
  const region = getRegionPackage(args.regionId);
  return buildReviewBasemapStyle({
    overviewHttp: getOverviewPackage().url,
    regionalHttp: region.url,
    regionId: region.id,
  });
}

export function centroidFromFeatureCollection(
  fc: GeoJSON.FeatureCollection | null | undefined,
): [number, number] | null {
  if (!fc?.features?.length) return null;
  const b = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  const add = (coords: unknown) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      b.minX = Math.min(b.minX, coords[0]);
      b.minY = Math.min(b.minY, coords[1]);
      b.maxX = Math.max(b.maxX, coords[0]);
      b.maxY = Math.max(b.maxY, coords[1]);
      return;
    }
    for (const c of coords) add(c);
  };
  for (const f of fc.features) {
    if (f.geometry) add((f.geometry as GeoJSON.Geometry & { coordinates: unknown }).coordinates);
  }
  if (!Number.isFinite(b.minX)) return null;
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

let protocolReady: Promise<void> | null = null;

type PmtilesHost = {
  addProtocol: (customProtocol: string, loadFn: AddProtocolAction) => void;
};

/** Register `pmtiles://` once for MapLibre in this tab. */
export async function ensurePmtilesProtocol(maplibre: PmtilesHost): Promise<void> {
  const g = globalThis as typeof globalThis & { __phase3PmtilesRegistered?: boolean };
  if (g.__phase3PmtilesRegistered) return;
  if (!protocolReady) {
    protocolReady = (async () => {
      if (g.__phase3PmtilesRegistered) return;
      const { Protocol } = await import("pmtiles");
      const protocol = new Protocol();
      maplibre.addProtocol("pmtiles", protocol.tile);
      g.__phase3PmtilesRegistered = true;
    })();
  }
  await protocolReady;
}
