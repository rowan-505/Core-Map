#!/usr/bin/env bash
# Local-first OSM import pipeline. Core promotion stays disabled.
# Orchestrates stages 00–10 (plus optional 18 classification report). Stops after Stage 10.
#
# Usage:
#   ./run_local_osm_pipeline.sh imports/kyauktan_2026_07_v4.env
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# shellcheck source=../lib/progress_heartbeat.sh
source "${SCRIPT_DIR}/../lib/progress_heartbeat.sh"

usage() {
  cat >&2 <<EOF
usage: $(basename "$0") <import-env-file>

  <import-env-file>  Full per-import env file (e.g. imports/kyauktan_2026_07_v4.env)

Copy and edit the template:
  cp imports/template.full.env imports/kyauktan_2026_07_v4.env

See README.md for stage list and resume (PIPELINE_FROM_STAGE).
EOF
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

IMPORT_ENV_ARG="$1"

resolve_import_env_file() {
  local arg="$1"
  if [[ -f "${arg}" ]]; then
    echo "$(cd "$(dirname "${arg}")" && pwd)/$(basename "${arg}")"
    return 0
  fi
  if [[ -f "${SCRIPT_DIR}/${arg}" ]]; then
    echo "${SCRIPT_DIR}/${arg}"
    return 0
  fi
  return 1
}

if ! IMPORT_ENV_FILE="$(resolve_import_env_file "${IMPORT_ENV_ARG}")"; then
  echo "error: import env file not found: ${IMPORT_ENV_ARG}" >&2
  echo "       (tried relative path and ${SCRIPT_DIR}/${IMPORT_ENV_ARG})" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "${IMPORT_ENV_FILE}"

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "error: required variable ${name} is empty or unset in ${IMPORT_ENV_FILE}" >&2
    exit 1
  fi
}

require_var LOCAL_DATABASE_URL
require_var SOURCE_CODE
require_var REGION_CODE
require_var PBF_PATH
require_var SNAPSHOT_REF
require_var SNAPSHOT_VERSION
require_var BATCH_NAME
require_var LOG_DIR

# OSM2PGSQL_FLEX_FILE is optional — Stage 02 auto-selects entity-specific Lua when unset.

# Optional boundary GeoJSON — empty/unset => whole-region import (no clipping).
BOUNDARY_GEOJSON_PATH="$(printf '%s' "${BOUNDARY_GEOJSON_PATH:-}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
export BOUNDARY_GEOJSON_PATH

if [[ -n "${BOUNDARY_GEOJSON_PATH}" ]]; then
  BOUNDARY_MODE="CLIPPED"
  require_var BOUNDARY_CODE
  require_var BOUNDARY_NAME
  require_var BOUNDARY_VERSION
  BOUNDARY_ID=""
else
  BOUNDARY_MODE="WHOLE_REGION"
  BOUNDARY_ID=""
fi
export BOUNDARY_MODE
export BOUNDARY_ID

if [[ ! -f "${PBF_PATH}" ]]; then
  echo "error: PBF_PATH does not exist: ${PBF_PATH}" >&2
  exit 1
fi

if ! command -v shasum >/dev/null 2>&1; then
  echo "error: shasum is required to calculate the PBF checksum" >&2
  exit 1
fi

CHECKSUM="$(shasum -a 256 "${PBF_PATH}" | awk '{print $1}')"
export CHECKSUM
ALLOW_BOUNDARY_UPDATE="${ALLOW_BOUNDARY_UPDATE:-false}"
export ALLOW_BOUNDARY_UPDATE

TMP_IMPORT_SCHEMA="${TMP_IMPORT_SCHEMA:-tmp_import}"
RAW_SCHEMA="${RAW_SCHEMA:-raw}"
STAGING_SCHEMA="${STAGING_SCHEMA:-staging}"
SYSTEM_SCHEMA="${SYSTEM_SCHEMA:-system}"

# ENTITY_FAMILIES: all | comma-separated pipeline slugs (default all).
PIPELINE_ENTITY_FAMILIES_ALLOWED=(
  places settlements roads buildings landuse protected_areas water_lines water_polygons coastlines
  admin_areas bus_stops bus_routes bus_route_variants bus_route_stops
  addresses address_components place_address_links
  routing_barriers routing_roads routing_turn_restrictions
)

