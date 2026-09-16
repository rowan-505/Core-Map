# shellcheck shell=bash
# Reliable dotenv loader for repository root .env (no eval, no source).
# Also loads apps/api/.env for local tile URL keys when root .env is absent/incomplete.
# Split each line only on the FIRST "="; values keep "=", "?", "&", ":", "@", etc.
# Compatible with: set -euo pipefail when sourced from export-region / build-region.
#
# Sourced by export-region.sh, build-region.sh, sync-supabase.sh, validate-source.sh.

_LOCAL_MAP_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_LOCAL_MAP_REPO_ROOT="$(cd "${_LOCAL_MAP_SCRIPT_DIR}/../../../.." && pwd)"
LOCAL_MAP_ROOT_ENV_FILE="${_LOCAL_MAP_REPO_ROOT}/.env"
LOCAL_MAP_API_ENV_FILE="${_LOCAL_MAP_REPO_ROOT}/apps/api/.env"

# Log postgresql-style DATABASE_URL host:port only (never password or full URL).
local_map_log_database_url_host() {
  local d="${DATABASE_URL:-}"
  if [[ -z "$d" ]]; then
    return 1
  fi
  if [[ "$d" =~ @([^@/?]+)(/|\?|$) ]]; then
    echo "[env] using DATABASE_URL host: ${BASH_REMATCH[1]}" >&2
    return 0
  fi
  echo "[env] DATABASE_URL is set (could not parse host for log)" >&2
  return 0
}

# Log LOCAL_TILE_DATABASE_URL host:port (preferred for Windows PMTiles export/build).
local_map_log_local_tile_database_url_host() {
  local d="${LOCAL_TILE_DATABASE_URL:-}"
  if [[ -z "$d" ]]; then
    return 1
  fi
  if [[ "$d" =~ @([^@/?]+)(/|\?|$) ]]; then
    echo "[env] using LOCAL_TILE_DATABASE_URL host: ${BASH_REMATCH[1]}" >&2
    return 0
  fi
  echo "[env] LOCAL_TILE_DATABASE_URL is set (could not parse host for log)" >&2
  return 0
}

# Strip Prisma/pgbouncer-only query params that libpq / GDAL reject.
local_map_clean_pg_url() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse
u = urlparse(sys.argv[1])
drop = {"pgbouncer", "connection_limit", "pool_timeout", "schema"}
qs = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if k.lower() not in drop]
print(urlunparse((u.scheme, u.netloc, u.path, u.params, urlencode(qs), u.fragment)))
PY
}

# Accept common aliases for LOCAL_TILE_DATABASE_URL.
local_map_normalize_tile_database_url() {
  if [[ -z "${LOCAL_TILE_DATABASE_URL:-}" && -n "${LOCAL_TILES_DATABASE_URL:-}" ]]; then
    export LOCAL_TILE_DATABASE_URL="$LOCAL_TILES_DATABASE_URL"
    echo "[env] LOCAL_TILE_DATABASE_URL set from LOCAL_TILES_DATABASE_URL" >&2
  fi
  if [[ -z "${LOCAL_TILE_DATABASE_URL:-}" && -n "${COREMAP_TILES_DATABASE_URL:-}" ]]; then
    export LOCAL_TILE_DATABASE_URL="$COREMAP_TILES_DATABASE_URL"
    echo "[env] LOCAL_TILE_DATABASE_URL set from COREMAP_TILES_DATABASE_URL" >&2
  fi
  if [[ -z "${SUPABASE_DATABASE_URL:-}" && -n "${DATABASE_URL:-}" ]]; then
    if [[ "${DATABASE_URL}" == *supabase* || "${DATABASE_URL}" == *pooler.supabase* ]]; then
      export SUPABASE_DATABASE_URL="$DATABASE_URL"
      echo "[env] SUPABASE_DATABASE_URL set from DATABASE_URL" >&2
    fi
  fi
}

local_map_load_env_file() {
  local env_file="$1"
  local label="$2"

  if [[ ! -f "$env_file" ]]; then
    return 0
  fi

  echo "[env] loaded ${label}" >&2

  local line key val existing
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    line="${line#"${line%%[![:space:]]*}"}"
    if [[ "$line" == export[[:space:]]* ]]; then
      line="${line#export}"
      line="${line#"${line%%[![:space:]]*}"}"
    fi
    [[ "$line" != *=* ]] && continue

    key="${line%%=*}"
    val="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    key="${key#"${key%%[![:space:]]*}"}"
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      continue
    fi

    val="${val%"${val##*[![:space:]]}"}"
    val="${val#"${val%%[![:space:]]*}"}"
    if [[ ${#val} -ge 2 && "$val" == \"*\" ]]; then
      val="${val#\"}"
      val="${val%\"}"
    elif [[ ${#val} -ge 2 && "$val" == \'*\' ]]; then
      val="${val#\'}"
      val="${val%\'}"
    fi

    existing="$(printenv "$key" 2>/dev/null || true)"
    if [[ -n "$existing" ]]; then
      continue
    fi

    export "${key}=${val}"
  done <"$env_file"
}

local_map_load_root_env_file() {
  if [[ ! -f "$LOCAL_MAP_ROOT_ENV_FILE" && ! -f "$LOCAL_MAP_API_ENV_FILE" ]]; then
    echo "[env] no root .env or apps/api/.env (set variables in the shell or CI)" >&2
    local_map_normalize_tile_database_url
    return 0
  fi

  local_map_load_env_file "$LOCAL_MAP_ROOT_ENV_FILE" "root .env"
  # apps/api/.env fills missing keys only (shell / root .env win).
  local_map_load_env_file "$LOCAL_MAP_API_ENV_FILE" "apps/api/.env"
  local_map_normalize_tile_database_url

  if [[ -n "${LOCAL_TILE_DATABASE_URL:-}" ]]; then
    echo "[env] LOCAL_TILE_DATABASE_URL ready" >&2
  elif [[ -n "${DATABASE_URL:-}" ]]; then
    echo "[env] DATABASE_URL loaded (export prefers LOCAL_TILE_DATABASE_URL)" >&2
  fi
}

local_map_load_root_env_file
