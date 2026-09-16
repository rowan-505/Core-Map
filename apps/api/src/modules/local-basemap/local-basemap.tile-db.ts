import pg from "pg";

function cleanPgUrl(raw: string): string {
    const u = new URL(raw);
    for (const key of ["pgbouncer", "connection_limit", "pool_timeout", "schema"]) {
        u.searchParams.delete(key);
    }
    return u.toString();
}

function tileDbUrl(env: NodeJS.ProcessEnv = process.env): string {
    const raw = (env.LOCAL_TILE_DATABASE_URL || env.COREMAP_TILES_DATABASE_URL || "").trim();
    if (!raw) {
        throw new Error("LOCAL_TILE_DATABASE_URL is not configured.");
    }
    return cleanPgUrl(raw);
}

/** MVT tile queries only — capped so a tile storm cannot exhaust the local DB. */
let mvtPool: pg.Pool | null = null;
/** Feature detail / search / promote — never shares connections with MVT. */
let adminPool: pg.Pool | null = null;

export function getLocalTilePool(env: NodeJS.ProcessEnv = process.env): pg.Pool {
    if (mvtPool) {
        return mvtPool;
    }
    mvtPool = new pg.Pool({
        connectionString: tileDbUrl(env),
        max: 3,
        idleTimeoutMillis: 30_000,
        // Cap every MVT statement even if a route forgets SET LOCAL.
        options: "-c statement_timeout=3000",
    });
    return mvtPool;
}

export function getLocalTileAdminPool(env: NodeJS.ProcessEnv = process.env): pg.Pool {
    if (adminPool) {
        return adminPool;
    }
    adminPool = new pg.Pool({
        connectionString: tileDbUrl(env),
        max: 3,
        idleTimeoutMillis: 30_000,
        options: "-c statement_timeout=10000",
    });
    return adminPool;
}

export async function closeLocalTilePool(): Promise<void> {
    const closing: Promise<void>[] = [];
    if (mvtPool) {
        closing.push(mvtPool.end());
        mvtPool = null;
    }
    if (adminPool) {
        closing.push(adminPool.end());
        adminPool = null;
    }
    await Promise.all(closing);
}
