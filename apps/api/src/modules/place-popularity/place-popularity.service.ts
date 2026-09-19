import type { PrismaClient } from "@prisma/client";

import {
    scoresFromActivityCounts,
    type PlacePopularityScore,
} from "./place-popularity.scoring.js";
import {
    PlacePopularityRepository,
    type PlaceActivityKind,
} from "./place-popularity.repo.js";
import type { PlacePopularityContextKind } from "./place-popularity.weights.js";

export type PlacePopularityContextResult = {
    readonly context: PlacePopularityContextKind;
    readonly townshipAdminAreaId: string | null;
    readonly regionAdminAreaId: string | null;
    readonly windowDays: 30;
    readonly items: PlacePopularityScore[];
};

/**
 * Records daily place activity and computes contextual popularity scores.
 * Never writes a global popularity score into core.core_places.
 */
export class PlacePopularityService {
    constructor(private readonly repo: PlacePopularityRepository) {}

    static create(prisma: PrismaClient): PlacePopularityService {
        return new PlacePopularityService(new PlacePopularityRepository(prisma));
    }

    /** Best-effort activity bump; never throws to callers. */
    recordActivitySafe(placeId: bigint, kind: PlaceActivityKind): void {
        void this.repo.incrementActivity(placeId, kind).catch(() => undefined);
    }

    async recordActivityByPublicIdSafe(
        placePublicId: string,
        kind: PlaceActivityKind
    ): Promise<void> {
        try {
            const placeId = await this.repo.findPlaceIdByPublicId(placePublicId);
            if (placeId === null) return;
            await this.repo.incrementActivity(placeId, kind);
        } catch {
            // Activity telemetry must not break primary request paths.
        }
    }

    async resolveTownshipAdminAreaIdForPlace(placeId: bigint): Promise<bigint | null> {
        return this.repo.resolveTownshipAdminAreaIdForPlace(placeId);
    }

    async resolveRegionAdminAreaIdForPlace(placeId: bigint): Promise<bigint | null> {
        return this.repo.resolveRegionAdminAreaIdForPlace(placeId);
    }

    async computeContextScores(input: {
        kind: PlacePopularityContextKind;
        placeId?: bigint;
        townshipAdminAreaId?: bigint | null;
        regionAdminAreaId?: bigint | null;
    }): Promise<PlacePopularityContextResult> {
        let townshipAdminAreaId = input.townshipAdminAreaId ?? null;
        let regionAdminAreaId = input.regionAdminAreaId ?? null;

        if (input.placeId != null) {
            if (
                (input.kind === "tourism_township" || input.kind === "food_drink_township") &&
                townshipAdminAreaId == null
            ) {
                townshipAdminAreaId = await this.repo.resolveTownshipAdminAreaIdForPlace(
                    input.placeId
                );
            }
            if (input.kind === "tourism_region" && regionAdminAreaId == null) {
                regionAdminAreaId = await this.repo.resolveRegionAdminAreaIdForPlace(
                    input.placeId
                );
            }
        }

        const rows = await this.repo.listActivity30dForContext({
            kind: input.kind,
            townshipAdminAreaId,
            regionAdminAreaId,
        });

        const items = scoresFromActivityCounts(
            rows.map((row) => ({
                placeId: row.placeId,
                counts: this.repo.toCounts(row),
            }))
        );

        return {
            context: input.kind,
            townshipAdminAreaId:
                townshipAdminAreaId === null ? null : String(townshipAdminAreaId),
            regionAdminAreaId: regionAdminAreaId === null ? null : String(regionAdminAreaId),
            windowDays: 30,
            items,
        };
    }
}