normalize_entity_families() {
  local raw="${1:-all}"
  raw="$(printf '%s' "${raw}" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
  if [[ -z "${raw}" || "${raw}" == "all" || "${raw}" == "*" ]]; then
    printf '%s' "all"
    return 0
  fi

  local -a parts=()
  local part
  IFS=',' read -r -a parts <<< "${raw}"
  local -a normalized=()
  local allowed slug found

  for part in "${parts[@]}"; do
    part="$(printf '%s' "${part}" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
    [[ -z "${part}" ]] && continue

    found=0
    for allowed in "${PIPELINE_ENTITY_FAMILIES_ALLOWED[@]}"; do
      if [[ "${part}" == "${allowed}" ]]; then
        found=1
        break
      fi
    done
    if [[ "${found}" -ne 1 ]]; then
      echo "error: unsupported ENTITY_FAMILIES slug \"${part}\"" >&2
      echo "       allowed: ${PIPELINE_ENTITY_FAMILIES_ALLOWED[*]}" >&2
      exit 1
    fi

    local duplicate=0
    for slug in "${normalized[@]:-}"; do
      if [[ "${slug}" == "${part}" ]]; then
        duplicate=1
        break
      fi
    done
    if [[ "${duplicate}" -eq 0 ]]; then
      normalized+=("${part}")
    fi
  done

  if [[ "${#normalized[@]}" -eq 0 ]]; then
    echo "error: ENTITY_FAMILIES resolved to an empty set: ${1}" >&2
    exit 1
  fi

  local IFS=','
  printf '%s' "${normalized[*]}"
}

ENTITY_FAMILIES="$(normalize_entity_families "${ENTITY_FAMILIES:-all}")"
export ENTITY_FAMILIES

mask_database_url() {
  local url="$1"
  if [[ "${url}" =~ ^postgres(ql)?://([^:/@]+):[^@]*@(.+)$ ]]; then
    echo "postgresql://${BASH_REMATCH[2]}:***@${BASH_REMATCH[3]}"
  elif [[ "${url}" =~ ^postgres(ql)?://([^@]+)@(.+)$ ]]; then
    echo "postgresql://${BASH_REMATCH[2]}@${BASH_REMATCH[3]}"
  else
    echo "postgresql://***"
  fi
}

mkdir -p "${LOG_DIR}"
RUN_TS="$(date -u +"%Y%m%dT%H%M%SZ")"
SAFE_SNAPSHOT_VERSION="${SNAPSHOT_VERSION//\//_}"
LOG_FILE="${LOG_DIR}/local-osm-pipeline_${SAFE_SNAPSHOT_VERSION}_${RUN_TS}.log"

log() {
  echo "$*" | tee -a "${LOG_FILE}"
}

# Resume from a stage (e.g. 08) after stages 01–07 already completed. Empty = full pipeline.
# Optional PIPELINE_TO_STAGE stops after that stage (inclusive), for fast sample/smoke runs.
PIPELINE_FROM_STAGE="${PIPELINE_FROM_STAGE:-}"
PIPELINE_TO_STAGE="${PIPELINE_TO_STAGE:-}"
PIPELINE_PSQL_WORK_MEM="${PIPELINE_PSQL_WORK_MEM:-512MB}"
PIPELINE_PSQL_MAINTENANCE_WORK_MEM="${PIPELINE_PSQL_MAINTENANCE_WORK_MEM:-1GB}"
# 0 = no limit (local national F2/F1). Set e.g. 2h if you need a cap.
PIPELINE_STATEMENT_TIMEOUT="${PIPELINE_STATEMENT_TIMEOUT:-0}"
PIPELINE_STAGE_I=0

pipeline_stage_num() {
  printf '%d' "$((10#${1//[^0-9]/}))" 2>/dev/null || printf '%d' 0
}

# Execution order (Stage 18 runs after 08d but before 09).
pipeline_stage_order() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    00|0) printf '%d' 0 ;;
    01|1) printf '%d' 10 ;;
    02|2) printf '%d' 20 ;;
    03|3) printf '%d' 30 ;;
    04|4) printf '%d' 40 ;;
    05|5) printf '%d' 50 ;;
    06|6) printf '%d' 60 ;;
    07|7) printf '%d' 70 ;;
    08|8|08b|08c|08d) printf '%d' 80 ;;
    18) printf '%d' 85 ;;
    09|9) printf '%d' 90 ;;
    10) printf '%d' 95 ;;
    *) printf '%d' "$(pipeline_stage_num "$1")" ;;
  esac
}

