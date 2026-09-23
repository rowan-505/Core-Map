import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ReviewItem } from "../lib/types";
import {
  BLANK_STYLE,
  buildReviewBasemapStyle,
  centroidFromFeatureCollection,
  ensurePmtilesProtocol,
  pickRegionId,
  resolveBasemapUrls,
} from "../lib/basemap";

type Props = {
  item: ReviewItem | null;
  selectedCandidateId: string;
  showSource: boolean;
  showSelected: boolean;
  showOthers: boolean;
  showBasemap: boolean;
  showClipPreview: boolean;
  clipPreviewPath: string;
  fitToken: number;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}

function boundsFromFc(fc: GeoJSON.FeatureCollection): maplibregl.LngLatBoundsLike | null {
  const b = new maplibregl.LngLatBounds();
  let any = false;
  const add = (coords: unknown) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      b.extend([coords[0] as number, coords[1] as number]);
      any = true;
      return;
    }
    for (const c of coords) add(c);
  };
  for (const f of fc.features) {
    if (f.geometry) add((f.geometry as GeoJSON.Geometry & { coordinates: unknown }).coordinates);
  }
  return any ? b : null;
}

function labelPointFromGeom(geom: GeoJSON.Geometry | null | undefined): [number, number] | null {
  if (!geom) return null;
  if (geom.type === "Point") return geom.coordinates as [number, number];
  const fake: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: geom }],
  };
  return centroidFromFeatureCollection(fake);
}

function clearReviewOverlays(map: Map) {
  for (const id of [
    "src-fill",
    "src-line",
    "src-point",
    "src-label",
    "other-fill",
    "other-line",
    "other-point",
    "sel-fill",
    "sel-line",
    "sel-point",
    "dist-lines",
    "dist-labels",
    "clip-before-fill",
    "clip-before-line",
    "clip-after-fill",
    "clip-after-line",
    "clip-mimu-fill",
    "clip-mimu-line",
    "clip-inter-fill",
    "clip-inter-line",
  ]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [
    "source-fc",
    "other-fc",
    "selected-fc",
    "label-fc",
    "dist-fc",
    "clip-before-fc",
    "clip-after-fc",
    "clip-mimu-fc",
    "clip-inter-fc",
  ]) {
    if (map.getSource(id)) map.removeSource(id);
  }
}

function waitForStyle(map: Map): Promise<void> {
  return new Promise((resolve) => {
    if (map.isStyleLoaded()) {
      resolve();
      return;
    }
    map.once("style.load", () => resolve());
  });
}

