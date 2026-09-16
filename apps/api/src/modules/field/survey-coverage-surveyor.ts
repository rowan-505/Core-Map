import { Prisma, type PrismaClient } from "@prisma/client";

export type ResolvedCoverageSurveyor = {
    userId: bigint;
    publicId: string;
    displayName: string;
    email: string;
};

export class SurveyCoverageSurveyorError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code: string,
        public readonly details?: Record<string, unknown>
    ) {
        super(message);
        this.name = "SurveyCoverageSurveyorError";
    }
}

export class SurveyCoverageSurveyorRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async findActiveSurveyorByPublicId(publicId: string): Promise<ResolvedCoverageSurveyor | null> {
        const rows = await this.prisma.$queryRaw<
            {
                id: bigint;
                public_id: string;
                display_name: string;
                email: string;
            }[]
        >(Prisma.sql`
            SELECT u.id, u.public_id::text AS public_id, u.display_name, u.email
            FROM app_auth.auth_users u
            JOIN app_auth.auth_user_roles ur ON ur.user_id = u.id
            JOIN app_auth.auth_roles r ON r.id = ur.role_id
            WHERE u.public_id = ${publicId}::uuid
              AND u.is_active = true
              AND u.account_status = 'active'
              AND u.deleted_at IS NULL
              AND r.code = 'surveyor'
            LIMIT 1
        `);
        const row = rows[0];
        if (!row) return null;
        return {
            userId: row.id,
            publicId: row.public_id,
            displayName: row.display_name,
            email: row.email,
        };
    }

    async listActiveSurveyors(): Promise<ResolvedCoverageSurveyor[]> {
        const rows = await this.prisma.$queryRaw<
            {
                id: bigint;
                public_id: string;
                display_name: string;
                email: string;
            }[]
        >(Prisma.sql`
            SELECT u.id, u.public_id::text AS public_id, u.display_name, u.email
            FROM app_auth.auth_users u
            JOIN app_auth.auth_user_roles ur ON ur.user_id = u.id
            JOIN app_auth.auth_roles r ON r.id = ur.role_id
            WHERE u.is_active = true
              AND u.account_status = 'active'
              AND u.deleted_at IS NULL
              AND r.code = 'surveyor'
            ORDER BY u.display_name ASC, u.email ASC, u.id ASC
        `);
        return rows.map((row) => ({
            userId: row.id,
            publicId: row.public_id,
            displayName: row.display_name,
            email: row.email,
        }));
    }
}

/**
 * Resolve the coverage/history surveyor:
 * 1) explicit surveyorPublicId if provided
 * 2) exactly one active surveyor
 * 3) otherwise SURVEYOR_SELECTION_REQUIRED
 */
export async function resolveCoverageSurveyor(
    repo: SurveyCoverageSurveyorRepository,
    surveyorPublicId?: string
): Promise<ResolvedCoverageSurveyor> {
    if (surveyorPublicId) {
        const found = await repo.findActiveSurveyorByPublicId(surveyorPublicId);
        if (!found) {
            throw new SurveyCoverageSurveyorError("Surveyor not found", 404, "SURVEYOR_NOT_FOUND");
        }
        return found;
    }

    const all = await repo.listActiveSurveyors();
    if (all.length === 1) {
        return all[0]!;
    }
    throw new SurveyCoverageSurveyorError(
        all.length === 0
            ? "No active surveyor is available"
            : "Multiple active surveyors exist; pass surveyorPublicId",
        400,
        "SURVEYOR_SELECTION_REQUIRED",
        { activeSurveyorCount: all.length }
    );
}
