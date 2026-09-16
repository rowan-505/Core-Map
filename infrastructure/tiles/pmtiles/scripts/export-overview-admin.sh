#!/usr/bin/env bash
# Export overview Myanmar admin layers from local tile_source.admin_areas.
#
# Reads CURRENT DB geometry each run (after tiles:sync). No committed GeoJSON
# override. No MIMU. Does not query Supabase. Does not mutate DB rows.
#
# Outputs (gitignored GeoJSONSeq under data/processed/overview/):
#   myanmar_country.geojsonseq       — exactly 1 active country (as-is + MakeValid)
#   myanmar_state_region.geojsonseq  — official 15 state_region (packages.yaml)
#   myanmar_state_labels.geojsonseq  — label points (admin_labels or PointOnSurface)
#
# Usage:
#   npm run tiles:export:overview-admin
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/load-root-env.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/region-resolver.sh"

OUT_DIR="${REPO_ROOT}/infrastructure/tiles/data/processed/overview"
COUNTRY_OUT="${OUT_DIR}/myanmar_country.geojsonseq"
STATE_OUT="${OUT_DIR}/myanmar_state_region.geojsonseq"
LABELS_OUT="${OUT_DIR}/myanmar_state_labels.geojsonseq"

command -v psql >/dev/null 2>&1 || { echo "error: psql required" >&2; exit 1; }
command -v ogr2ogr >/dev/null 2>&1 || { echo "error: ogr2ogr required" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "error: python3 required" >&2; exit 1; }

if [[ -z "${LOCAL_TILE_DATABASE_URL:-}" ]]; then
  echo "error: LOCAL_TILE_DATABASE_URL is not set (local coremap_tiles required)." >&2
  exit 1
fi

if [[ "${LOCAL_TILE_DATABASE_URL}" == *supabase* || "${LOCAL_TILE_DATABASE_URL}" == *pooler.supabase* ]]; then
  echo "error: LOCAL_TILE_DATABASE_URL must be local coremap_tiles, not Supabase." >&2
  exit 1
fi

LOCAL_TILE_DATABASE_URL="$(local_map_clean_pg_url "$LOCAL_TILE_DATABASE_URL")"
export LOCAL_TILE_DATABASE_URL
local_map_log_local_tile_database_url_host

mkdir -p "$OUT_DIR"

# --- Official 15 state/region core_ids from packages.yaml ---
declare -a SELECTED_CORE_IDS=()

for package_key in "${PMTILES_SUPPORTED_REGIONS[@]}"; do
  members_json="$(python3 "$PMTILES_PACKAGE_CONFIG_PY" members-json "$package_key")"
  while IFS= read -r member; do
    [[ -z "$member" ]] && continue
    admin_level="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("admin_level") or "")' "$member")"
    name_en="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("name_en") or "")' "$member")"
    name_mm="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("name_mm") or "")' "$member")"
    core_id="$(python3 -c 'import json,sys; v=json.loads(sys.argv[1]).get("core_id"); print("" if v is None else v)' "$member")"

    if [[ "$admin_level" != "state_region" ]]; then
      echo "error: package '${package_key}' admin_level must be state_region (got '${admin_level}')" >&2
      exit 1
    fi

    row="$(pmtiles_resolve_package_member "$admin_level" "$name_en" "$name_mm" "$core_id")" || exit 1
    IFS='|' read -r mid _mname _area <<<"$row"
    SELECTED_CORE_IDS+=("$mid")
  done < <(python3 -c 'import json,sys; [print(json.dumps(m, ensure_ascii=False)) for m in json.loads(sys.argv[1])]' "$members_json")
done

UNIQUE_IDS_CSV="$(
  printf '%s\n' "${SELECTED_CORE_IDS[@]}" \
    | sed '/^$/d' \
    | sort -n -u \
    | paste -sd, -
)"
UNIQUE_COUNT="$(printf '%s\n' "${SELECTED_CORE_IDS[@]}" | sed '/^$/d' | sort -n -u | wc -l | tr -d ' ')"

