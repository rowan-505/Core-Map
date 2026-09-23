import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
    prisma?: PrismaClient;
    prismaShutdownHooksRegistered?: boolean;
};

/**
 * Single PrismaClient per Node process. Always attached to `globalThis` so dev HMR / tooling
 * and production builds cannot accidentally create multiple pools to the same database.
 */
export const prisma: PrismaClient = getOrCreatePrismaClient();

registerPrismaShutdownHooks();

function getOrCreatePrismaClient(): PrismaClient {
    if (globalForPrisma.prisma) {
        return globalForPrisma.prisma;
    }

    const client = createPrismaClient();
    globalForPrisma.prisma = client;
    return client;
}

function createPrismaClient() {
    const databaseUrl = applyPrismaDatabaseUrl(process.env.DATABASE_URL);
    const options = databaseUrl
        ? {
              datasources: {
                  db: {
                      url: databaseUrl,
                  },
              },
          }
        : undefined;

    return new PrismaClient(options);
}

const DEFAULT_PRISMA_CONNECT_TIMEOUT_SECONDS = "20";

/**
 * Effective Prisma `connection_limit` when the URL does not already set one.
 * Default is `"8"` for map/API concurrency (reverse layers capped at 2).
 * Override with `PRISMA_CONNECTION_LIMIT` for tight poolers (e.g. `3`).
 * See apps/api/.env.example.
 */
export function resolvePrismaConnectionLimitValue(): string {
    const fromEnv = process.env.PRISMA_CONNECTION_LIMIT?.trim();
    return fromEnv && fromEnv.length > 0 ? fromEnv : "8";
}

export function resolvePrismaConnectTimeoutValue(): string {
    const fromEnv = process.env.PRISMA_CONNECT_TIMEOUT?.trim();
    return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_PRISMA_CONNECT_TIMEOUT_SECONDS;
}

/**
 * Normalize the Prisma datasource URL: keep an existing `connection_limit` /
 * `connect_timeout`, otherwise apply safe defaults. High-latency Supabase
 * poolers often exceed Prisma’s 5s default and surface as auth 500s.
 */
export function applyPrismaDatabaseUrl(databaseUrl: string | undefined): string | undefined {
    const limited = applyPrismaConnectionLimit(databaseUrl);
    return applyPrismaConnectTimeout(limited);
}

/**
 * When the URL has no `connection_limit`, append one so Supabase / poolers with a small
 * `pool_size` are not exhausted by Prisma's default pool (especially in production).
 *
 * Override with `PRISMA_CONNECTION_LIMIT` (e.g. `3` for tight session poolers;
 * default `8` for normal API/map traffic). Safe to reuse for secondary Prisma clients.
 */
export function applyPrismaConnectionLimit(databaseUrl: string | undefined): string | undefined {
    if (!databaseUrl) {
        return undefined;
    }

    const trimmed = databaseUrl.trim();
    if (!trimmed) {
        return undefined;
    }

    if (hasConnectionLimit(trimmed)) {
        return trimmed;
    }

    return appendConnectionLimit(trimmed, resolvePrismaConnectionLimitValue());
}

/**
 * Effective numeric connection limit for startup diagnostics.
 * Prefer an explicit `connection_limit` on the URL; otherwise use env/default.
 * Never returns or logs the database URL itself.
 */
export function resolveEffectivePrismaConnectionLimit(
    databaseUrl: string | undefined = process.env.DATABASE_URL,
): string {
    if (databaseUrl?.trim()) {
        try {
            const fromUrl = new URL(databaseUrl.trim()).searchParams.get("connection_limit");
            if (fromUrl && fromUrl.trim().length > 0) {
                return fromUrl.trim();
            }
        } catch {
            // fall through to env/default
        }
    }
    return resolvePrismaConnectionLimitValue();
}

function hasConnectionLimit(databaseUrl: string) {
    try {
        return new URL(databaseUrl).searchParams.has("connection_limit");
    } catch {
        return false;
    }
}

function appendConnectionLimit(databaseUrl: string, connectionLimit: string) {
    try {
        const url = new URL(databaseUrl);
        url.searchParams.set("connection_limit", connectionLimit);
        return url.toString();
    } catch {
        return databaseUrl;
    }
}

function applyPrismaConnectTimeout(databaseUrl: string | undefined): string | undefined {
    if (!databaseUrl) {
        return undefined;
    }

    try {
        const url = new URL(databaseUrl);
        if (!url.searchParams.has("connect_timeout")) {
            url.searchParams.set("connect_timeout", resolvePrismaConnectTimeoutValue());
        }
        return url.toString();
    } catch {
        return databaseUrl;
    }
}

function registerPrismaShutdownHooks() {
    if (globalForPrisma.prismaShutdownHooksRegistered) {
        return;
    }

    globalForPrisma.prismaShutdownHooksRegistered = true;

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.once(signal, async () => {
            await prisma.$disconnect();
            process.kill(process.pid, signal);
        });
    }
}
