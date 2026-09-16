import type { Pool } from "pg";

import { actionsForLifecycleState } from "./local-basemap.actions.js";
import type {
    LocalBasemapEntity,
    LocalBasemapFeatureDetail,
    LocalBasemapLifecycleState,
    LocalBasemapSearchHit,
} from "./local-basemap.types.js";

const GEOM_SQL = `ST_AsGeoJSON(
  ST_Multi(
    ST_CollectionExtract(
      ST_MakeValid(ST_Force2D(ST_SetSRID(geom, 4326))),
      3
    )
  )
)::json`;

function tables(entity: LocalBasemapEntity) {
    if (entity === "buildings") {
        return {
            base: "tile_source.buildings_base",
            archive: "tile_source.buildings_archive",
            core: "tile_source.buildings_core",
            suppressed: "tile_source.buildings_suppressed",
            view: "tile_source.buildings_v",
        };
    }
    return {
        base: "tile_source.land_areas_base",
        archive: "tile_source.land_areas_archive",
        core: "tile_source.land_areas_core",
        suppressed: "tile_source.land_areas_suppressed",
        view: "tile_source.land_areas_v",
    };
}

function parseOsmIdFromKey(featureKey: string): { type: string; id: string } | null {
    const m = featureKey.match(/^osm:(way|relation):(\d+)$/i);
    if (!m) {
        return null;
    }
    return { type: m[1]!.toLowerCase(), id: m[2]! };
}

export class LocalBasemapTileRepository {
    constructor(private readonly pool: Pool) {}

    async search(entity: LocalBasemapEntity, q: string, limit = 25): Promise<LocalBasemapSearchHit[]> {
        const t = tables(entity);
        const trimmed = q.trim();
        if (!trimmed) {
            return [];
        }
        const like = `%${trimmed.replace(/[%_]/g, "")}%`;
        const osm = parseOsmIdFromKey(trimmed.startsWith("osm:") ? trimmed.toLowerCase().replace(":w:", ":way:").replace(":r:", ":relation:") : "");
        const numericId = /^\d+$/.test(trimmed) ? trimmed : null;

        const result = await this.pool.query<{
            feature_key: string;
            lifecycle_state: LocalBasemapLifecycleState;
            name: string | null;
            class_code: string | null;
            osm_id: string | null;
            osm_feature_type: string | null;
        }>(
            `
WITH candidates AS (
  SELECT (('osm:' || b.osm_feature_type) || ':' || b.osm_id::text) AS feature_key,
         b.canonical_name AS name,
         b.class_code,
         b.osm_id::text AS osm_id,
         b.osm_feature_type
  FROM ${t.base} b
  WHERE (
    (($1::text <> '') AND (('osm:' || b.osm_feature_type) || ':' || b.osm_id::text) ILIKE $2)
    OR (($3::text IS NOT NULL) AND b.osm_id::text = $3)
    OR (($4::text IS NOT NULL) AND b.osm_feature_type = $4 AND b.osm_id::text = $5)
    OR (($1::text <> '') AND COALESCE(b.canonical_name, '') ILIKE $2)
  )
  UNION
  SELECT a.feature_key,
         COALESCE(a.name_en, a.name) AS name,
         a.class_code,
         NULLIF(split_part(a.feature_key, ':', 3), '') AS osm_id,
         NULLIF(split_part(a.feature_key, ':', 2), '') AS osm_feature_type
  FROM ${t.archive} a
  WHERE (
    (($1::text <> '') AND a.feature_key ILIKE $2)
    OR (($1::text <> '') AND COALESCE(a.name, a.name_en, '') ILIKE $2)
    OR (($3::text IS NOT NULL) AND split_part(a.feature_key, ':', 3) = $3)
  )
  UNION
  SELECT c.feature_key,
         COALESCE(c.name_en, c.name) AS name,
         c.class_code,
         NULLIF(split_part(c.feature_key, ':', 3), '') AS osm_id,
         NULLIF(split_part(c.feature_key, ':', 2), '') AS osm_feature_type
  FROM ${t.core} c
  WHERE c.deleted_at IS NULL
    AND (
      (($1::text <> '') AND c.feature_key ILIKE $2)
      OR (($1::text <> '') AND COALESCE(c.name, c.name_en, '') ILIKE $2)
      OR (($3::text IS NOT NULL) AND split_part(c.feature_key, ':', 3) = $3)
    )
  UNION
  SELECT s.feature_key,
         NULL::text AS name,
         NULL::text AS class_code,
         NULLIF(split_part(s.feature_key, ':', 3), '') AS osm_id,
         NULLIF(split_part(s.feature_key, ':', 2), '') AS osm_feature_type
  FROM ${t.suppressed} s
  WHERE (($1::text <> '') AND s.feature_key ILIKE $2)
     OR (($3::text IS NOT NULL) AND split_part(s.feature_key, ':', 3) = $3)
)
SELECT DISTINCT ON (feature_key)
  feature_key,
  CASE
    WHEN EXISTS (SELECT 1 FROM ${t.suppressed} x WHERE x.feature_key = candidates.feature_key) THEN 'deleted'
    WHEN EXISTS (SELECT 1 FROM ${t.view} v WHERE v.feature_key = candidates.feature_key AND v.source = 'core') THEN 'core'
    WHEN EXISTS (SELECT 1 FROM ${t.view} v WHERE v.feature_key = candidates.feature_key AND v.source = 'archive') THEN 'archive'
    WHEN EXISTS (SELECT 1 FROM ${t.view} v WHERE v.feature_key = candidates.feature_key AND v.source = 'base') THEN 'base'
    ELSE 'absent'
  END::text AS lifecycle_state,
  name,
  class_code,
  osm_id,
  osm_feature_type
FROM candidates
ORDER BY feature_key
LIMIT $6
            `,
            [
                trimmed,
                like,
                numericId,
                osm?.type ?? null,
                osm?.id ?? null,
                Math.min(Math.max(limit, 1), 50),
            ]
        );

        return result.rows.map((row) => ({
            feature_key: row.feature_key,
            lifecycle_state: row.lifecycle_state,
            name: row.name,
            class_code: row.class_code,
            osm_id: row.osm_id,
            osm_feature_type: row.osm_feature_type,
        }));
    }

