import type pg from "pg";

export type LifecycleMvtEntity = "buildings" | "land";

export const LIFECYCLE_MVT_LAYER_NAME = {
    buildings: "buildings_lifecycle",
    land: "land_lifecycle",
} as const;

/** Buildings overlay: no tiles below this zoom. */
export const BUILDINGS_LIFECYCLE_MIN_ZOOM = 15;
/**
 * Dense OSM Base is never included in lifecycle MVT (use PMTiles for Base geometry).
 * Kept exported so tests/docs can assert Base is gated off.
 */
export const BUILDINGS_LIFECYCLE_BASE_MIN_ZOOM = 99;
/** Land overlay: no tiles below this zoom. */
export const LAND_LIFECYCLE_MIN_ZOOM = 14;
/** Dense land Base never included in lifecycle MVT. */
export const LAND_LIFECYCLE_BASE_MIN_ZOOM = 99;

/** Hard cap features per MVT tile so one dense tile cannot block the API. */
export const LIFECYCLE_MVT_FEATURE_LIMIT = 400;
/** Fail slow tile SQL instead of holding the MVT pool for many seconds. */
export const LIFECYCLE_MVT_STATEMENT_TIMEOUT_MS = 3_000;

export function isValidTileCoord(z: number, x: number, y: number): boolean {
    if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
        return false;
    }
    if (z < 0 || z > 22) {
        return false;
    }
    const max = 2 ** z;
    return x >= 0 && y >= 0 && x < max && y < max;
}

export function shouldServeLifecycleTile(entity: LifecycleMvtEntity, z: number): boolean {
    if (entity === "buildings") {
        return z >= BUILDINGS_LIFECYCLE_MIN_ZOOM;
    }
    return z >= LAND_LIFECYCLE_MIN_ZOOM;
}

/**
 * Dev Map lifecycle MVT is Core + Archive only.
 * Base OSM density stays on PMTiles so tile SQL stays fast and detail stays responsive.
 */
export function lifecycleSourcesForZoom(
    entity: LifecycleMvtEntity,
    z: number,
): readonly ("base" | "core" | "archive")[] {
    if (!shouldServeLifecycleTile(entity, z)) {
        return [];
    }
    return ["core", "archive"];
}

/**
 * Build MVT from tile_source.*_v (local Windows DB). Empty Buffer when zoom-gated.
 * Properties: feature_key, resolved_source, core_id, name, class_code.
 */
export async function queryLifecycleMvt(
    pool: pg.Pool,
    entity: LifecycleMvtEntity,
    z: number,
    x: number,
    y: number,
): Promise<Buffer> {
    if (!isValidTileCoord(z, x, y) || !shouldServeLifecycleTile(entity, z)) {
        return Buffer.alloc(0);
    }

    const sources = lifecycleSourcesForZoom(entity, z);
    if (sources.length === 0) {
        return Buffer.alloc(0);
    }

    const layerName = LIFECYCLE_MVT_LAYER_NAME[entity];

    // Prefer core/archive tables directly — buildings_v UNION includes huge Base.
    const tableSql =
        entity === "buildings"
            ? `
(
  SELECT feature_key, 'core'::text AS source, core_id,
         name, name_en, name_mm, class_code, geom
  FROM tile_source.buildings_core
  WHERE deleted_at IS NULL AND is_active IS TRUE
    AND geom IS NOT NULL AND NOT ST_IsEmpty(geom)
  UNION ALL
  SELECT feature_key, 'archive'::text AS source, core_id,
         name, name_en, name_mm, class_code, geom
  FROM tile_source.buildings_archive
  WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
)`
            : `
(
  SELECT feature_key, 'core'::text AS source, core_id,
         name, name_en, name_mm, class_code, geom
  FROM tile_source.land_areas_core
  WHERE deleted_at IS NULL AND is_active IS TRUE
    AND geom IS NOT NULL AND NOT ST_IsEmpty(geom)
  UNION ALL
  SELECT feature_key, 'archive'::text AS source, core_id,
         name, name_en, name_mm, class_code, geom
  FROM tile_source.land_areas_archive
  WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
)`;

    const sql = `
WITH
bounds_merc AS (
  SELECT ST_TileEnvelope($1::int, $2::int, $3::int) AS tile_geom
),
bounds_4326 AS (
  SELECT ST_Transform((SELECT tile_geom FROM bounds_merc), 4326) AS geom
),
src AS (
  SELECT
    v.feature_key,
    v.source AS resolved_source,
    CASE WHEN v.core_id IS NULL THEN NULL ELSE v.core_id::text END AS core_id,
    COALESCE(
      NULLIF(btrim(v.name), ''),
      NULLIF(btrim(v.name_en), ''),
      NULLIF(btrim(v.name_mm), '')
    ) AS name,
    NULLIF(btrim(v.class_code), '') AS class_code,
    ST_Transform(v.geom, 3857) AS geom_merc
  FROM ${tableSql} AS v
  WHERE v.source = ANY($4::text[])
    AND v.geom && (SELECT geom FROM bounds_4326)
  LIMIT ${LIFECYCLE_MVT_FEATURE_LIMIT}
),
mvtgeom AS (
  SELECT
    feature_key,
    resolved_source,
    core_id,
    name,
    class_code,
    ST_AsMVTGeom(
      geom_merc,
      (SELECT tile_geom FROM bounds_merc),
      4096,
      64,
      true
    ) AS geom
  FROM src
)
SELECT ST_AsMVT(mvtgeom.*, $5::text, 4096, 'geom') AS tile
FROM mvtgeom
WHERE geom IS NOT NULL
`;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL statement_timeout = ${LIFECYCLE_MVT_STATEMENT_TIMEOUT_MS}`);
        const result = await client.query<{ tile: Buffer | null }>(sql, [
            z,
            x,
            y,
            [...sources],
            layerName,
        ]);
        await client.query("COMMIT");
        const tile = result.rows[0]?.tile;
        return tile && Buffer.isBuffer(tile) ? tile : Buffer.from(tile ?? []);
    } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        if (/statement timeout|canceling statement/i.test(message)) {
            return Buffer.alloc(0);
        }
        throw error;
    } finally {
        client.release();
    }
}

/** Optional probe for performance reports (feature count in a tile bbox). */
export async function countLifecycleFeaturesInTile(
    pool: pg.Pool,
    entity: LifecycleMvtEntity,
    z: number,
    x: number,
    y: number,
): Promise<{ count: number; sources: readonly string[] }> {
    const sources = lifecycleSourcesForZoom(entity, z);
    if (sources.length === 0) {
        return { count: 0, sources };
    }
    const viewSql =
        entity === "buildings" ? "tile_source.buildings_v" : "tile_source.land_areas_v";
    const result = await pool.query<{ n: string }>(
        `
WITH bounds_4326 AS (
  SELECT ST_Transform(ST_TileEnvelope($1::int, $2::int, $3::int), 4326) AS geom
)
SELECT count(*)::text AS n
FROM ${viewSql} AS v
WHERE v.geom IS NOT NULL
  AND NOT ST_IsEmpty(v.geom)
  AND v.source = ANY($4::text[])
  AND v.geom && (SELECT geom FROM bounds_4326)
`,
        [z, x, y, [...sources]],
    );
    return { count: Number(result.rows[0]?.n ?? 0), sources };
}