pipeline_should_run_stage() {
  local stage_id="$1"
  local stage_ord
  stage_ord="$(pipeline_stage_order "${stage_id}")"
  if [[ -n "${PIPELINE_FROM_STAGE}" ]]; then
    local from_ord
    from_ord="$(pipeline_stage_order "${PIPELINE_FROM_STAGE}")"
    if [[ "${stage_ord}" -lt "${from_ord}" ]]; then
      return 1
    fi
  fi
  if [[ -n "${PIPELINE_TO_STAGE}" ]]; then
    local to_ord
    to_ord="$(pipeline_stage_order "${PIPELINE_TO_STAGE}")"
    if [[ "${stage_ord}" -gt "${to_ord}" ]]; then
      return 1
    fi
  fi
  return 0
}

# Count only stages that will actually run (so done/total matches reality).
pipeline_count_planned_stages() {
  local n=0
  local sid
  if pipeline_should_run_stage "00"; then
    n=$((n + 1)) # 00_preflight_schema_compatibility
    if [[ "${BOUNDARY_MODE}" == "CLIPPED" ]]; then
      n=$((n + 1)) # 00_register_boundary
    fi
  fi
  for sid in 01 02 03 04 05 06; do
    if pipeline_should_run_stage "${sid}"; then
      n=$((n + 1))
    fi
  done
  if pipeline_should_run_stage "07"; then
    n=$((n + 2)) # 00b_preflight_prod_mirror + 07_compare
  fi
  if pipeline_should_run_stage "08"; then
    n=$((n + 4)) # 08, 08b, 08c, 08d
  fi
  if [[ "${CLASSIFICATION_REPORT_ENABLED:-true}" == "true" ]] && pipeline_should_run_stage "18"; then
    n=$((n + 1)) # 18_classification_bucket_report
  fi
  for sid in 09 10; do
    if pipeline_should_run_stage "${sid}"; then
      n=$((n + 1))
    fi
  done
  printf '%d' "${n}"
}

pipeline_skip_stage_log() {
  local stage_name="$1"
  local reason=""
  if [[ -n "${PIPELINE_FROM_STAGE}" || -n "${PIPELINE_TO_STAGE}" ]]; then
    reason=" — PIPELINE_FROM_STAGE=${PIPELINE_FROM_STAGE:-<start>} PIPELINE_TO_STAGE=${PIPELINE_TO_STAGE:-<end>}"
  fi
  log ""
  log "=== ${stage_name} (skipped${reason}) ==="
}

run_psql() {
  progress_set_detail "psql running (work_mem=${PIPELINE_PSQL_WORK_MEM}, stmt_timeout=${PIPELINE_STATEMENT_TIMEOUT})"
  set +e
  PAGER=cat psql "${LOCAL_DATABASE_URL}" \
    -c "SET statement_timeout = '${PIPELINE_STATEMENT_TIMEOUT}';" \
    -c "SET work_mem = '${PIPELINE_PSQL_WORK_MEM}';" \
    -c "SET maintenance_work_mem = '${PIPELINE_PSQL_MAINTENANCE_WORK_MEM}';" \
    -c "SET temp_buffers = '64MB';" \
    -c "SELECT set_config('coremap.stage06_chunk_size', coalesce(nullif(current_setting('coremap.stage06_chunk_size', true), ''), '${STAGE06_CHUNK_SIZE:-50000}'), false);" \
    -c "SET client_min_messages = NOTICE;" \
    "$@" \
    2>&1 | progress_tee_and_watch "${LOG_FILE}" &
  local tee_pid=$!
  wait "${tee_pid}"
  local rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    progress_set_detail "psql FAILED exit=${rc}"
    progress_print_once
    progress_stop_heartbeat
    exit "${rc}"
  fi
  progress_end_phase "ok psql"
}