    async getDetail(
        entity: LocalBasemapEntity,
        featureKey: string,
        options: { includeGeometry?: boolean } = {},
    ): Promise<LocalBasemapFeatureDetail | null> {
        const t = tables(entity);
        const osm = parseOsmIdFromKey(featureKey);
        if (!osm) {
            return null;
        }

        // ST_MakeValid + ST_AsGeoJSON on large relations can take 30s+. Dev Map
        // inspector never uses geometry — only Local Basemap admin map needs it.
        const includeGeometry = options.includeGeometry === true;

        // Layer flags only — do not touch tile_source.*_v (UNION with dense Base).
        const flags = await this.pool.query<{
            has_base: boolean;
            has_archive: boolean;
            has_core: boolean;
            has_suppressed: boolean;
        }>(
            `
SELECT
  EXISTS (
    SELECT 1 FROM ${t.base}
    WHERE osm_feature_type = $2 AND osm_id = $3::bigint
  ) AS has_base,
  EXISTS (
    SELECT 1 FROM ${t.archive} WHERE feature_key = $1
  ) AS has_archive,
  EXISTS (
    SELECT 1 FROM ${t.core}
    WHERE feature_key = $1 AND deleted_at IS NULL AND is_active IS TRUE
  ) AS has_core,
  EXISTS (
    SELECT 1 FROM ${t.suppressed} WHERE feature_key = $1
  ) AS has_suppressed
            `,
            [featureKey, osm.type, osm.id],
        );

        const flag = flags.rows[0];
        if (!flag) {
            return null;
        }

        const local_layers = {
            base: flag.has_base,
            archive: flag.has_archive,
            core: flag.has_core,
            suppressed: flag.has_suppressed,
        };

        if (
            !local_layers.base &&
            !local_layers.archive &&
            !local_layers.core &&
            !local_layers.suppressed
        ) {
            return null;
        }

        let lifecycle_state: LocalBasemapLifecycleState = "absent";
        if (local_layers.suppressed) {
            lifecycle_state = "deleted";
        } else if (local_layers.core) {
            lifecycle_state = "core";
        } else if (local_layers.archive) {
            lifecycle_state = "archive";
        } else if (local_layers.base) {
            lifecycle_state = "base";
        }

        if (lifecycle_state === "deleted" || lifecycle_state === "absent") {
            return {
                feature_key: featureKey,
                lifecycle_state,
                name: null,
                name_en: null,
                name_mm: null,
                class_code: null,
                osm_id: osm.id,
                osm_feature_type: osm.type,
                core_id: null,
                core_public_id: null,
                source_identity: featureKey,
                geometry: null,
                geometry_source: null,
                available_actions: actionsForLifecycleState(lifecycle_state),
                local_layers,
            };
        }

        type AttrRow = {
            name: string | null;
            name_en: string | null;
            name_mm: string | null;
            class_code: string | null;
            core_id: string | null;
            core_public_id: string | null;
            geometry: LocalBasemapFeatureDetail["geometry"];
        };

        const geomCol = includeGeometry ? `${GEOM_SQL} AS geometry` : `NULL::json AS geometry`;
        let attrs: AttrRow | undefined;

        if (lifecycle_state === "core") {
            const core = await this.pool.query<AttrRow>(
                `
SELECT
  name,
  name_en,
  name_mm,
  class_code,
  core_id::text AS core_id,
  core_public_id::text AS core_public_id,
  ${geomCol}
FROM ${t.core}
WHERE feature_key = $1 AND deleted_at IS NULL AND is_active IS TRUE
LIMIT 1
                `,
                [featureKey],
            );
            attrs = core.rows[0];
        } else if (lifecycle_state === "archive") {
            const archive = await this.pool.query<AttrRow>(
                `
SELECT
  name,
  name_en,
  name_mm,
  class_code,
  core_id::text AS core_id,
  core_public_id::text AS core_public_id,
  ${geomCol}
FROM ${t.archive}
WHERE feature_key = $1
ORDER BY demoted_at DESC NULLS LAST, id DESC
LIMIT 1
                `,
                [featureKey],
            );
            attrs = archive.rows[0];
        } else {
            const base = await this.pool.query<AttrRow>(
                `
SELECT
  canonical_name AS name,
  NULL::text AS name_en,
  NULL::text AS name_mm,
  class_code,
  NULL::text AS core_id,
  NULL::text AS core_public_id,
  ${geomCol}
FROM ${t.base}
WHERE osm_feature_type = $1 AND osm_id = $2::bigint
LIMIT 1
                `,
                [osm.type, osm.id],
            );
            attrs = base.rows[0];
        }

        return {
            feature_key: featureKey,
            lifecycle_state,
            name: attrs?.name ?? null,
            name_en: attrs?.name_en ?? null,
            name_mm: attrs?.name_mm ?? null,
            class_code: attrs?.class_code ?? null,
            osm_id: osm.id,
            osm_feature_type: osm.type,
            core_id: attrs?.core_id ?? null,
            core_public_id: attrs?.core_public_id ?? null,
            source_identity: featureKey,
            geometry: attrs?.geometry ?? null,
            geometry_source: lifecycle_state,
            available_actions: actionsForLifecycleState(lifecycle_state),
            local_layers,
        };
    }

