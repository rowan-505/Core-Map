import type { PrismaClient } from "@prisma/client";

import {
    PlacePopularityRepository,
    type PlaceActivityKind,
} from "./place-popularity.repo.js";

/** Fire-and-forget daily activity bump. Never throws. */
export function recordPlaceActivitySafe(
    prisma: PrismaClient,
    placeId: bigint,
    kind: PlaceActivityKind
): void {
    void new PlacePopularityRepository(prisma)
        .incrementActivity(placeId, kind)
        .catch(() => undefined);
}

export function recordPlaceActivityByPublicIdSafe(
    prisma: PrismaClient,
    placePublicId: string,
    kind: PlaceActivityKind
): void {
    void PlacePopularityServiceRecord(prisma, placePublicId, kind);
}

async function PlacePopularityServiceRecord(
    prisma: PrismaClient,
    placePublicId: string,
    kind: PlaceActivityKind
): Promise<void> {
    try {
        const repo = new PlacePopularityRepository(prisma);
        const placeId = await repo.findPlaceIdByPublicId(placePublicId);
        if (placeId === null) return;
        await repo.incrementActivity(placeId, kind);
    } catch {
        // ignore
    }
}
