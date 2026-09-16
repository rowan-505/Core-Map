import { canonicalYbsVariantIdentity } from "../transport/ybs-direction.js";
import {
    SurveyCompletionsRepository,
    type SurveyCompletionRow,
} from "./survey-completions.repo.js";
import type { SurveyCompletionPutBody } from "./survey-completions.schema.js";

export class SurveyCompletionsError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code: string
    ) {
        super(message);
        this.name = "SurveyCompletionsError";
    }
}

export type SurveyCompletionResponse = {
    routeVariantPublicId: string;
    route: { publicId: string; code: string };
    variantCode: "D0" | "D1";
    finished: boolean;
    finishedAt: string | null;
    updatedAt: string;
};

export class SurveyCompletionsService {
    constructor(private readonly repo: SurveyCompletionsRepository) {}

    async list(jwtSub: string): Promise<{ items: SurveyCompletionResponse[] }> {
        const createdBy = await this.requireUserId(jwtSub);
        const rows = await this.repo.listOwned(createdBy);
        return { items: rows.map(toResponse) };
    }

    async put(
        jwtSub: string,
        routeVariantPublicId: string,
        body: SurveyCompletionPutBody
    ): Promise<SurveyCompletionResponse> {
        const createdBy = await this.requireUserId(jwtSub);
        const variantId = await this.repo.findActiveFieldVariantId(routeVariantPublicId);
        if (variantId === null) {
            throw new SurveyCompletionsError("Route variant is not active", 400, "INVALID_ROUTE_VARIANT");
        }
        const row = await this.repo.upsertOwned({
            createdBy,
            routeVariantId: variantId,
            finished: body.finished,
            at: new Date(),
        });
        return toResponse(row);
    }

    private async requireUserId(jwtSub: string): Promise<bigint> {
        const userId = await this.repo.findActiveUserIdByPublicId(jwtSub);
        if (userId === null) {
            throw new SurveyCompletionsError("User not found", 401, "UNAUTHORIZED");
        }
        return userId;
    }
}

function toResponse(row: SurveyCompletionRow): SurveyCompletionResponse {
    const identity = canonicalYbsVariantIdentity(row.route_code, row.direction_id);
    if (!identity) {
        throw new SurveyCompletionsError("Survey completion route is invalid", 500, "INVALID_ROUTE");
    }
    return {
        routeVariantPublicId: row.route_variant_public_id,
        route: { publicId: row.route_public_id, code: row.route_code },
        variantCode: identity.directionName,
        finished: row.is_finished,
        finishedAt: row.finished_at?.toISOString() ?? null,
        updatedAt: row.updated_at.toISOString(),
    };
}