    async lookupPromoteCandidate(entity: LocalBasemapEntity, featureKey: string) {
        const t = tables(entity);
        const osm = parseOsmIdFromKey(featureKey);
        if (!osm) {
            return null;
        }

        const suppressed = await this.pool.query(
            `SELECT 1 FROM ${t.suppressed} WHERE feature_key = $1
             UNION ALL
             SELECT 1 FROM ${t.core} WHERE feature_key = $1 AND deleted_at IS NOT NULL
             LIMIT 1`,
            [featureKey]
        );
        if (suppressed.rows.length > 0) {
            return { suppressed: true as const };
        }

        const archive = await this.pool.query<{
            class_code: string | null;
            name: string | null;
            name_mm: string | null;
            name_en: string | null;
            geometry: LocalBasemapFeatureDetail["geometry"];
        }>(
            `SELECT DISTINCT ON (feature_key)
                class_code, name, name_mm, name_en, ${GEOM_SQL} AS geometry
             FROM ${t.archive}
             WHERE feature_key = $1 AND geom IS NOT NULL AND NOT ST_IsEmpty(geom)
             ORDER BY feature_key, demoted_at DESC NULLS LAST, id DESC
             LIMIT 1`,
            [featureKey]
        );
        if (archive.rows[0]?.geometry) {
            return {
                suppressed: false as const,
                local_source: "archive" as const,
                ...archive.rows[0],
            };
        }

        const base = await this.pool.query<{
            class_code: string | null;
            name: string | null;
            geometry: LocalBasemapFeatureDetail["geometry"];
        }>(
            `SELECT class_code, canonical_name AS name, ${GEOM_SQL} AS geometry
             FROM ${t.base}
             WHERE osm_feature_type = $1 AND osm_id = $2::bigint
               AND geom IS NOT NULL AND NOT ST_IsEmpty(geom)
             LIMIT 1`,
            [osm.type, osm.id]
        );
        if (base.rows[0]?.geometry) {
            return {
                suppressed: false as const,
                local_source: "base" as const,
                name_mm: null,
                name_en: null,
                ...base.rows[0],
            };
        }
        return null;
    }

