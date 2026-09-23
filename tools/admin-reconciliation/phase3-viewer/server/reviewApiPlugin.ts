import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Plugin, Connect } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const REPORTS = path.join(REPO_ROOT, "reports/admin-reconciliation-v2");
const EXPORT = path.join(REPO_ROOT, "data/local/admin-reconciliation/phase2-export");
const CLIP_PLAN = path.join(REPORTS, "03-local-create-new-clip-plan.csv");

const QUEUE_FILES = {
  local: path.join(REPORTS, "03-local-admin-review-queue.csv"),
  village: path.join(REPORTS, "03-village-review-queue.csv"),
  merge: path.join(REPORTS, "03-merge-repoint-plans.csv"),
} as const;

const DECISION_FILES = {
  local: path.join(REPORTS, "03-local-admin-decisions.csv"),
  village: path.join(REPORTS, "03-village-decisions.csv"),
  merge: path.join(REPORTS, "03-merge-decisions.csv"),
} as const;

const DECISION_HEADERS = [
  "review_id",
  "source_key",
  "review_decision",
  "selected_core_id",
  "losing_core_ids",
  "name_source",
  "geometry_policy",
  "review_note",
  "updated_at",
] as const;

type QueueKind = keyof typeof QUEUE_FILES;

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (ch === "\r") continue;
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
}

