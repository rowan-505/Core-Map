import { Prisma, type PrismaClient } from "@prisma/client";

import {
    TourismReviewsRepository,
    TOURISM_REVIEW_AUDIT_ENTITY_TYPE,
} from "../tourism/tourism.repo.js";

export const PLACE_REVIEW_AUDIT_ENTITY_TYPE = TOURISM_REVIEW_AUDIT_ENTITY_TYPE;

/** Community-backed repository for universal place reviews. */
export class PlaceReviewsRepository extends TourismReviewsRepository {
    constructor(prisma: PrismaClient) {
        super(prisma);
    }

    override async findUsableUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM app_auth.auth_users
            WHERE public_id::text = ${publicId}
              AND deleted_at IS NULL
              AND is_active = true
              AND account_status = 'active'
              AND email_verified = true
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }
}

export type {
    AuditContext,
    TourismModerationEventRow as PlaceReviewModerationEventRow,
    TourismRatingSummaryRow as PlaceRatingSummaryRow,
    TourismReviewRow as PlaceReviewRow,
} from "../tourism/tourism.repo.js";
