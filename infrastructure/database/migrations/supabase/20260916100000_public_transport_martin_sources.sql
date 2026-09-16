-- Fixed, public-safe Martin MVT endpoints for the public transport browser.
-- Source tables remain authoritative; these functions expose rendering/selection fields only.
BEGIN;

CREATE OR REPLACE FUNCTION tiles.transport_bus_stops(z integer, x integer, y integer)
RETURNS bytea LANGUAGE sql STABLE PARALLEL SAFE AS $$
WITH bounds AS (SELECT ST_TileEnvelope(z, x, y) AS geom), features AS (
  SELECT s.id, s.public_id::text AS public_id, 'stop'::text AS feature_type,
    'bus'::text AS mode, s.stop_type AS styling_key, s.stop_type,
    coalesce(nullif(btrim(s.name_mm), ''), nullif(btrim(s.name_en), ''), nullif(btrim(s.name), '')) AS name,
    s.review_status, s.confidence_score::float8 AS confidence_score,
    ST_AsMVTGeom(ST_Transform(s.geom, 3857), b.geom, 4096, 64, true) AS geom
  FROM transport.stops s CROSS JOIN bounds b
  WHERE z >= 11 AND s.mode = 'bus'
    AND s.is_active AND s.deleted_at IS NULL AND s.geom && ST_Transform(b.geom, 4326)
    AND (z >= 15 OR (z >= 13 AND (s.confidence_score >= 80 OR s.stop_type IN ('bus_station', 'terminal')))
      OR (z <= 12 AND s.stop_type IN ('bus_station', 'terminal')))
)
SELECT ST_AsMVT(features, 'transport_bus_stops', 4096, 'geom', 'id') FROM features;
$$;

CREATE OR REPLACE FUNCTION tiles.transport_train_stations(z integer, x integer, y integer)
RETURNS bytea LANGUAGE sql STABLE PARALLEL SAFE AS $$
WITH bounds AS (SELECT ST_TileEnvelope(z, x, y) AS geom), features AS (
  SELECT s.id, s.public_id::text AS public_id, 'stop'::text AS feature_type,
    'train'::text AS mode, s.stop_type AS styling_key, s.stop_type,
    coalesce(nullif(btrim(s.name_mm), ''), nullif(btrim(s.name_en), ''), nullif(btrim(s.name), '')) AS name,
    s.review_status, s.confidence_score::float8 AS confidence_score,
    ST_AsMVTGeom(ST_Transform(s.geom, 3857), b.geom, 4096, 64, true) AS geom
  FROM transport.stops s CROSS JOIN bounds b
  WHERE z >= 8 AND s.mode = 'train'
    AND s.is_active AND s.deleted_at IS NULL AND s.geom && ST_Transform(b.geom, 4326)
    AND (z >= 12 OR s.confidence_score >= 80)
)
SELECT ST_AsMVT(features, 'transport_train_stations', 4096, 'geom', 'id') FROM features;
$$;

CREATE OR REPLACE FUNCTION tiles.transport_express_terminals(z integer, x integer, y integer)
RETURNS bytea LANGUAGE sql STABLE PARALLEL SAFE AS $$
WITH bounds AS (SELECT ST_TileEnvelope(z, x, y) AS geom), features AS (
  SELECT t.id, t.public_id::text AS public_id, 'terminal'::text AS feature_type,
    'express'::text AS mode, t.terminal_role AS styling_key, t.terminal_role,
    coalesce(nullif(btrim(t.name_mm), ''), nullif(btrim(t.name_en), ''), nullif(btrim(t.name), '')) AS name,
    t.review_status, t.confidence_score::float8 AS confidence_score,
    ST_AsMVTGeom(ST_Transform(t.geom, 3857), b.geom, 4096, 64, true) AS geom
  FROM transport.terminals t CROSS JOIN bounds b
  WHERE z >= 9 AND t.mode = 'bus'
    AND t.is_active AND t.deleted_at IS NULL AND t.geom && ST_Transform(b.geom, 4326)
    AND (z >= 12 OR t.confidence_score >= 80)
)
SELECT ST_AsMVT(features, 'transport_express_terminals', 4096, 'geom', 'id') FROM features;
$$;