print_resolved_config() {
  log "import env file: ${IMPORT_ENV_FILE}"
  log "LOCAL_DATABASE_URL=$(mask_database_url "${LOCAL_DATABASE_URL}")"
  log "SOURCE_CODE=${SOURCE_CODE}"
  log "REGION_CODE=${REGION_CODE}"
  log "BOUNDARY_MODE=${BOUNDARY_MODE}"
  log "PBF_PATH=${PBF_PATH}"
  if [[ "${BOUNDARY_MODE}" == "CLIPPED" ]]; then
    log "BOUNDARY_GEOJSON_PATH=${BOUNDARY_GEOJSON_PATH}"
    log "BOUNDARY_CODE=${BOUNDARY_CODE}"
    log "BOUNDARY_NAME=${BOUNDARY_NAME}"
    log "BOUNDARY_VERSION=${BOUNDARY_VERSION}"
  else
    log "BOUNDARY_GEOJSON_PATH=(not set — whole-region import, no clipping)"
  fi
  log "SNAPSHOT_REF=${SNAPSHOT_REF}"
  log "SNAPSHOT_VERSION=${SNAPSHOT_VERSION}"
  log "BATCH_NAME=${BATCH_NAME}"
  log "CHECKSUM=${CHECKSUM}"
  log "ALLOW_BOUNDARY_UPDATE=${ALLOW_BOUNDARY_UPDATE}"
  if [[ -n "${OSM2PGSQL_FLEX_FILE:-}" ]]; then
    log "OSM2PGSQL_FLEX_FILE=${OSM2PGSQL_FLEX_FILE}"
  else
    log "OSM2PGSQL_FLEX_FILE=(auto from ENTITY_FAMILIES in Stage 02)"
  fi
  log "LOG_DIR=${LOG_DIR}"
  log "TMP_IMPORT_SCHEMA=${TMP_IMPORT_SCHEMA}"
  log "RAW_SCHEMA=${RAW_SCHEMA}"
  log "STAGING_SCHEMA=${STAGING_SCHEMA}"
  log "SYSTEM_SCHEMA=${SYSTEM_SCHEMA}"
  log "ENTITY_FAMILIES=${ENTITY_FAMILIES}"
  log "PIPELINE_FROM_STAGE=${PIPELINE_FROM_STAGE:-<full run>}"
  log "PIPELINE_TO_STAGE=${PIPELINE_TO_STAGE:-<end>}"
  log "PIPELINE_PSQL_WORK_MEM=${PIPELINE_PSQL_WORK_MEM}"
  log "PIPELINE_PSQL_MAINTENANCE_WORK_MEM=${PIPELINE_PSQL_MAINTENANCE_WORK_MEM}"
  log "PIPELINE_STATEMENT_TIMEOUT=${PIPELINE_STATEMENT_TIMEOUT}"
}

run_stage() {
  local stage_name="$1"
  local stage_pct="${2:-}"
  PIPELINE_STAGE_I=$((PIPELINE_STAGE_I + 1))
  log ""
  if [[ -n "${stage_pct}" ]]; then
    log "=== ${stage_name} ===  [pipeline ${stage_pct}% | stage ${PIPELINE_STAGE_I}/${PIPELINE_PLANNED_STAGES}]"
  else
    log "=== ${stage_name} ===  [stage ${PIPELINE_STAGE_I}/${PIPELINE_PLANNED_STAGES}]"
  fi
  progress_begin_phase \
    "${stage_name}" \
    "stage ${PIPELINE_STAGE_I}/${PIPELINE_PLANNED_STAGES} starting${stage_pct:+ (marker ${stage_pct}%)}" \
    "${PIPELINE_STAGE_I}"
}

