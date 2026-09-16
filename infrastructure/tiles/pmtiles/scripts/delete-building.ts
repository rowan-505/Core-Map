import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

import {
  DeleteBuildingError,
  parseDeleteBuildingFeatureKey,
  runDeleteBuilding,
} from "./delete-building.lib.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
dotenv.config({ path: resolve(repoRoot, ".env") });
dotenv.config({ path: resolve(repoRoot, "apps/api/.env") });

function cleanPgUrl(raw: string): string {
  const u = new URL(raw);
  for (const key of ["pgbouncer", "connection_limit", "pool_timeout", "schema"]) {
    u.searchParams.delete(key);
  }
  return u.toString();
}

function apiBaseUrl(): string {
  return (
    process.env.COREMAP_API_BASE_URL?.trim() ||
    process.env.VITE_API_BASE_URL?.trim() ||
    "http://localhost:3001"
  ).replace(/\/$/, "");
}

async function loginAccessToken(): Promise<string | null> {
  const preset = process.env.COREMAP_ACCESS_TOKEN?.trim();
  if (preset) {
    return preset;
  }
  if (process.env.AUTH_BYPASS === "true" && process.env.NODE_ENV !== "production") {
    return null;
  }
  const email = process.env.COREMAP_ADMIN_EMAIL?.trim();
  const password = process.env.COREMAP_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new DeleteBuildingError(
      "config",
      "Set COREMAP_ACCESS_TOKEN or COREMAP_ADMIN_EMAIL + COREMAP_ADMIN_PASSWORD to call the Fastify admin API.",
      1
    );
  }
  const response = await fetch(`${apiBaseUrl()}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json().catch(() => null)) as { accessToken?: string; message?: string } | null;
  if (!response.ok || !body?.accessToken) {
    throw new DeleteBuildingError(
      "api_failure",
      `Admin login failed HTTP ${response.status}${body?.message ? `: ${body.message}` : ""}`,
      2
    );
  }
  return body.accessToken;
}

async function adminPost(path: string, payload: unknown): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const token = await loginAccessToken();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: response.status, body };
}

async function writeSuppression(featureKey: string): Promise<{ created: boolean; core_removed: boolean }> {
  const { status, body } = await adminPost("/buildings/delete-from-source", {
    feature_key: featureKey,
    confirm: "DELETE",
  });
  if (status === 409) {
    const dependencies = Array.isArray(body?.dependencies) ? JSON.stringify(body.dependencies) : "";
    throw new DeleteBuildingError(
      "blocked",
      `${String(body?.message ?? "Delete blocked.")}${dependencies ? `\n${dependencies}` : ""}`,
      1
    );
  }
  if (status !== 200 || !body?.suppressed) {
    throw new DeleteBuildingError(
      "api_failure",
      `Delete failed HTTP ${status}${body?.message ? `: ${String(body.message)}` : ""}`,
      2
    );
  }
  return {
    created: body.created !== false,
    core_removed: body.core_removed === true,
  };
}

function sync(): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn("npm", ["run", "tiles:sync", "--", "buildings_suppressed", "buildings_core"], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", (error) => {
      resolvePromise({ ok: false, detail: error.message });
    });
    child.on("close", (code) => {
      resolvePromise({
        ok: code === 0,
        detail: code === 0 ? "ok" : out.trim().slice(-500) || `exit ${code}`,
      });
    });
  });
}

async function verifyAbsent(
  client: pg.Client,
  featureKey: string
): Promise<{ present: boolean; suppressed: boolean }> {
  const resolved = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM tile_source.buildings_v WHERE feature_key = $1`,
    [featureKey]
  );
  const suppressed = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM tile_source.buildings_suppressed WHERE feature_key = $1`,
    [featureKey]
  );
  return {
    present: Number(resolved.rows[0]?.n ?? 0) > 0,
    suppressed: Number(suppressed.rows[0]?.n ?? 0) > 0,
  };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const rawKey = argv.find((arg) => !arg.startsWith("-"));
  parseDeleteBuildingFeatureKey(rawKey);

  const localUrl = process.env.LOCAL_TILE_DATABASE_URL || process.env.COREMAP_TILES_DATABASE_URL;
  if (!localUrl) {
    throw new DeleteBuildingError("config", "LOCAL_TILE_DATABASE_URL is required.", 1);
  }

  const client = new pg.Client({ connectionString: cleanPgUrl(localUrl) });
  await client.connect();
  try {
    const result = await runDeleteBuilding(
      {
        writeSuppression,
        sync,
        verifyAbsent: (featureKey) => verifyAbsent(client, featureKey),
      },
      rawKey,
      argv
    );
    console.log(result.output);
    return result.exitCode;
  } finally {
    await client.end();
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    if (error instanceof DeleteBuildingError) {
      console.error(`${error.code}: ${error.message}`);
      process.exit(error.exitCode);
    }
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