if [[ "$UNIQUE_COUNT" -ne 15 ]]; then
  echo "error: official state_region allowlist resolved to ${UNIQUE_COUNT} unique core_id(s); expected 15." >&2
  exit 1
fi

echo "[export-overview-admin] official 15 core_ids: ${UNIQUE_IDS_CSV}" >&2
echo "[export-overview-admin] country geom is read from CURRENT tile_source.admin_areas each run" >&2

export_layer() {
  local dest="$1"
  local sql="$2"
  local expected="$3"
  local label="$4"
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/overview-${label}.XXXXXX.geojsonseq")"

  ogr2ogr \
    -overwrite \
    -f GeoJSONSeq \
    -s_srs EPSG:4326 \
    -t_srs EPSG:4326 \
    "$tmp" \
    "PG:${LOCAL_TILE_DATABASE_URL}" \
    -sql "$sql"

  local actual
  actual="$(grep -c . "$tmp" || true)"
  if [[ "$actual" -ne "$expected" ]]; then
    echo "error: ${label} wrote ${actual} features; expected ${expected}." >&2
    rm -f "$tmp"
    exit 1
  fi
  mv -f "$tmp" "$dest"
}

# Country: exactly one active row. MakeValid + Multi only — no reshape / clip / union.
COUNTRY_SQL="
SELECT
  a.core_id,
  a.name,
  a.name_mm,
  a.name_en,
  a.admin_level_code,
  ST_Multi(
    ST_CollectionExtract(
      ST_MakeValid(ST_Force2D(ST_SetSRID(a.geom, 4326))),
      3
    )
  )::geometry(MultiPolygon, 4326) AS geom
FROM tile_source.admin_areas AS a
WHERE a.admin_level_code = 'country'
  AND a.is_active IS TRUE
  AND a.deleted_at IS NULL
  AND a.geom IS NOT NULL
  AND NOT ST_IsEmpty(a.geom)
"

# Official 15 states (as stored; MakeValid only)
STATE_SQL="
SELECT
  a.core_id,
  a.name,
  a.name_mm,
  a.name_en,
  a.admin_level_code,
  ST_Multi(
    ST_CollectionExtract(
      ST_MakeValid(ST_Force2D(ST_SetSRID(a.geom, 4326))),
      3
    )
  )::geometry(MultiPolygon, 4326) AS geom
FROM tile_source.admin_areas AS a
WHERE a.core_id IN (${UNIQUE_IDS_CSV})
  AND a.admin_level_code = 'state_region'
  AND a.is_active IS TRUE
  AND a.deleted_at IS NULL
  AND a.geom IS NOT NULL
  AND NOT ST_IsEmpty(a.geom)
ORDER BY a.core_id
"

# Labels: prefer tile_source.admin_labels, else PointOnSurface on current state geom.
# Properties: core_id, name_mm, name_en (+ name for fallback), label_source.
# Overview-only short aliases + sort_rank are added after export (no DB mutation).
LABELS_SQL="
WITH states AS (
  SELECT
    a.core_id,
    a.name,
    a.name_mm,
    a.name_en,
    ST_Multi(
      ST_CollectionExtract(
        ST_MakeValid(ST_Force2D(ST_SetSRID(a.geom, 4326))),
        3
      )
    ) AS geom
  FROM tile_source.admin_areas AS a
  WHERE a.core_id IN (${UNIQUE_IDS_CSV})
    AND a.admin_level_code = 'state_region'
    AND a.is_active IS TRUE
    AND a.deleted_at IS NULL
    AND a.geom IS NOT NULL
    AND NOT ST_IsEmpty(a.geom)
)
SELECT
  s.core_id,
  s.name,
  s.name_mm,
  s.name_en,
  CASE
    WHEN l.geom IS NOT NULL AND NOT ST_IsEmpty(l.geom)
      THEN ST_SetSRID(l.geom, 4326)::geometry(Point, 4326)
    ELSE ST_PointOnSurface(s.geom)::geometry(Point, 4326)
  END AS geom,
  CASE
    WHEN l.geom IS NOT NULL AND NOT ST_IsEmpty(l.geom) THEN 'admin_labels'
    ELSE 'point_on_surface'
  END AS label_source