function toCsv(rows: Record<string, string>[], headers: readonly string[]): string {
  const esc = (v: string) => {
    if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => esc(row[h] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, contents, "utf8");
  await fsp.rename(tmp, filePath);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.end(body);
}

/** Lazy indexes for candidate geometries (local files only). */
let wvtGeomById: Map<string, GeoJSON.Geometry> | null = null;
let wvtMetaById: Map<string, { canonical_name: string; admin_area_type: string }> | null = null;
let wvtNamesById: Map<string, { name_mm: string; name_en: string }> | null = null;
let settlementPointById: Map<string, { lon: number; lat: number; name_en: string; name_mm: string; type: string; township_id: string }> | null = null;

async function ensureWvtIndex() {
  if (wvtGeomById && wvtMetaById) return wvtGeomById;
  const file = path.join(EXPORT, "ward_village_tracts.csv");
  const text = await fsp.readFile(file, "utf8");
  const rows = parseCsv(text);
  const geomMap = new Map<string, GeoJSON.Geometry>();
  const metaMap = new Map<string, { canonical_name: string; admin_area_type: string }>();
  for (const row of rows) {
    const id = row.id;
    if (!id) continue;
    metaMap.set(id, {
      canonical_name: row.canonical_name || "",
      admin_area_type: row.admin_area_type || "",
    });
    const raw = row.geom_geojson;
    if (!raw) continue;
    try {
      geomMap.set(id, JSON.parse(raw) as GeoJSON.Geometry);
    } catch {
      // skip bad geom
    }
  }
  wvtGeomById = geomMap;
  wvtMetaById = metaMap;
  return geomMap;
}

async function ensureWvtNamesIndex() {
  if (wvtNamesById) return wvtNamesById;
  await ensureWvtIndex();
  const file = path.join(EXPORT, "wvt_names.csv");
  const text = await fsp.readFile(file, "utf8");
  const rows = parseCsv(text);
  const map = new Map<string, { name_mm: string; name_en: string }>();
  for (const row of rows) {
    const id = row.admin_area_id;
    if (!id) continue;
    const cur = map.get(id) || { name_mm: "", name_en: "" };
    const lang = (row.language_code || "").toLowerCase();
    const name = row.name || "";
    if (!name) continue;
    if (lang === "my" || lang === "mm") {
      if (!cur.name_mm || row.is_primary === "t") cur.name_mm = name;
    } else if (lang === "en") {
      if (!cur.name_en || row.is_primary === "t") cur.name_en = name;
    }
    map.set(id, cur);
  }
  // Fill gaps from canonical_name
  for (const [id, meta] of wvtMetaById || []) {
    const cur = map.get(id) || { name_mm: "", name_en: "" };
    if (!cur.name_mm && meta.canonical_name) cur.name_mm = meta.canonical_name;
    map.set(id, cur);
  }
  wvtNamesById = map;
  return map;
}

async function lookupCoreNames(
  ids: string[],
): Promise<Map<string, { name_mm: string; name_en: string; type: string }>> {
  const out = new Map<string, { name_mm: string; name_en: string; type: string }>();
  const [wvtNames, settlements] = await Promise.all([
    ensureWvtNamesIndex(),
    ensureSettlementIndex(),
  ]);
  const meta = wvtMetaById;
  for (const id of ids) {
    const w = wvtNames.get(id);
    if (w && (w.name_mm || w.name_en)) {
      out.set(id, {
        name_mm: w.name_mm,
        name_en: w.name_en,
        type: meta?.get(id)?.admin_area_type || "",
      });
      continue;
    }
    const s = settlements.get(id);
    if (s) {
      out.set(id, { name_mm: s.name_mm, name_en: s.name_en, type: s.type });
    }
  }
  return out;
}

async function ensureSettlementIndex() {
  if (settlementPointById) return settlementPointById;
  const file = path.join(EXPORT, "settlements.csv");
  const text = await fsp.readFile(file, "utf8");
  const rows = parseCsv(text);
  const map = new Map<string, { lon: number; lat: number; name_en: string; name_mm: string; type: string; township_id: string }>();
  for (const row of rows) {
    const lon = Number(row.lon);
    const lat = Number(row.lat);
    if (!row.id || Number.isNaN(lon) || Number.isNaN(lat)) continue;
    map.set(row.id, {
      lon,
      lat,
      name_en: row.name_en || "",
      name_mm: row.name_mm || "",
      type: row.settlement_type || "",
      township_id: row.township_id || "",
    });
  }
  settlementPointById = map;
  return map;
}

function resolvePreviewPath(raw: string): string | null {
  if (!raw) return null;
  const candidates = [
    path.resolve(REPO_ROOT, raw),
    path.resolve(REPO_ROOT, `${raw}.geojson`),
  ];
  const base = path.basename(raw);
  const previewDir = path.join(REPORTS, "phase3-previews");
  if (fs.existsSync(previewDir)) {
    for (const name of fs.readdirSync(previewDir)) {
      if (name === base || name.startsWith(base) || base.startsWith(name.replace(/\.geojson$/, ""))) {
        candidates.push(path.join(previewDir, name));
      }
    }
  }
  for (const c of candidates) {
    if (fs.existsSync(c) && c.startsWith(REPO_ROOT)) return c;
  }
  return null;
}

type DecisionRow = Record<(typeof DECISION_HEADERS)[number], string>;

async function ensureDecisionFile(kind: QueueKind): Promise<void> {
  const file = DECISION_FILES[kind];
  if (fs.existsSync(file)) return;
  await atomicWrite(file, toCsv([], DECISION_HEADERS));
}

async function loadDecisions(kind: QueueKind): Promise<DecisionRow[]> {
  await ensureDecisionFile(kind);
  const file = DECISION_FILES[kind];
  const text = await fsp.readFile(file, "utf8");
  const rows = parseCsv(text);
  const normalized = rows.map((r) => {
    let decision = r.review_decision || "";
    let nameSource = r.name_source || "";
    let geomPolicy = r.geometry_policy || "";
    // Legacy decision code → selective_merge + defaults
    if (decision === "selective_merge_union") {
      decision = "selective_merge";
      if (!nameSource) nameSource = "coremap";
      if (!geomPolicy) geomPolicy = "union";
    }
    return {
      review_id: r.review_id || r.source_key || "",
      source_key: r.source_key || r.review_id || "",
      review_decision: decision,
      selected_core_id: r.selected_core_id || "",
      losing_core_ids: r.losing_core_ids || "",
      name_source: nameSource,
      geometry_policy: geomPolicy,
      review_note: r.review_note || "",
      updated_at: r.updated_at || "",
    };
  });
  // Migrate header if older decision files lack the new columns.
  if (normalized.length && !text.split("\n", 1)[0]?.includes("name_source")) {
    await atomicWrite(file, toCsv(normalized, DECISION_HEADERS));
  }
  return normalized;
}

function townshipFromParent(parent: string): string {
  const parts = parent.split(">").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[2];
  if (parts.length >= 2) return parts[1];
  return parts[0] || "";
}

async function upsertDecision(kind: QueueKind, decision: DecisionRow): Promise<DecisionRow[]> {
  const existing = await loadDecisions(kind);
  const idx = existing.findIndex((d) => d.review_id === decision.review_id);
  if (idx >= 0) existing[idx] = decision;
  else existing.push(decision);
  await atomicWrite(DECISION_FILES[kind], toCsv(existing, DECISION_HEADERS));
  return existing;
}

function validateDecisions(
  localQueue: Record<string, string>[],
  villageQueue: Record<string, string>[],
  mergeQueue: Record<string, string>[],
  localDec: DecisionRow[],
  villageDec: DecisionRow[],
  mergeDec: DecisionRow[],
): { blocking: string[]; warnings: string[]; md: string } {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const DECISIONS = new Set([
    "match_existing",
    "selective_merge",
    "selective_merge_union",
    "create_new",
    "keep_both",
    "merge_confirmed_duplicate",
    "reject_source_error",
    "defer",
  ]);

  const isSelective = (code: string) =>
    code === "selective_merge" || code === "selective_merge_union";
  const isMatchLike = (code: string) => code === "match_existing" || isSelective(code);

  const localMap = new Map(localDec.map((d) => [d.review_id, d]));
  const villageMap = new Map(villageDec.map((d) => [d.review_id, d]));
  const mergeMap = new Map(mergeDec.map((d) => [d.review_id, d]));

  const checkQueue = (
    queue: Record<string, string>[],
    decisions: Map<string, DecisionRow>,
    label: string,
    idField: "source_key" | "source_key",
  ) => {
    for (const row of queue) {
      const key = row[idField] || row.source_key;
      const d = decisions.get(key);
      if (!d || !d.review_decision) {
        blocking.push(`${label}: missing decision for ${key}`);
        continue;
      }
      if (!DECISIONS.has(d.review_decision)) {
        blocking.push(`${label}: invalid decision ${d.review_decision} for ${key}`);
      }
      if (d.review_decision === "defer") {
        blocking.push(`${label}: unresolved defer for ${key}`);
      }
      const cands = new Set(
        (row.candidate_core_ids || "")
          .split(";")
          .map((x) => x.trim())
          .filter(Boolean),
      );
      if (label === "merge") {
        // merge queue uses survivor/duplicates
        const surv = row.survivor_core_id || "";
        const dups = new Set(
          (row.duplicate_core_ids || "")
            .split(";")
            .map((x) => x.trim())
            .filter(Boolean),
        );
        if (d.review_decision === "merge_confirmed_duplicate") {
          if (!d.selected_core_id) blocking.push(`${label}: merge requires survivor selected_core_id for ${key}`);
          if (!d.losing_core_ids) blocking.push(`${label}: merge requires losing_core_ids for ${key}`);
          if (d.selected_core_id && surv && d.selected_core_id !== surv && !dups.has(d.selected_core_id) && d.selected_core_id !== surv) {
            // allow selecting either survivor recommendation or a listed duplicate as survivor
            if (d.selected_core_id !== surv && !dups.has(d.selected_core_id)) {
              blocking.push(`${label}: selected survivor not in candidate set for ${key}`);
            }
          }
        }
      } else {
        if (isMatchLike(d.review_decision)) {
          if (!d.selected_core_id) {
            blocking.push(`${label}: ${d.review_decision} requires selected_core_id for ${key}`);
          } else if (cands.size && !cands.has(d.selected_core_id)) {
            blocking.push(`${label}: selected_core_id ${d.selected_core_id} not in candidates for ${key}`);
          }
        }
        if (isSelective(d.review_decision)) {
          if (!d.name_source || !["coremap", "mimu"].includes(d.name_source)) {
            blocking.push(`${label}: selective_merge requires name_source=coremap|mimu for ${key}`);
          }
          if (!d.geometry_policy || !["coremap", "mimu", "union"].includes(d.geometry_policy)) {
            blocking.push(
              `${label}: selective_merge requires geometry_policy=coremap|mimu|union for ${key}`,
            );
          }
        }
        if (d.review_decision === "merge_confirmed_duplicate") {
          if (!d.selected_core_id) blocking.push(`${label}: merge requires survivor selected_core_id for ${key}`);
          if (!d.losing_core_ids) blocking.push(`${label}: merge requires losing_core_ids for ${key}`);
          for (const id of d.losing_core_ids.split(";").map((x) => x.trim()).filter(Boolean)) {
            if (cands.size && !cands.has(id) && id !== d.selected_core_id) {
              warnings.push(`${label}: losing id ${id} not listed on ${key}`);
            }
          }
        }
        if (d.review_decision === "create_new" || d.review_decision === "reject_source_error") {
          if (d.selected_core_id) {
            blocking.push(`${label}: ${d.review_decision} must not have selected_core_id for ${key}`);
          }
        }
        // type mismatch + parent/township mismatch for match / selective merge
        if (isMatchLike(d.review_decision) && d.selected_core_id) {
          const types = (row.candidate_types || "").split("|").map((x) => x.trim());
          const ids = (row.candidate_core_ids || "").split(";").map((x) => x.trim());
          const parents = (row.candidate_parents || "").split("|").map((x) => x.trim());
          const idx = ids.indexOf(d.selected_core_id);
          if (idx >= 0 && types[idx] && row.entity_type && types[idx] !== row.entity_type) {
            // village vs local_area is soft
            if (!(row.entity_type === "village" && types[idx] === "local_area")) {
              blocking.push(
                `${label}: type mismatch source=${row.entity_type} candidate=${types[idx]} for ${key}`,
              );
            } else {
              warnings.push(`${label}: village matched to local_area for ${key}`);
            }
          }
          if (idx >= 0 && parents[idx] && row.source_parent) {
            const srcTs = townshipFromParent(row.source_parent).toLowerCase();
            const candTs = townshipFromParent(parents[idx]).toLowerCase();
            if (srcTs && candTs && srcTs !== candTs) {
              blocking.push(
                `${label}: parent/township mismatch source=${srcTs} candidate=${candTs} for ${key}`,
              );
            }
          }
        }
      }
    }
  };

  checkQueue(localQueue, localMap, "local", "source_key");
  checkQueue(villageQueue, villageMap, "village", "source_key");
  checkQueue(mergeQueue, mergeMap, "merge", "source_key");

  // Duplicate source assignments to same core id across match / selective merge
  const coreOwners = new Map<string, string[]>();
  for (const [label, decisions] of [
    ["local", localDec],
    ["village", villageDec],
  ] as const) {
    for (const d of decisions) {
      if (isMatchLike(d.review_decision) && d.selected_core_id) {
        const list = coreOwners.get(d.selected_core_id) || [];
        list.push(`${label}:${d.review_id}`);
        coreOwners.set(d.selected_core_id, list);
      }
    }
  }
  for (const [coreId, owners] of coreOwners) {
    if (owners.length > 1) {
      blocking.push(`conflicting match/selective_merge for CoreMap id ${coreId}: ${owners.join(", ")}`);
    }
  }

  // create_new duplicate identities
  const createKeys = new Map<string, string[]>();
  const addCreates = (queue: Record<string, string>[], decisions: Map<string, DecisionRow>, label: string) => {
    for (const row of queue) {
      const d = decisions.get(row.source_key);
      if (!d || d.review_decision !== "create_new") continue;
      const ident = [
        row.entity_type || "",
        (row.source_parent || "").toLowerCase(),
        (row.source_name_mm || "").toLowerCase(),
        (row.source_name_en || "").toLowerCase(),
      ].join("|");
      if (!row.source_name_mm && !row.source_name_en) continue;
      const list = createKeys.get(ident) || [];
      list.push(`${label}:${row.source_key}`);
      createKeys.set(ident, list);
    }
  };
  addCreates(localQueue, localMap, "local");
  addCreates(villageQueue, villageMap, "village");
  for (const [ident, keys] of createKeys) {
    if (keys.length > 1) blocking.push(`create_new duplicate identity (${ident}): ${keys.slice(0, 5).join(", ")}`);
  }

  const md = [
    "# Phase 3 decision validation",
    "",
    `**Generated:** ${new Date().toISOString()}`,
    "**Production writes:** none",
    "",
    `Blocking errors: **${blocking.length}**`,
    `Warnings: **${warnings.length}**`,
    "",
    "## Blocking",
    "",
    ...(blocking.length ? blocking.map((e) => `- ${e}`) : ["- none"]),
    "",
    "## Warnings",
    "",
    ...(warnings.length ? warnings.map((e) => `- ${e}`) : ["- none"]),
    "",
    blocking.length
      ? "Approved import manifests were **not** generated (blocking errors remain)."
      : "No blocking errors. You may run the full freeze script when ready.",
    "",
  ].join("\n");

  return { blocking, warnings, md };
}

export function phase3ReviewApiPlugin(): Plugin {
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (!url.pathname.startsWith("/api/")) return next();

      if (req.method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, {
          ok: true,
          localOnly: true,
          reports: REPORTS,
          noDatabase: true,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/queues") {
        const [local, village, merge, localDec, villageDec, mergeDec] = await Promise.all([
          fsp.readFile(QUEUE_FILES.local, "utf8").then(parseCsv),
          fsp.readFile(QUEUE_FILES.village, "utf8").then(parseCsv),
          fsp.readFile(QUEUE_FILES.merge, "utf8").then(parseCsv),
          loadDecisions("local"),
          loadDecisions("village"),
          loadDecisions("merge"),
        ]);
        // Attach real CoreMap names onto merge plans (CSV only has IDs + survivor/duplicate roles).
        const mergeIds = new Set<string>();
        for (const row of merge) {
          if (row.survivor_core_id) mergeIds.add(row.survivor_core_id);
          for (const id of (row.duplicate_core_ids || "").split(";")) {
            const t = id.trim();
            if (t) mergeIds.add(t);
          }
        }
        const nameMap = await lookupCoreNames([...mergeIds]);
        const mergeEnriched = merge.map((row) => {
          const ids = [
            row.survivor_core_id,
            ...(row.duplicate_core_ids || "").split(";").map((x) => x.trim()),
          ].filter(Boolean);
          const names = ids.map((id) => {
            const n = nameMap.get(id);
            const mm = n?.name_mm || "";
            const en = n?.name_en || "";
            if (mm || en) return `${mm || en} [${en || "—"} / ${mm || "—"}]`;
            return id;
          });
          const types = ids.map((id) => nameMap.get(id)?.type || row.entity_type || "");
          return {
            ...row,
            candidate_core_ids: ids.join(";"),
            candidate_names: names.join(" | "),
            candidate_types: types.join(" | "),
          };
        });
        return sendJson(res, 200, {
          local,
          village,
          merge: mergeEnriched,
          decisions: { local: localDec, village: villageDec, merge: mergeDec },
          clipPreviews: Object.fromEntries(
            (await fsp.readFile(CLIP_PLAN, "utf8").then(parseCsv).catch(() => [] as Record<string, string>[])).map(
              (r) => [r.source_key, r.preview_path || ""],
            ).filter(([, p]) => Boolean(p)),
          ),
        });
      }

      if (req.method === "GET" && url.pathname === "/api/preview") {
        const raw = url.searchParams.get("path") || "";
        const resolved = resolvePreviewPath(raw);
        if (!resolved) return sendJson(res, 404, { error: "preview_not_found", path: raw });
        const text = await fsp.readFile(resolved, "utf8");
        return sendText(res, 200, text, "application/geo+json; charset=utf-8");
      }

      if (req.method === "GET" && url.pathname === "/api/candidate-geoms") {
        const kind = url.searchParams.get("kind") || "";
        const ids = (url.searchParams.get("ids") || "").split(",").map((x) => x.trim()).filter(Boolean);
        if (kind === "wvt") {
          const [index, names] = await Promise.all([ensureWvtIndex(), ensureWvtNamesIndex()]);
          const features: GeoJSON.Feature[] = [];
          ids.forEach((id, i) => {
            const geom = index.get(id);
            if (!geom) return;
            const n = names.get(id);
            features.push({
              type: "Feature",
              properties: {
                id,
                index: i + 1,
                name_mm: n?.name_mm || "",
                name_en: n?.name_en || "",
              },
              geometry: geom,
            });
          });
          return sendJson(res, 200, { type: "FeatureCollection", features });
        }
        if (kind === "settlement") {
          const index = await ensureSettlementIndex();
          const features: GeoJSON.Feature[] = [];
          ids.forEach((id, i) => {
            const pt = index.get(id);
            if (!pt) return;
            features.push({
              type: "Feature",
              properties: {
                id,
                index: i + 1,
                name_en: pt.name_en,
                name_mm: pt.name_mm,
                type: pt.type,
                township_id: pt.township_id,
              },
              geometry: { type: "Point", coordinates: [pt.lon, pt.lat] },
            });
          });
          return sendJson(res, 200, { type: "FeatureCollection", features });
        }
        return sendJson(res, 400, { error: "kind must be wvt or settlement" });
      }

      if (req.method === "PUT" && url.pathname.startsWith("/api/decisions/")) {
        const kind = url.pathname.split("/").pop() as QueueKind;
        if (!(kind in DECISION_FILES)) return sendJson(res, 404, { error: "unknown_queue" });
        const body = (await readJsonBody(req)) as Partial<DecisionRow> & { confirmReplace?: boolean };
        if (!body.review_id || !body.review_decision) {
          return sendJson(res, 400, { error: "review_id and review_decision required" });
        }
        const existing = await loadDecisions(kind);
        const prev = existing.find((d) => d.review_id === body.review_id);
        if (prev && prev.review_decision && !body.confirmReplace) {
          return sendJson(res, 409, {
            error: "decision_exists",
            existing: prev,
            message: "Confirm replace to overwrite existing decision",
          });
        }
        const decision: DecisionRow = {
          review_id: body.review_id,
          source_key: body.source_key || body.review_id,
          review_decision:
            body.review_decision === "selective_merge_union"
              ? "selective_merge"
              : body.review_decision,
          selected_core_id: body.selected_core_id || "",
          losing_core_ids: body.losing_core_ids || "",
          name_source: body.name_source || "",
          geometry_policy: body.geometry_policy || "",
          review_note: body.review_note || "",
          updated_at: new Date().toISOString(),
        };
        // Enforce save-time rules (soft)
        if (
          (decision.review_decision === "match_existing" ||
            decision.review_decision === "selective_merge") &&
          !decision.selected_core_id
        ) {
          return sendJson(res, 400, {
            error: `${decision.review_decision} requires selected_core_id`,
          });
        }
        if (decision.review_decision === "selective_merge") {
          if (!decision.name_source || !["coremap", "mimu"].includes(decision.name_source)) {
            return sendJson(res, 400, {
              error: "selective_merge requires name_source=coremap|mimu",
            });
          }
          if (
            !decision.geometry_policy ||
            !["coremap", "mimu", "union"].includes(decision.geometry_policy)
          ) {
            return sendJson(res, 400, {
              error: "selective_merge requires geometry_policy=coremap|mimu|union",
            });
          }
        }
        if (decision.review_decision === "merge_confirmed_duplicate") {
          if (!decision.selected_core_id || !decision.losing_core_ids) {
            return sendJson(res, 400, {
              error: "merge_confirmed_duplicate requires survivor and losers",
            });
          }
        }
        if (
          (decision.review_decision === "create_new" || decision.review_decision === "reject_source_error") &&
          decision.selected_core_id
        ) {
          return sendJson(res, 400, { error: `${decision.review_decision} must not set selected_core_id` });
        }
        const all = await upsertDecision(kind, decision);
        return sendJson(res, 200, { ok: true, decision, count: all.length });
      }

      if (req.method === "POST" && url.pathname === "/api/validate") {
        const [local, village, merge, localDec, villageDec, mergeDec] = await Promise.all([
          fsp.readFile(QUEUE_FILES.local, "utf8").then(parseCsv),
          fsp.readFile(QUEUE_FILES.village, "utf8").then(parseCsv),
          fsp.readFile(QUEUE_FILES.merge, "utf8").then(parseCsv),
          loadDecisions("local"),
          loadDecisions("village"),
          loadDecisions("merge"),
        ]);
        const result = validateDecisions(local, village, merge, localDec, villageDec, mergeDec);
        const outPath = path.join(REPORTS, "03-decision-validation.md");
        await atomicWrite(outPath, result.md);
        return sendJson(res, 200, {
          ok: result.blocking.length === 0,
          blocking: result.blocking.length,
          warnings: result.warnings.length,
          reportPath: "reports/admin-reconciliation-v2/03-decision-validation.md",
          sampleBlocking: result.blocking.slice(0, 20),
          manifestsGenerated: false,
        });
      }

      return sendJson(res, 404, { error: "not_found" });
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, {
        error: "server_error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return {
    name: "phase3-review-api",
    configureServer(server) {
      void Promise.all([
        ensureDecisionFile("local"),
        ensureDecisionFile("village"),
        ensureDecisionFile("merge"),
      ]);
      server.middlewares.use(handler);
    },
  };
}