    async writeArchiveFromPreflight(
        entity: LocalBasemapEntity,
        payload: {
            feature_key: string;
            core_id: string;
            public_id: string;
            class_code: string;
            name: string | null;
            name_mm: string | null;
            name_en: string | null;
            geometry: object;
            core_snapshot: object;
        }
    ): Promise<void> {
        const t = tables(entity);
        const geomJson = JSON.stringify(payload.geometry);
        const snapshotJson = JSON.stringify(payload.core_snapshot);
        const updated = await this.pool.query(
            `UPDATE ${t.archive} AS a
             SET
               core_id = $2::bigint,
               core_public_id = $3::uuid,
               class_code = $4,
               name = $5,
               name_mm = $6,
               name_en = $7,
               geom = ST_Multi(
                 ST_CollectionExtract(
                   ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($8::text), 4326))),
                   3
                 )
               )::geometry(MultiPolygon, 4326),
               is_active = TRUE,
               deleted_at = NULL,
               core_snapshot = $9::jsonb,
               demotion_reason = 'demote_to_local',
               demoted_at = now()
             WHERE a.id = (
               SELECT id FROM ${t.archive}
               WHERE feature_key = $1
               ORDER BY demoted_at DESC NULLS LAST, id DESC
               LIMIT 1
             )`,
            [
                payload.feature_key,
                payload.core_id,
                payload.public_id,
                payload.class_code,
                payload.name,
                payload.name_mm,
                payload.name_en,
                geomJson,
                snapshotJson,
            ]
        );
        if ((updated.rowCount ?? 0) > 0) {
            return;
        }
        await this.pool.query(
            `INSERT INTO ${t.archive} (
               feature_key, core_id, core_public_id, class_code, name, name_mm, name_en,
               geom, is_active, deleted_at, core_snapshot, demotion_reason, demoted_at
             ) VALUES (
               $1, $2::bigint, $3::uuid, $4, $5, $6, $7,
               ST_Multi(
                 ST_CollectionExtract(
                   ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($8::text), 4326))),
                   3
                 )
               )::geometry(MultiPolygon, 4326),
               TRUE, NULL, $9::jsonb, 'demote_to_local', now()
             )`,
            [
                payload.feature_key,
                payload.core_id,
                payload.public_id,
                payload.class_code,
                payload.name,
                payload.name_mm,
                payload.name_en,
                geomJson,
                snapshotJson,
            ]
        );
    }
}