CREATE OR REPLACE FUNCTION tiles.transport_bus_route_overview(z integer, x integer, y integer)
RETURNS bytea LANGUAGE sql STABLE PARALLEL SAFE AS $$
WITH bounds AS (SELECT ST_TileEnvelope(z, x, y) AS geom), features AS (
  SELECT p.id, r.public_id::text AS route_public_id, v.public_id::text AS variant_public_id,
    'route'::text AS feature_type, 'bus'::text AS mode, r.route_code,
    coalesce(nullif(btrim(r.public_name), ''), r.route_code) AS public_name,
    r.route_kind, v.variant_code, v.direction_name, p.path_kind AS styling_key,
    p.path_kind AS path_accuracy, p.confidence_score::float8 AS confidence_score,
    ST_AsMVTGeom(CASE WHEN z <= 10 THEN ST_SimplifyPreserveTopology(ST_Transform(p.geom,3857),300)
      WHEN z <= 12 THEN ST_SimplifyPreserveTopology(ST_Transform(p.geom,3857),150)
      WHEN z <= 14 THEN ST_SimplifyPreserveTopology(ST_Transform(p.geom,3857),35)
      ELSE ST_Transform(p.geom,3857) END, b.geom, 4096, 64, true) AS geom
  FROM transport.route_paths p JOIN transport.route_variants v ON v.id=p.route_variant_id
  JOIN transport.routes r ON r.id=v.route_id CROSS JOIN bounds b
  WHERE z >= 9 AND r.mode='bus'
    AND r.is_active AND v.is_active AND p.is_active
    AND r.deleted_at IS NULL AND v.deleted_at IS NULL AND p.deleted_at IS NULL
    AND p.geom && ST_Transform(b.geom,4326)
)
SELECT ST_AsMVT(features, 'transport_bus_route_overview', 4096, 'geom', 'id') FROM features;
$$;

CREATE OR REPLACE FUNCTION tiles.transport_train_routes(z integer, x integer, y integer)
RETURNS bytea LANGUAGE sql STABLE PARALLEL SAFE AS $$
WITH bounds AS (SELECT ST_TileEnvelope(z, x, y) AS geom), features AS (
  SELECT l.id, l.public_id::text AS public_id,
    'infrastructure'::text AS feature_type, 'train'::text AS mode,
    coalesce(nullif(btrim(l.name_mm), ''), nullif(btrim(l.name_en), ''), nullif(btrim(l.name), '')) AS public_name,
    l.line_type AS styling_key, l.line_type AS path_accuracy,
    l.review_status, l.confidence_score::float8 AS confidence_score,
    ST_AsMVTGeom(CASE WHEN z <= 10 THEN ST_SimplifyPreserveTopology(ST_Transform(l.geom,3857),250)
      WHEN z <= 13 THEN ST_SimplifyPreserveTopology(ST_Transform(l.geom,3857),60)
      ELSE ST_Transform(l.geom,3857) END, b.geom, 4096, 64, true) AS geom
  FROM transport.infrastructure_lines l CROSS JOIN bounds b
  WHERE z >= 7 AND l.mode='train' AND l.is_active AND l.deleted_at IS NULL
    AND l.geom && ST_Transform(b.geom,4326)
)
SELECT ST_AsMVT(features, 'transport_train_routes', 4096, 'geom', 'id') FROM features;
$$;

CREATE OR REPLACE FUNCTION tiles.transport_express_route_corridors(z integer, x integer, y integer)
RETURNS bytea LANGUAGE sql STABLE PARALLEL SAFE AS $$
WITH bounds AS (SELECT ST_TileEnvelope(z, x, y) AS geom), features AS (
  SELECT p.id, r.public_id::text AS route_public_id, v.public_id::text AS variant_public_id,
    'route'::text AS feature_type, 'express'::text AS mode, r.route_code,
    coalesce(nullif(btrim(r.public_name), ''), r.route_code) AS public_name,
    r.route_kind, v.variant_code, v.direction_name, p.path_kind AS styling_key,
    p.path_kind AS path_accuracy, p.confidence_score::float8 AS confidence_score,
    ST_AsMVTGeom(CASE WHEN z <= 10 THEN ST_SimplifyPreserveTopology(ST_Transform(p.geom,3857),350)
      WHEN z <= 13 THEN ST_SimplifyPreserveTopology(ST_Transform(p.geom,3857),80)
      ELSE ST_Transform(p.geom,3857) END, b.geom, 4096, 64, true) AS geom
  FROM transport.route_paths p JOIN transport.route_variants v ON v.id=p.route_variant_id
  JOIN transport.routes r ON r.id=v.route_id CROSS JOIN bounds b
  WHERE z >= 7 AND r.mode='express_bus'
    AND r.is_active AND v.is_active AND p.is_active
    AND r.deleted_at IS NULL AND v.deleted_at IS NULL AND p.deleted_at IS NULL
    AND p.geom && ST_Transform(b.geom,4326) AND (z >= 11 OR p.confidence_score >= 80)
)
SELECT ST_AsMVT(features, 'transport_express_route_corridors', 4096, 'geom', 'id') FROM features;
$$;

COMMENT ON FUNCTION tiles.transport_bus_stops(integer,integer,integer) IS 'All active bus stops, zoom filtered for Martin.';
COMMENT ON FUNCTION tiles.transport_bus_route_overview(integer,integer,integer) IS 'All active bus route paths with zoom simplification.';
COMMENT ON FUNCTION tiles.transport_train_stations(integer,integer,integer) IS 'All active train stations, zoom filtered for Martin.';
COMMENT ON FUNCTION tiles.transport_train_routes(integer,integer,integer) IS 'All active train paths with zoom simplification.';
COMMENT ON FUNCTION tiles.transport_express_terminals(integer,integer,integer) IS 'All active express terminals, zoom filtered for Martin.';
COMMENT ON FUNCTION tiles.transport_express_route_corridors(integer,integer,integer) IS 'All active express corridors with zoom simplification.';

COMMIT;
