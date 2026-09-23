import type pg from "pg";

import { classifyMmEnGap, type EntityType, type FillAction } from "./classify.js";
import { romanizeMyanmarToEnglish, looksMyanmar, looksLatin, trimName } from "./romanize.js";
import { englishRoadNameToMyanmar } from "./road-en-to-mm.js";

export type RunSummary = {
  runId: string;
  dryRun: boolean;
  autoApplied: number;
  reviewEnqueued: number;
  skipped: number;
  byEntity: Record<string, { auto: number; review: number; skip: number }>;
  errors: string[];
};

function bump(
  summary: RunSummary,
  entityType: string,
  kind: "auto" | "review" | "skip",
): void {
  if (!summary.byEntity[entityType]) {
    summary.byEntity[entityType] = { auto: 0, review: 0, skip: 0 };
  }
  summary.byEntity[entityType][kind] += 1;
  if (kind === "auto") summary.autoApplied += 1;
  else if (kind === "review") summary.reviewEnqueued += 1;
  else summary.skipped += 1;
}

async function enqueueReview(
  client: pg.PoolClient,
  action: Extract<FillAction, { kind: "review" }>,
  runId: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  await client.query(
    `
    INSERT INTO ops.name_pair_reviews (
      entity_type, entity_id, entity_public_id, direction,
      source_name, proposed_mm, proposed_en, confidence, reason, status, fill_run_id
    )
    SELECT $1, $2, $3::uuid, $4, $5, $6, $7, $8, $9, 'pending', $10
    WHERE NOT EXISTS (
      SELECT 1 FROM ops.name_pair_reviews r
      WHERE r.entity_type = $1
        AND r.entity_id = $2
        AND r.direction = $4
        AND r.status = 'pending'
    )
    `,
    [
      action.entityType,
      action.entityId,
      action.entityPublicId,
      action.direction,
      action.sourceName,
      action.proposedMm,
      action.proposedEn,
      action.confidence,
      action.reason,
      runId,
    ],
  );
}

async function insertNameRow(
  client: pg.PoolClient,
  table: string,
  fkColumn: string,
  entityId: number,
  name: string,
  languageCode: "my" | "en",
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  const script = languageCode === "my" ? "Mymr" : "Latn";
  const hasSearchWeight = table !== "core.core_street_names";
  const cols = hasSearchWeight
    ? `${fkColumn}, name, language_code, script_code, name_type, is_primary, search_weight`
    : `${fkColumn}, name, language_code, script_code, name_type, is_primary`;
  const values = hasSearchWeight
    ? `$1, $2, $3, $4, 'transliteration', false, 70`
    : `$1, $2, $3, $4, 'transliteration', false`;
  await client.query(
    `
    INSERT INTO ${table} (${cols})
    SELECT ${values}
    WHERE NOT EXISTS (
      SELECT 1 FROM ${table} n
      WHERE n.${fkColumn} = $1
        AND (
          n.language_code = $3
          OR upper(trim(coalesce(n.script_code, ''))) = upper($4)
        )
        AND nullif(btrim(n.name), '') IS NOT NULL
    )
    `,
    [entityId, name, languageCode, script],
  );
}