run_sql() {
  local sql_file="$1"
  if [[ ! -f "${sql_file}" ]]; then
    echo "error: SQL file not found: ${sql_file}" >&2
    exit 1
  fi
  progress_set_detail "sql=$(basename "${sql_file}")"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v region_code="${REGION_CODE}" \
    -v tmp_import_schema="${TMP_IMPORT_SCHEMA}" \
    -v raw_schema="${RAW_SCHEMA}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v system_schema="${SYSTEM_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${sql_file}"
}

run_shell_stage() {
  local sh_file="$1"
  if [[ ! -f "${sh_file}" ]]; then
    echo "error: shell stage not found: ${sh_file}" >&2
    exit 1
  fi
  progress_set_detail "shell=$(basename "${sh_file}")"
  set +e
  bash "${sh_file}" 2>&1 | progress_tee_and_watch "${LOG_FILE}" &
  local tee_pid=$!
  wait "${tee_pid}"
  local rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    progress_set_detail "shell FAILED $(basename "${sh_file}") exit=${rc}"
    progress_print_once
    progress_stop_heartbeat
    exit "${rc}"
  fi
  progress_end_phase "ok $(basename "${sh_file}")"
}

run_preflight_schema_compatibility() {
  local preflight_sql="${SCRIPT_DIR}/00_preflight_schema_compatibility.sql"
  if [[ ! -f "${preflight_sql}" ]]; then
    echo "error: preflight SQL file not found: ${preflight_sql}" >&2
    exit 1
  fi
  run_stage "00_preflight_schema_compatibility"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v system_schema="${SYSTEM_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${preflight_sql}"
}

run_preflight_prod_mirror() {
  local preflight_sql="${SCRIPT_DIR}/00b_preflight_prod_mirror.sql"
  if [[ "${SKIP_PROD_MIRROR_PREFLIGHT:-}" == "true" ]]; then
    log "SKIP_PROD_MIRROR_PREFLIGHT=true — skipping prod_mirror freshness preflight"
    return 0
  fi
  if [[ ! -f "${preflight_sql}" ]]; then
    echo "error: preflight SQL file not found: ${preflight_sql}" >&2
    exit 1
  fi
  run_stage "00b_preflight_prod_mirror"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v mirror_max_age_hours="${MIRROR_MAX_AGE_HOURS:-168}" \
    -v prod_mirror_schema="${PROD_MIRROR_SCHEMA:-prod_mirror}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${preflight_sql}"
}

PROGRESS_LOG_FILE="${LOG_FILE}"
PIPELINE_PLANNED_STAGES="$(pipeline_count_planned_stages)"
if [[ "${PIPELINE_PLANNED_STAGES}" -le 0 ]]; then
  PIPELINE_PLANNED_STAGES=1
fi
progress_init "local_osm_pipeline" "${PIPELINE_PLANNED_STAGES}"

log "local-osm pipeline started at ${RUN_TS}"
log "log file: ${LOG_FILE}"
log "progress: planned stages=${PIPELINE_PLANNED_STAGES} FROM=${PIPELINE_FROM_STAGE:-start} TO=${PIPELINE_TO_STAGE:-end}"
print_resolved_config

if pipeline_should_run_stage "00"; then
  run_preflight_schema_compatibility
else
  pipeline_skip_stage_log "00_preflight_schema_compatibility"
fi

if [[ "${BOUNDARY_MODE}" == "CLIPPED" ]]; then
  if pipeline_should_run_stage "00"; then
    run_stage "00_register_boundary"
  else
    pipeline_skip_stage_log "00_register_boundary"
  fi
  run_stage_00_register_boundary() {
    local boundary_id_file="${LOG_DIR}/boundary_id_${SAFE_SNAPSHOT_VERSION}_${RUN_TS}.tmp"
    local pbf_checksum_file="${LOG_DIR}/pbf_checksum_${SAFE_SNAPSHOT_VERSION}_${RUN_TS}.tmp"

    BOUNDARY_ID_OUTPUT_FILE="${boundary_id_file}" \
    PBF_CHECKSUM_OUTPUT_FILE="${pbf_checksum_file}" \
      bash "${SCRIPT_DIR}/00_register_boundary.sh" 2>&1 | tee -a "${LOG_FILE}"

    if [[ ! -s "${boundary_id_file}" ]]; then
      echo "error: boundary registration did not produce BOUNDARY_ID" >&2
      exit 1
    fi

    BOUNDARY_ID="$(< "${boundary_id_file}")"
    export BOUNDARY_ID
    rm -f "${boundary_id_file}" "${pbf_checksum_file}"
    log "BOUNDARY_ID=${BOUNDARY_ID}"
  }
  if pipeline_should_run_stage "00"; then
    run_stage_00_register_boundary
  fi
else
  log ""
  log "=== 00_register_boundary (skipped) ==="
  log "No BOUNDARY_GEOJSON_PATH provided; running without clipping boundary (WHOLE_REGION mode)."
fi

if pipeline_should_run_stage "01"; then
  run_stage "01_create_snapshot"
  run_stage_01_create_snapshot() {
    run_psql \
      -v ON_ERROR_STOP=1 \
      -v source_code="${SOURCE_CODE}" \
      -v batch_name="${BATCH_NAME}" \
      -v snapshot_ref="${SNAPSHOT_REF}" \
      -v snapshot_version="${SNAPSHOT_VERSION}" \
      -v region_code="${REGION_CODE}" \
      -v checksum="${CHECKSUM}" \
      -v boundary_id="${BOUNDARY_ID:-}" \
      -v allow_boundary_update="${ALLOW_BOUNDARY_UPDATE}" \
      -v entity_families="${ENTITY_FAMILIES}" \
      ${PSQL_EXTRA_ARGS:-} \
      -f "${SCRIPT_DIR}/01_create_snapshot.sql"
  }
  run_stage_01_create_snapshot
else
  pipeline_skip_stage_log "01_create_snapshot"
fi

if pipeline_should_run_stage "02"; then
  run_stage "02_import_to_tmp"
  run_shell_stage "${SCRIPT_DIR}/02_import_to_tmp.sh"
else
  pipeline_skip_stage_log "02_import_to_tmp"
fi

if pipeline_should_run_stage "03"; then
  run_stage "03_validate_tmp"
  run_sql "${SCRIPT_DIR}/03_validate_tmp.sql"
else
  pipeline_skip_stage_log "03_validate_tmp"
fi

if pipeline_should_run_stage "04"; then
  run_stage "04_tmp_to_raw"
  run_sql "${SCRIPT_DIR}/04_tmp_to_raw.sql"
else
  pipeline_skip_stage_log "04_tmp_to_raw"
fi

if pipeline_should_run_stage "05"; then
  run_stage "05_raw_to_staging" "40"
  run_sql "${SCRIPT_DIR}/05_raw_to_staging.sql"
else
  pipeline_skip_stage_log "05_raw_to_staging"
fi

if pipeline_should_run_stage "06"; then
  run_stage "06_diff_current_vs_previous" "50"
  run_sql "${SCRIPT_DIR}/06_diff_current_vs_previous.sql"
else
  pipeline_skip_stage_log "06_diff_current_vs_previous"
fi

if pipeline_should_run_stage "07"; then
  run_preflight_prod_mirror
  run_stage "07_compare_with_prod_mirror" "60"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v prod_mirror_schema="${PROD_MIRROR_SCHEMA:-prod_mirror}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    -v pipeline_statement_timeout="${PIPELINE_STATEMENT_TIMEOUT}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${SCRIPT_DIR}/07_compare_with_prod_mirror.sql"
else
  pipeline_skip_stage_log "07_compare_with_prod_mirror"
fi

if pipeline_should_run_stage "08"; then
  run_stage "08_assign_statuses" "70"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${SCRIPT_DIR}/08_assign_statuses.sql"
else
  pipeline_skip_stage_log "08_assign_statuses"
fi

if pipeline_should_run_stage "08"; then
  run_stage "08b_assign_import_class" "80"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    -v prod_mirror_schema="${PROD_MIRROR_SCHEMA:-prod_mirror}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${SCRIPT_DIR}/08b_assign_import_class.sql"
else
  pipeline_skip_stage_log "08b_assign_import_class"
fi

if pipeline_should_run_stage "08"; then
  run_stage "08c_assign_prod_admin_areas" "82"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    -v prod_mirror_schema="${PROD_MIRROR_SCHEMA:-prod_mirror}" \
    -v admin_assign_batch="${ADMIN_ASSIGN_BATCH:-5000}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${SCRIPT_DIR}/08c_assign_prod_admin_areas.sql"
else
  pipeline_skip_stage_log "08c_assign_prod_admin_areas"
fi

if pipeline_should_run_stage "08"; then
  run_stage "08d_reclass_settlements_after_admin" "83"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${SCRIPT_DIR}/08d_reclass_settlements_after_admin.sql"
else
  pipeline_skip_stage_log "08d_reclass_settlements_after_admin"
fi

if [[ "${CLASSIFICATION_REPORT_ENABLED:-true}" == "true" ]] && pipeline_should_run_stage "18"; then
  run_stage "18_classification_bucket_report" "85"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${SCRIPT_DIR}/18_classification_bucket_report.sql"
fi

if pipeline_should_run_stage "09"; then
  run_stage "09_create_review_views" "90"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v system_schema="${SYSTEM_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${SCRIPT_DIR}/09_create_review_views.sql"
else
  pipeline_skip_stage_log "09_create_review_views"
fi

if pipeline_should_run_stage "10"; then
  run_stage "10_summary_report" "95"
  run_psql \
    -v ON_ERROR_STOP=1 \
    -v snapshot_version="${SNAPSHOT_VERSION}" \
    -v staging_schema="${STAGING_SCHEMA}" \
    -v system_schema="${SYSTEM_SCHEMA}" \
    -v entity_families="${ENTITY_FAMILIES}" \
    ${PSQL_EXTRA_ARGS:-} \
    -f "${SCRIPT_DIR}/10_summary_report.sql"
else
  pipeline_skip_stage_log "10_summary_report"
fi

progress_finish "local-osm pipeline complete"
log ""
log "local-osm pipeline finished (no core promotion).  [pipeline 100%]"
