-- Run after 20260916100000_public_transport_martin_sources.sql.
-- Every query should return the noted result without mutating data.

-- 1. Six fixed MVT functions exist (expect 6).
SELECT count(*) AS function_count
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'tiles'
  AND p.proname IN (
    'transport_bus_stops',
    'transport_bus_route_overview',
    'transport_train_stations',
    'transport_train_routes',
    'transport_express_terminals',
    'transport_express_route_corridors'
  );

-- 2. Bus stops are suppressed below z11 (expect 0 bytes or an empty MVT payload).
SELECT octet_length(tiles.transport_bus_stops(10, 785, 469)) AS z10_bytes;

-- 3. Smoke-call each endpoint at a Myanmar tile (all return bytea; empty is valid where no data).
SELECT
  octet_length(tiles.transport_bus_stops(13, 6283, 3743)) AS bus_stops_bytes,
  octet_length(tiles.transport_bus_route_overview(13, 6283, 3743)) AS bus_paths_bytes,
  octet_length(tiles.transport_train_stations(13, 6283, 3743)) AS train_stations_bytes,
  octet_length(tiles.transport_train_routes(13, 6283, 3743)) AS train_paths_bytes,
  octet_length(tiles.transport_express_terminals(13, 6283, 3743)) AS express_terminals_bytes,
  octet_length(tiles.transport_express_route_corridors(13, 6283, 3743)) AS express_paths_bytes;

-- 4. Existing source geometry indexes used by bbox predicates (inspect; expect GiST indexes).
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'transport'
  AND tablename IN ('stops', 'terminals', 'route_paths')
  AND indexdef ILIKE '%gist%'
ORDER BY tablename, indexname;

-- 5. Review status must not suppress active transport rendering. These counts document every
-- active status currently eligible for the tiles; expect imported/unreviewed rows to be present.
SELECT 'stops' AS entity, mode, review_status, count(*)
FROM transport.stops
WHERE is_active AND deleted_at IS NULL
GROUP BY mode, review_status
UNION ALL
SELECT 'paths', r.mode, p.review_status, count(*)
FROM transport.route_paths p
JOIN transport.route_variants v ON v.id = p.route_variant_id
JOIN transport.routes r ON r.id = v.route_id
WHERE r.is_active AND v.is_active AND p.is_active
  AND r.deleted_at IS NULL AND v.deleted_at IS NULL AND p.deleted_at IS NULL
GROUP BY r.mode, p.review_status
ORDER BY entity, mode, review_status;