async function handleAction(
  client: pg.PoolClient,
  action: FillAction,
  runId: string,
  dryRun: boolean,
  summary: RunSummary,
): Promise<void> {
  if (action.kind === "skip") {
    bump(summary, "other", "skip");
    return;
  }

  if (action.kind === "review") {
    await enqueueReview(client, action, runId, dryRun);
    bump(summary, action.entityType, "review");
    return;
  }

  // auto
  try {
    await applyAuto(client, action, dryRun);
    bump(summary, action.entityType, "auto");
  } catch (error) {
    summary.errors.push(
      `${action.entityType}:${action.entityId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function applyAuto(
  client: pg.PoolClient,
  action: Extract<FillAction, { kind: "auto" }>,
  dryRun: boolean,
): Promise<void> {
  const { entityType, entityId, proposedMm, proposedEn } = action;

  if (entityType === "settlement") {
    if (dryRun) return;
    if (proposedMm) {
      await client.query(
        `UPDATE core.core_settlements
         SET name_mm = coalesce(nullif(btrim(name_mm), ''), $2), updated_at = now()
         WHERE id = $1 AND (name_mm IS NULL OR btrim(name_mm) = '')`,
        [entityId, proposedMm],
      );
    }
    if (proposedEn) {
      await client.query(
        `UPDATE core.core_settlements
         SET name_en = coalesce(nullif(btrim(name_en), ''), $2), updated_at = now()
         WHERE id = $1 AND (name_en IS NULL OR btrim(name_en) = '')`,
        [entityId, proposedEn],
      );
    }
    return;
  }

  if (entityType === "transport_stop") {
    if (dryRun) return;
    if (proposedMm) {
      await client.query(
        `UPDATE transport.stops
         SET name_mm = coalesce(nullif(btrim(name_mm), ''), $2), updated_at = now()
         WHERE id = $1 AND (name_mm IS NULL OR btrim(name_mm) = '')`,
        [entityId, proposedMm],
      );
    }
    if (proposedEn) {
      await client.query(
        `UPDATE transport.stops
         SET name_en = coalesce(nullif(btrim(name_en), ''), $2), updated_at = now()
         WHERE id = $1 AND (name_en IS NULL OR btrim(name_en) = '')`,
        [entityId, proposedEn],
      );
    }
    return;
  }

  if (entityType === "transport_terminal") {
    if (dryRun) return;
    if (proposedMm) {
      await client.query(
        `UPDATE transport.terminals
         SET name_mm = coalesce(nullif(btrim(name_mm), ''), $2), updated_at = now()
         WHERE id = $1 AND (name_mm IS NULL OR btrim(name_mm) = '')`,
        [entityId, proposedMm],
      );
    }
    if (proposedEn) {
      await client.query(
        `UPDATE transport.terminals
         SET name_en = coalesce(nullif(btrim(name_en), ''), $2), updated_at = now()
         WHERE id = $1 AND (name_en IS NULL OR btrim(name_en) = '')`,
        [entityId, proposedEn],
      );
    }
    return;
  }

  const tableMap: Record<string, { table: string; fk: string }> = {
    place: { table: "core.core_place_names", fk: "place_id" },
    admin_area: { table: "core.core_admin_area_names", fk: "admin_area_id" },
    street: { table: "core.core_street_names", fk: "street_id" },
    building: { table: "core.core_building_names", fk: "building_id" },
  };
  const meta = tableMap[entityType];
  if (!meta) throw new Error(`Unsupported entity type for name table: ${entityType}`);

  if (proposedMm) {
    await insertNameRow(client, meta.table, meta.fk, entityId, proposedMm, "my", dryRun);
  }
  if (proposedEn) {
    await insertNameRow(client, meta.table, meta.fk, entityId, proposedEn, "en", dryRun);
  }
}

function proposeFromMm(mm: string | null): { en: string; confidence: number } | null {
  if (!mm) return null;
  const r = romanizeMyanmarToEnglish(mm);
  return r ? { en: r.text, confidence: r.confidence } : null;
}

function proposeFromEn(en: string | null): { mm: string; confidence: number } | null {
  if (!en) return null;
  const r = englishRoadNameToMyanmar(en);
  return r ? { mm: r.text, confidence: r.confidence } : null;
}

type PairRow = {
  id: string;
  public_id: string | null;
  mm: string | null;
  en: string | null;
  seed: string | null;
  importance_score: string | null;
  is_verified: boolean | null;
  road_class: string | null;
  stop_type: string | null;
};

async function processRows(
  client: pg.PoolClient,
  entityType: EntityType,
  rows: PairRow[],
  runId: string,
  dryRun: boolean,
  summary: RunSummary,
): Promise<void> {
  for (const row of rows) {
    const mm = trimName(row.mm);
    const en = trimName(row.en);
    const seed = trimName(row.seed);
    const fromMm = proposeFromMm(mm ?? (seed && looksMyanmar(seed) ? seed : null));
    const fromEn = proposeFromEn(en ?? (seed && looksLatin(seed) && !looksMyanmar(seed) ? seed : null));

    const action = classifyMmEnGap({
      entityType,
      entityId: Number(row.id),
      entityPublicId: row.public_id,
      mm,
      en,
      seed,
      importanceScore: row.importance_score != null ? Number(row.importance_score) : null,
      isVerified: row.is_verified,
      roadClass: row.road_class,
      stopType: row.stop_type,
      proposedEn: fromMm?.en ?? null,
      proposedMm: fromEn?.mm ?? null,
      proposedConfidence: fromMm?.confidence ?? fromEn?.confidence,
    });

    // If seed is MM-only and no mm/en from names, ensure proposedMm is seed
    if (
      action.kind === "auto" &&
      action.direction === "mm_to_en" &&
      !action.proposedMm &&
      seed &&
      looksMyanmar(seed)
    ) {
      action.proposedMm = seed;
      const r = proposeFromMm(seed);
      if (r) {
        action.proposedEn = r.en;
        action.confidence = r.confidence;
      }
    }

    await handleAction(client, action, runId, dryRun, summary);
  }
}

export async function fillPlaces(
  client: pg.PoolClient,
  runId: string,
  dryRun: boolean,
  summary: RunSummary,
  limit?: number,
): Promise<void> {
  const lim = limit ?? 100000;
  const result = await client.query<PairRow>(
    `
    WITH named AS (
      SELECT
        p.id::text AS id,
        p.public_id::text AS public_id,
        (
          SELECT n.name FROM core.core_place_names n
          WHERE n.place_id = p.id
            AND (n.language_code IN ('my','mm') OR n.name ~ '[\\u1000-\\u109F]')
          ORDER BY n.is_primary DESC, n.search_weight DESC NULLS LAST
          LIMIT 1
        ) AS mm,
        (
          SELECT n.name FROM core.core_place_names n
          WHERE n.place_id = p.id
            AND (n.language_code = 'en' OR (n.name ~ '[A-Za-z]' AND n.name !~ '[\\u1000-\\u109F]'))
          ORDER BY n.is_primary DESC, n.search_weight DESC NULLS LAST
          LIMIT 1
        ) AS en,
        p.primary_name AS seed,
        p.importance_score::text AS importance_score,
        p.is_verified,
        NULL::text AS road_class,
        NULL::text AS stop_type
      FROM core.core_places p
      WHERE p.deleted_at IS NULL AND p.is_public = true
    )
    SELECT * FROM named
    WHERE
      mm IS NULL OR en IS NULL
      OR (mm IS NOT NULL AND en IS NOT NULL AND btrim(mm) = btrim(en))
      OR seed ~ '[\\u1000-\\u109F]'
    ORDER BY id::bigint
    LIMIT $1
    `,
    [lim],
  );
  await processRows(client, "place", result.rows, runId, dryRun, summary);
}

export async function fillSettlements(
  client: pg.PoolClient,
  runId: string,
  dryRun: boolean,
  summary: RunSummary,
  limit?: number,
): Promise<void> {
  const result = await client.query<PairRow>(
    `
    SELECT
      id::text AS id,
      public_id::text AS public_id,
      name_mm AS mm,
      name_en AS en,
      coalesce(name_mm, name_en, canonical_name) AS seed,
      NULL::text AS importance_score,
      false AS is_verified,
      NULL::text AS road_class,
      NULL::text AS stop_type
    FROM core.core_settlements
    WHERE
      nullif(btrim(name_mm), '') IS NULL
      OR nullif(btrim(name_en), '') IS NULL
      OR btrim(coalesce(name_mm, '')) = btrim(coalesce(name_en, ''))
    ORDER BY id
    LIMIT $1
    `,
    [limit ?? 100000],
  );
  await processRows(client, "settlement", result.rows, runId, dryRun, summary);
}

export async function fillAdminAreas(
  client: pg.PoolClient,
  runId: string,
  dryRun: boolean,
  summary: RunSummary,
  limit?: number,
): Promise<void> {
  const result = await client.query<PairRow>(
    `
    SELECT
      a.id::text AS id,
      a.public_id::text AS public_id,
      (
        SELECT n.name FROM core.core_admin_area_names n
        WHERE n.admin_area_id = a.id
          AND (n.language_code IN ('my','mm') OR n.name ~ '[\\u1000-\\u109F]')
        ORDER BY n.is_primary DESC LIMIT 1
      ) AS mm,
      (
        SELECT n.name FROM core.core_admin_area_names n
        WHERE n.admin_area_id = a.id
          AND (n.language_code = 'en' OR (n.name ~ '[A-Za-z]' AND n.name !~ '[\\u1000-\\u109F]'))
        ORDER BY n.is_primary DESC LIMIT 1
      ) AS en,
      a.canonical_name AS seed,
      NULL::text AS importance_score,
      false AS is_verified,
      NULL::text AS road_class,
      NULL::text AS stop_type
    FROM core.core_admin_areas a
    WHERE a.is_active = true
    ORDER BY a.id
    LIMIT $1
    `,
    [limit ?? 100000],
  );
  // Only process gaps
  const gaps = result.rows.filter((r) => {
    const mm = trimName(r.mm);
    const en = trimName(r.en);
    return !mm || !en || mm === en;
  });
  await processRows(client, "admin_area", gaps, runId, dryRun, summary);
}

export async function fillStreets(
  client: pg.PoolClient,
  runId: string,
  dryRun: boolean,
  summary: RunSummary,
  limit?: number,
): Promise<void> {
  // Named streets with gaps + Myanmar-script canonical without MM name
  const result = await client.query<PairRow>(
    `
    SELECT
      s.id::text AS id,
      s.public_id::text AS public_id,
      (
        SELECT n.name FROM core.core_street_names n
        WHERE n.street_id = s.id
          AND (n.language_code IN ('my','mm') OR upper(trim(coalesce(n.script_code,''))) = 'MYMR'
               OR n.name ~ '[\\u1000-\\u109F]')
        ORDER BY n.is_primary DESC LIMIT 1
      ) AS mm,
      (
        SELECT n.name FROM core.core_street_names n
        WHERE n.street_id = s.id
          AND (n.language_code = 'en' OR upper(trim(coalesce(n.script_code,''))) = 'LATN'
               OR (n.name ~ '[A-Za-z]' AND n.name !~ '[\\u1000-\\u109F]'))
        ORDER BY n.is_primary DESC LIMIT 1
      ) AS en,
      s.canonical_name AS seed,
      NULL::text AS importance_score,
      false AS is_verified,
      s.road_class AS road_class,
      NULL::text AS stop_type
    FROM core.core_streets s
    WHERE s.is_active = true
      AND (
        EXISTS (SELECT 1 FROM core.core_street_names n WHERE n.street_id = s.id)
        OR s.canonical_name ~ '[\\u1000-\\u109F]'
        OR lower(coalesce(s.road_class, '')) IN (
          'motorway','trunk','primary','secondary',
          'motorway_link','trunk_link','primary_link','secondary_link'
        )
      )
    ORDER BY s.id
    LIMIT $1
    `,
    [limit ?? 200000],
  );
  const gaps = result.rows.filter((r) => {
    const mm = trimName(r.mm);
    const en = trimName(r.en);
    return !mm || !en || mm === en;
  });
  await processRows(client, "street", gaps, runId, dryRun, summary);
}

export async function fillBuildings(
  client: pg.PoolClient,
  runId: string,
  dryRun: boolean,
  summary: RunSummary,
  limit?: number,
): Promise<void> {
  const result = await client.query<PairRow>(
    `
    SELECT
      b.id::text AS id,
      b.public_id::text AS public_id,
      (
        SELECT n.name FROM core.core_building_names n
        WHERE n.building_id = b.id
          AND (n.language_code IN ('my','mm') OR n.name ~ '[\\u1000-\\u109F]')
        ORDER BY n.is_primary DESC LIMIT 1
      ) AS mm,
      (
        SELECT n.name FROM core.core_building_names n
        WHERE n.building_id = b.id
          AND (n.language_code = 'en' OR (n.name ~ '[A-Za-z]' AND n.name !~ '[\\u1000-\\u109F]'))
        ORDER BY n.is_primary DESC LIMIT 1
      ) AS en,
      NULL::text AS seed,
      NULL::text AS importance_score,
      coalesce(b.is_verified, false) AS is_verified,
      NULL::text AS road_class,
      NULL::text AS stop_type
    FROM core.core_buildings b
    WHERE b.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM core.core_building_names n WHERE n.building_id = b.id)
    ORDER BY b.id
    LIMIT $1
    `,
    [limit ?? 100000],
  );
  const gaps = result.rows.filter((r) => {
    const mm = trimName(r.mm);
    const en = trimName(r.en);
    return !mm || !en || mm === en;
  });
  await processRows(client, "building", gaps, runId, dryRun, summary);
}

export async function fillTransportStops(
  client: pg.PoolClient,
  runId: string,
  dryRun: boolean,
  summary: RunSummary,
  limit?: number,
): Promise<void> {
  const result = await client.query<PairRow>(
    `
    SELECT
      id::text AS id,
      public_id::text AS public_id,
      name_mm AS mm,
      name_en AS en,
      coalesce(name_mm, name_en, name) AS seed,
      NULL::text AS importance_score,
      false AS is_verified,
      NULL::text AS road_class,
      stop_type
    FROM transport.stops
    WHERE deleted_at IS NULL AND is_active = true
      AND (
        nullif(btrim(name_mm), '') IS NULL
        OR nullif(btrim(name_en), '') IS NULL
        OR btrim(coalesce(name_mm, '')) = btrim(coalesce(name_en, ''))
      )
    ORDER BY id
    LIMIT $1
    `,
    [limit ?? 100000],
  );
  await processRows(client, "transport_stop", result.rows, runId, dryRun, summary);
}

export async function fillTransportTerminals(
  client: pg.PoolClient,
  runId: string,
  dryRun: boolean,
  summary: RunSummary,
  limit?: number,
): Promise<void> {
  const result = await client.query<PairRow>(
    `
    SELECT
      id::text AS id,
      public_id::text AS public_id,
      name_mm AS mm,
      name_en AS en,
      coalesce(name_mm, name_en, name) AS seed,
      NULL::text AS importance_score,
      false AS is_verified,
      NULL::text AS road_class,
      NULL::text AS stop_type
    FROM transport.terminals
    WHERE deleted_at IS NULL AND is_active = true
      AND (
        nullif(btrim(name_mm), '') IS NULL
        OR nullif(btrim(name_en), '') IS NULL
        OR btrim(coalesce(name_mm, '')) = btrim(coalesce(name_en, ''))
      )
    ORDER BY id
    LIMIT $1
    `,
    [limit ?? 100000],
  );
  await processRows(client, "transport_terminal", result.rows, runId, dryRun, summary);
}

export function emptySummary(runId: string, dryRun: boolean): RunSummary {
  return {
    runId,
    dryRun,
    autoApplied: 0,
    reviewEnqueued: 0,
    skipped: 0,
    byEntity: {},
    errors: [],
  };
}