export function ReviewMap({
  item,
  selectedCandidateId,
  showSource,
  showSelected,
  showOthers,
  showBasemap,
  showClipPreview,
  clipPreviewPath,
  fitToken,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const regionRef = useRef<string>("");
  const basemapOnRef = useRef<boolean | null>(null);
  const runIdRef = useRef(0);
  const [mapReady, setMapReady] = useState(false);
  const [basemapError, setBasemapError] = useState("");

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    let map: Map | null = null;

    const boot = async () => {
      try {
        await ensurePmtilesProtocol(maplibregl);
      } catch (err) {
        console.error(err);
        if (!cancelled) setBasemapError("PMTiles protocol failed to load");
      }
      if (cancelled || !containerRef.current) return;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: BLANK_STYLE,
        center: [96.1, 16.8],
        zoom: 5.2,
        attributionControl: false,
        maxPitch: 0,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("error", (e) => {
        console.error("[map]", e.error);
      });
      await waitForStyle(map);
      if (cancelled) {
        map.remove();
        return;
      }
      mapRef.current = map;
      (window as unknown as { __phase3Map?: Map }).__phase3Map = map;
      map.resize();
      setMapReady(true);
      // Layout can settle after flex paint
      requestAnimationFrame(() => {
        map?.resize();
      });
    };

    void boot();
    return () => {
      cancelled = true;
      setMapReady(false);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      } else if (map) {
        map.remove();
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !item) return;
    const runId = ++runIdRef.current;
    let cancelled = false;

    const run = async () => {
      setBasemapError("");
      await ensurePmtilesProtocol(maplibregl);
      if (cancelled || runId !== runIdRef.current) return;

      let sourceFc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
      if (item.previewPath) {
        try {
          sourceFc = await fetchJson(`/api/preview?path=${encodeURIComponent(item.previewPath)}`);
        } catch {
          sourceFc = { type: "FeatureCollection", features: [] };
        }
      }

      const ids = item.candidates.map((c) => c.id);
      let candFc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
      if (ids.length) {
        const kind = item.queue === "village" ? "settlement" : "wvt";
        const mergeKind =
          item.queue === "merge"
            ? item.entityType === "village"
              ? "settlement"
              : "wvt"
            : kind;
        try {
          candFc = await fetchJson(
            `/api/candidate-geoms?kind=${mergeKind}&ids=${encodeURIComponent(ids.join(","))}`,
          );
        } catch {
          candFc = { type: "FeatureCollection", features: [] };
        }
      }
      if (cancelled || runId !== runIdRef.current) return;

      candFc = {
        type: "FeatureCollection",
        features: candFc.features.map((f) => {
          const id = String(f.properties?.id ?? "");
          const cand = item.candidates.find((c) => c.id === id);
          return {
            ...f,
            properties: {
              ...f.properties,
              id,
              index: cand?.index ?? 0,
              label: cand ? `Candidate #${cand.index}` : id,
            },
          };
        }),
      };

      const centroid =
        centroidFromFeatureCollection(sourceFc) ||
        centroidFromFeatureCollection(candFc) ||
        ([96.1, 16.8] as [number, number]);
      const regionId = pickRegionId(centroid[0], centroid[1]);

      const needStyleSwap =
        showBasemap !== basemapOnRef.current ||
        (showBasemap && regionId !== regionRef.current);

      if (needStyleSwap) {
        try {
          let style = BLANK_STYLE;
          if (showBasemap) {
            const urls = await resolveBasemapUrls({
              origin: window.location.origin,
              regionId,
            });
            style = buildReviewBasemapStyle({
              overviewHttp: urls.overviewHttp,
              regionalHttp: urls.regionalHttp,
              regionId: urls.regionId,
            });
            console.info(
              `[phase3-viewer] basemap ${urls.source}: region=${urls.regionId}`,
              urls.regionalHttp,
            );
            setBasemapError(
              urls.source === "local-fallback"
                ? "Using local /local-tiles fallback"
                : "",
            );
          } else {
            setBasemapError("");
          }
          map.setStyle(style, { diff: false });
          await waitForStyle(map);
          await new Promise((r) => setTimeout(r, 50));
          if (cancelled || runId !== runIdRef.current) return;
          regionRef.current = regionId;
          basemapOnRef.current = showBasemap;
          map.resize();
        } catch (err) {
          console.error(err);
          setBasemapError("Could not load basemap style");
        }
      }

      if (cancelled || runId !== runIdRef.current) return;
      if (!map.isStyleLoaded()) await waitForStyle(map);
      clearReviewOverlays(map);

      // Clip preview mode: MIMU new (orange) / CoreMap before (gray) / after (green) / overlap (red)
      if (showClipPreview && clipPreviewPath) {
        let clipFc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
        try {
          clipFc = await fetchJson(
            `/api/preview?path=${encodeURIComponent(clipPreviewPath)}`,
          );
        } catch {
          clipFc = { type: "FeatureCollection", features: [] };
        }
        if (cancelled || runId !== runIdRef.current) return;

        const byRole = (role: string) =>
          ({
            type: "FeatureCollection" as const,
            features: clipFc.features.filter((f) => String(f.properties?.role || "") === role),
          }) satisfies GeoJSON.FeatureCollection;

        const beforeFc = byRole("core_before");
        const afterFc = byRole("core_after");
        const mimuFc = byRole("mimu_new").features.length
          ? byRole("mimu_new")
          : byRole("mimu_union");
        const interFc = byRole("intersection");

        map.addSource("clip-before-fc", { type: "geojson", data: beforeFc });
        map.addSource("clip-after-fc", { type: "geojson", data: afterFc });
        map.addSource("clip-mimu-fc", { type: "geojson", data: mimuFc });
        map.addSource("clip-inter-fc", { type: "geojson", data: interFc });

        map.addLayer({
          id: "clip-before-fill",
          type: "fill",
          source: "clip-before-fc",
          paint: { "fill-color": "#64748b", "fill-opacity": 0.08 },
        });
        map.addLayer({
          id: "clip-before-line",
          type: "line",
          source: "clip-before-fc",
          paint: {
            "line-color": "#64748b",
            "line-width": 2,
            "line-dasharray": [2, 2],
            "line-opacity": 0.85,
          },
        });
        map.addLayer({
          id: "clip-inter-fill",
          type: "fill",
          source: "clip-inter-fc",
          paint: { "fill-color": "#dc2626", "fill-opacity": 0.28 },
        });
        map.addLayer({
          id: "clip-inter-line",
          type: "line",
          source: "clip-inter-fc",
          paint: { "line-color": "#b91c1c", "line-width": 1.5 },
        });
        map.addLayer({
          id: "clip-after-fill",
          type: "fill",
          source: "clip-after-fc",
          paint: { "fill-color": "#16A34A", "fill-opacity": 0.2 },
        });
        map.addLayer({
          id: "clip-after-line",
          type: "line",
          source: "clip-after-fc",
          paint: { "line-color": "#16A34A", "line-width": 3 },
        });
        map.addLayer({
          id: "clip-mimu-fill",
          type: "fill",
          source: "clip-mimu-fc",
          paint: { "fill-color": "#F59E0B", "fill-opacity": 0.28 },
        });
        map.addLayer({
          id: "clip-mimu-line",
          type: "line",
          source: "clip-mimu-fc",
          paint: { "line-color": "#F59E0B", "line-width": 3.5 },
        });

        const labelFeatures: GeoJSON.Feature[] = [];
        for (const [fc, label, color] of [
          [mimuFc, "MIMU new", "#b45309"],
          [afterFc, "CoreMap after clip", "#14532d"],
          [beforeFc, "CoreMap before", "#475569"],
          [interFc, "Overlap removed", "#991b1b"],
        ] as const) {
          const g = fc.features[0]?.geometry;
          const pt = labelPointFromGeom(g);
          if (!pt) continue;
          labelFeatures.push({
            type: "Feature",
            properties: { label, color },
            geometry: { type: "Point", coordinates: pt },
          });
        }
        map.addSource("label-fc", {
          type: "geojson",
          data: { type: "FeatureCollection", features: labelFeatures },
        });
        map.addLayer({
          id: "src-label",
          type: "symbol",
          source: "label-fc",
          layout: {
            "text-field": ["get", "label"],
            "text-size": 13,
            "text-offset": [0, -1.4],
            "text-anchor": "bottom",
            "text-allow-overlap": true,
            "text-font": ["NotoSans-Regular"],
          },
          paint: {
            "text-color": ["get", "color"],
            "text-halo-color": "#ffffff",
            "text-halo-width": 2,
          },
        });

        const b = boundsFromFc(clipFc);
        if (b) map.fitBounds(b, { padding: 56, maxZoom: 15, duration: 350 });
        return;
      }

      const selectedFc: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: showSelected
          ? candFc.features.filter((f) => String(f.properties?.id) === selectedCandidateId)
          : [],
      };
      const otherFc: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: showOthers
          ? candFc.features.filter((f) => String(f.properties?.id) !== selectedCandidateId)
          : [],
      };

      const sourceData = showSource ? sourceFc : { type: "FeatureCollection" as const, features: [] };
      map.addSource("source-fc", { type: "geojson", data: sourceData });
      map.addSource("other-fc", { type: "geojson", data: otherFc });
      map.addSource("selected-fc", { type: "geojson", data: selectedFc });

      const isPoint =
        item.queue === "village" ||
        (item.queue === "merge" && item.entityType === "village") ||
        sourceFc.features[0]?.geometry?.type === "Point";

      const labelFeatures: GeoJSON.Feature[] = [];
      if (showSource && sourceFc.features[0]?.geometry) {
        const pt = labelPointFromGeom(sourceFc.features[0].geometry);
        if (pt) {
          labelFeatures.push({
            type: "Feature",
            properties: { label: "SOURCE (MIMU)", color: "#b45309" },
            geometry: { type: "Point", coordinates: pt },
          });
        }
      }
      for (const f of selectedFc.features) {
        const pt = labelPointFromGeom(f.geometry);
        if (!pt) continue;
        labelFeatures.push({
          type: "Feature",
          properties: {
            label: `SELECTED #${f.properties?.index ?? "?"}`,
            color: "#14532d",
          },
          geometry: { type: "Point", coordinates: pt },
        });
      }
      if (showOthers) {
        for (const f of otherFc.features) {
          const pt = labelPointFromGeom(f.geometry);
          if (!pt) continue;
          labelFeatures.push({
            type: "Feature",
            properties: {
              label: `#${f.properties?.index ?? "?"}`,
              color: "#1e3a8a",
            },
            geometry: { type: "Point", coordinates: pt },
          });
        }
      }
      map.addSource("label-fc", {
        type: "geojson",
        data: { type: "FeatureCollection", features: labelFeatures },
      });

      if (!isPoint) {
        map.addLayer({
          id: "other-fill",
          type: "fill",
          source: "other-fc",
          paint: { "fill-color": "#2563EB", "fill-opacity": 0.06 },
        });
        map.addLayer({
          id: "other-line",
          type: "line",
          source: "other-fc",
          paint: { "line-color": "#2563EB", "line-width": 1.5, "line-opacity": 0.45 },
        });
        map.addLayer({
          id: "src-fill",
          type: "fill",
          source: "source-fc",
          paint: { "fill-color": "#F59E0B", "fill-opacity": 0.22 },
        });
        map.addLayer({
          id: "src-line",
          type: "line",
          source: "source-fc",
          paint: { "line-color": "#F59E0B", "line-width": 3.5 },
        });
        map.addLayer({
          id: "sel-fill",
          type: "fill",
          source: "selected-fc",
          paint: { "fill-color": "#16A34A", "fill-opacity": 0.12 },
        });
        map.addLayer({
          id: "sel-line",
          type: "line",
          source: "selected-fc",
          paint: { "line-color": "#16A34A", "line-width": 3.5 },
        });
      } else {
        map.addLayer({
          id: "other-point",
          type: "circle",
          source: "other-fc",
          paint: {
            "circle-radius": 6,
            "circle-color": "#2563EB",
            "circle-opacity": 0.45,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#1e3a8a",
          },
        });
        map.addLayer({
          id: "src-point",
          type: "symbol",
          source: "source-fc",
          layout: {
            "text-field": "◆",
            "text-size": 24,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": "#F59E0B",
            "text-halo-color": "#b45309",
            "text-halo-width": 1.4,
          },
        });
        map.addLayer({
          id: "sel-point",
          type: "circle",
          source: "selected-fc",
          paint: {
            "circle-radius": 10,
            "circle-color": "#16A34A",
            "circle-stroke-width": 2.5,
            "circle-stroke-color": "#14532d",
          },
        });

        const srcPt = sourceFc.features[0]?.geometry;
        const distFeatures: GeoJSON.Feature[] = [];
        if (showSource && srcPt && srcPt.type === "Point") {
          const [sx, sy] = srcPt.coordinates as [number, number];
          const targets = [
            ...(showSelected ? selectedFc.features : []),
            ...(showOthers ? otherFc.features : []),
          ];
          for (const f of targets) {
            if (f.geometry?.type !== "Point") continue;
            const [cx, cy] = f.geometry.coordinates as [number, number];
            const id = String(f.properties?.id ?? "");
            const cand = item.candidates.find((c) => c.id === id);
            const meters = cand?.distanceM;
            distFeatures.push({
              type: "Feature",
              properties: {
                label: meters != null ? `${Math.round(meters)} m` : "",
              },
              geometry: {
                type: "LineString",
                coordinates: [
                  [sx, sy],
                  [cx, cy],
                ],
              },
            });
          }
        }
        map.addSource("dist-fc", {
          type: "geojson",
          data: { type: "FeatureCollection", features: distFeatures },
        });
        map.addLayer({
          id: "dist-lines",
          type: "line",
          source: "dist-fc",
          paint: { "line-color": "#64748b", "line-width": 1.2, "line-dasharray": [2, 2] },
        });
        map.addLayer({
          id: "dist-labels",
          type: "symbol",
          source: "dist-fc",
          layout: {
            "symbol-placement": "line-center",
            "text-field": ["get", "label"],
            "text-size": 12,
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#334155", "text-halo-color": "#fff", "text-halo-width": 1.5 },
        });
      }

      map.addLayer({
        id: "src-label",
        type: "symbol",
        source: "label-fc",
        layout: {
          "text-field": ["get", "label"],
          "text-size": 13,
          "text-offset": [0, -1.4],
          "text-anchor": "bottom",
          "text-allow-overlap": true,
          "text-font": ["NotoSans-Regular"],
        },
        paint: {
          "text-color": ["get", "color"],
          "text-halo-color": "#ffffff",
          "text-halo-width": 2,
        },
      });

      const combined: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          ...(showSource ? sourceFc.features : []),
          ...selectedFc.features,
          ...otherFc.features,
        ],
      };
      const b = boundsFromFc(combined);
      if (b) map.fitBounds(b, { padding: 56, maxZoom: 15, duration: 350 });
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    mapReady,
    item,
    selectedCandidateId,
    showSource,
    showSelected,
    showOthers,
    showBasemap,
    showClipPreview,
    clipPreviewPath,
    fitToken,
  ]);

  return (
    <div className="map-el-wrap">
      <div className="map-el" ref={containerRef} />
      {basemapError ? <div className="map-error">{basemapError}</div> : null}
    </div>
  );
}
