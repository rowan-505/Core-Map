const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function databaseUrlHost(databaseUrl: string | undefined): string | null {
    if (!databaseUrl?.trim()) {
        return null;
    }
    try {
        return new URL(databaseUrl.trim()).hostname;
    } catch {
        return null;
    }
}

export function isLocalDatabaseHost(host: string | null): boolean {
    return host !== null && LOCAL_HOSTS.has(host);
}

/**
 * Snapshot generation is read-only but must not run against production by accident.
 * Pass allowRemote=true only from an explicit operator command.
 */
export function assertSnapshotGeneratorDatabaseUrl(
    databaseUrl: string | undefined,
    allowRemote: boolean
): void {
    const host = databaseUrlHost(databaseUrl);
    if (!host) {
        throw new Error("DATABASE_URL is missing or invalid.");
    }
    if (isLocalDatabaseHost(host) || allowRemote) {
        return;
    }
    throw new Error(
        `Refusing snapshot generation against host "${host}". Use a local database or pass --allow-remote-database.`
    );
}