FROM states s
LEFT JOIN tile_source.admin_labels l
  ON l.core_id = s.core_id
 AND l.admin_level_code = 'state_region'
ORDER BY s.core_id
"

echo "[export-overview-admin] writing ${COUNTRY_OUT}" >&2
export_layer "$COUNTRY_OUT" "$COUNTRY_SQL" 1 "myanmar_country"

echo "[export-overview-admin] writing ${STATE_OUT}" >&2
export_layer "$STATE_OUT" "$STATE_SQL" 15 "myanmar_state_region"

echo "[export-overview-admin] writing ${LABELS_OUT}" >&2
export_layer "$LABELS_OUT" "$LABELS_SQL" 15 "myanmar_state_labels"

# Package-order sort_rank (1..15) — lower = higher MapLibre placement priority.
PACKAGE_ORDER_CSV="$(printf '%s,' "${SELECTED_CORE_IDS[@]}" | sed 's/,$//')"

python3 - "$LABELS_OUT" "$PACKAGE_ORDER_CSV" <<'PY'
import json
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
order = [int(x) for x in sys.argv[2].split(",") if x.strip()]
rank_by_id = {cid: i + 1 for i, cid in enumerate(order)}

# Overview-only display aliases (do not write back to DB).
SHORT_MM = {
    "ကချင်ပြည်နယ်": "ကချင်",
    "ကယားပြည်နယ်": "ကယား",
    "ကရင်ပြည်နယ်": "ကရင်",
    "ချင်းပြည်နယ်": "ချင်း",
    "စစ်ကိုင်းတိုင်းဒေသကြီး": "စစ်ကိုင်း",
    "တနင်္သာရီတိုင်း": "တနင်္သာရီ",
    "နေပြည်တော် ပြည်ထောင်စုနယ်မြေ": "နေပြည်တော်",
    "ပဲခူးတိုင်းဒေသကြီး": "ပဲခူး",
    "မကွေးတိုင်းဒေသကြီး": "မကွေး",
    "မန္တလေးတိုင်း": "မန္တလေး",
    "မွန်ပြည်နယ်": "မွန်",
    "ရခိုင်ပြည်နယ်": "ရခိုင်",
    "ရန်ကုန်တိုင်းဒေသကြီး": "ရန်ကုန်",
    "ရှမ်းပြည်နယ်": "ရှမ်း",
    "ဧရာဝတီတိုင်း": "ဧရာဝတီ",
}

SHORT_EN = {
    "Kachin State": "Kachin",
    "Kayah State": "Kayah",
    "Kayin State": "Kayin",
    "Chin State": "Chin",
    "Sagaing Region": "Sagaing",
    "Tanintharyi Region": "Tanintharyi",
    "Naypyidaw Union Territory": "Naypyidaw",
    "Bago Region": "Bago",
    "Magway Region": "Magway",
    "Mandalay Region": "Mandalay",
    "Mon State": "Mon",
    "Rakhine State": "Rakhine",
    "Yangon Region": "Yangon",
    "Shan State": "Shan",
    "Ayeyarwady Region": "Ayeyarwady",
}

# core_id fallback when name_en is null or name_mm has invisible chars
SHORT_BY_CORE_ID = {
    13: ("ရန်ကုန်", "Yangon"),
    5089: ("မွန်", "Mon"),
    5879: ("ကရင်", "Kayin"),
    6007: ("ကယား", "Kayah"),
    6031: ("နေပြည်တော်", "Naypyidaw"),
    6329: ("ရှမ်း", "Shan"),
    6667: ("ကချင်", "Kachin"),
    6703: ("စစ်ကိုင်း", "Sagaing"),
    6722: ("ရခိုင်", "Rakhine"),
    6744: ("ချင်း", "Chin"),
    6832: ("မန္တလေး", "Mandalay"),
    7027: ("မကွေး", "Magway"),
    7169: ("ပဲခူး", "Bago"),
    7279: ("ဧရာဝတီ", "Ayeyarwady"),
    7449: ("တနင်္သာရီ", "Tanintharyi"),
}

ZW = re.compile(r"[\u200b\u200c\u200d\ufeff]")


def norm(s: str | None) -> str:
    if not s:
        return ""
    return ZW.sub("", s).strip()


lines = path.read_text(encoding="utf-8").splitlines()
out = []
methods = {}
for line in lines:
    feat = json.loads(line)
    props = feat.setdefault("properties", {})
    core_id = int(props["core_id"])
    name_mm = props.get("name_mm")
    name_en = props.get("name_en")
    mm_key = norm(name_mm)
    short_mm = SHORT_MM.get(mm_key)
    short_en = SHORT_EN.get(norm(name_en)) if name_en else None
    if short_mm is None or short_en is None:
        fb = SHORT_BY_CORE_ID.get(core_id)
        if fb:
            short_mm = short_mm or fb[0]
            short_en = short_en or fb[1]
    if not short_mm:
        short_mm = mm_key or norm(props.get("name")) or short_en or str(core_id)
    if not short_en:
        short_en = norm(name_en) or short_mm

    props["label_name_mm"] = short_mm
    props["label_name_en"] = short_en
    props["sort_rank"] = rank_by_id.get(core_id, 99)
    methods[props.get("label_source", "?")] = methods.get(props.get("label_source", "?"), 0) + 1
    # Keep canonical name_mm / name_en unchanged.
    out.append(json.dumps(feat, ensure_ascii=False, separators=(",", ":")))

if len(out) != 15:
    raise SystemExit(f"label enrich expected 15 features, got {len(out)}")
if len({json.loads(l)["properties"]["core_id"] for l in out}) != 15:
    raise SystemExit("duplicate core_id in state labels after enrich")

path.write_text("\n".join(out) + "\n", encoding="utf-8")
print(
    f"[export-overview-admin] label enrich OK methods={methods} "
    f"sort_rank=package-order short_aliases=overview-only",
    file=sys.stderr,
)
PY

# Remove legacy / hybrid intermediates so they cannot be consumed by build
rm -f \
  "${OUT_DIR}/admin_country.geojsonseq" \
  "${OUT_DIR}/admin_country_outline.geojsonseq" \
  "${OUT_DIR}/admin_country_land_border.geojsonseq" \
  "${OUT_DIR}/admin_state_region.geojsonseq" \
  "${OUT_DIR}/admin_state_region_boundaries.geojsonseq" \
  "${OUT_DIR}/admin_state_region_labels.geojsonseq" \
  "${OUT_DIR}/myanmar_coastline.geojsonseq" \
  "${OUT_DIR}/myanmar_major_islands.geojsonseq"

# Prove exporter fingerprint is live DB geometry (not a stale committed file).
COUNTRY_FINGERPRINT="$(
  psql "$LOCAL_TILE_DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "
SELECT md5(ST_AsEWKB(ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(geom,4326))),3))))
FROM tile_source.admin_areas
WHERE admin_level_code = 'country' AND is_active IS TRUE AND deleted_at IS NULL
LIMIT 1;
"
)"
EXPORT_FINGERPRINT="$(
  python3 - <<'PY' "$COUNTRY_OUT"
import hashlib, json, sys
from pathlib import Path
feat = json.loads(Path(sys.argv[1]).read_text().splitlines()[0])
# Fingerprint exported coords string (order-stable enough for change detection)
payload = json.dumps(feat["geometry"]["coordinates"], separators=(",", ":"))
print(hashlib.md5(payload.encode()).hexdigest())
PY
)"

echo "[export-overview-admin] SUCCESS" >&2
echo "[export-overview-admin] country: ${COUNTRY_OUT} (1)" >&2
echo "[export-overview-admin] states: ${STATE_OUT} (15)" >&2
echo "[export-overview-admin] labels: ${LABELS_OUT} (15)" >&2
echo "[export-overview-admin] db_country_ewkb_md5=${COUNTRY_FINGERPRINT}" >&2
echo "[export-overview-admin] export_coords_md5=${EXPORT_FINGERPRINT}" >&2
echo "[export-overview-admin] note: future QGIS country geom replacement → tiles:sync → this export picks it up automatically" >&2
