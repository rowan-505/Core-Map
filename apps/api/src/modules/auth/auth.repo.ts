import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

export type AuthUserRecord = {
    id: string;
    public_id: string;
    email: string;
    display_name: string;
    password_hash: string | null;
    is_active: boolean;
    account_status: string;
    email_verified: boolean;
    roles: string[];
};

export type AuthUserProfile = {
    public_id: string;
    email: string;
    display_name: string;
    phone: string | null;
    email_verified: boolean;
    account_status: string;
    primary_region_id: string | null;
    preferred_language: string;
    roles: string[];
    total_points: number;
};

export type UpdatableProfileFields = {
    displayName?: string;
    phone?: string | null;
    preferredLanguage?: "my" | "en";
    primaryRegionId?: bigint | null;
};

export type ActiveSession = {
    id: bigint;
    public_id: string;
    token_family_id: string;
    user: AuthUserRecord;
};

export type EmailVerificationUser = {
    id: bigint;
    email: string;
    email_verified: boolean;
    is_active: boolean;
    account_status: string;
    roles: string[];
};

export type EmailOtpRecord = {
    id: bigint;
    otp_hash: string;
    attempts_count: number;
    max_attempts: number;
    expires_at: Date;
    consumed_at: Date | null;
    created_at: Date;
};

const userWithRolesInclude = {
    userRoles: {
        include: {
            role: true,
        },
    },
} satisfies Prisma.AuthUserInclude;

type AuthUserWithRoles = Prisma.AuthUserGetPayload<{
    include: typeof userWithRolesInclude;
}>;

export class AuthRoleNotFoundError extends Error {
    constructor(roleCode: string) {
        super(`Role "${roleCode}" not found`);
        this.name = "AuthRoleNotFoundError";
    }
}

export class AuthRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
        const user = await this.prisma.authUser.findUnique({
            where: { email },
            include: userWithRolesInclude,
        });
        return user ? mapAuthUserRecord(user) : null;
    }

    async findProfileByPublicId(publicId: string): Promise<AuthUserProfile | null> {
        const user = await this.prisma.authUser.findUnique({
            where: { publicId },
            include: userWithRolesInclude,
        });
        if (!user) return null;
        const totalPoints = await this.getTotalPoints(user.id);
        return mapAuthUserProfile(user, totalPoints);
    }

    async findUserByPublicId(publicId: string): Promise<AuthUserRecord | null> {
        const user = await this.prisma.authUser.findUnique({
            where: { publicId },
            include: userWithRolesInclude,
        });
        return user ? mapAuthUserRecord(user) : null;
    }

    async touchLastLogin(userId: bigint): Promise<void> {
        const now = new Date();
        await this.prisma.authUser.update({
            where: { id: userId },
            data: { lastLoginAt: now, lastSeenAt: now },
        });
    }

    async updatePasswordHash(userId: bigint, passwordHash: string): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            const user = await tx.authUser.update({
                where: { id: userId },
                data: { passwordHash },
            });
            const existing = await tx.authIdentity.findFirst({
                where: { userId, provider: "password" },
            });
            if (!existing) {
                await tx.authIdentity.create({
                    data: {
                        userId,
                        provider: "password",
                        providerSubject: user.publicId,
                        providerEmail: user.email,
                        providerEmailVerified: user.emailVerified,
                    },
                });
            }
        });
    }

    async getTotalPoints(userId: bigint): Promise<number> {
        const summary = await this.prisma.userPointSummary.findUnique({
            where: { userId },
        });
        return summary?.totalPoints ?? 0;
    }

    async createPublicUser(input: {
        email: string;
        displayName: string;
        passwordHash: string | null;
        preferredLanguage?: "my" | "en";
        primaryRegionId?: bigint | null;
        emailVerified?: boolean;
    }): Promise<AuthUserProfile> {
        const user = await this.prisma.$transaction(async (tx) => {
            const role = await tx.authRole.findUnique({ where: { code: "user" } });
            if (!role) throw new AuthRoleNotFoundError("user");
            const createdUser = await tx.authUser.create({
                data: {
                    email: input.email,
                    displayName: input.displayName,
                    passwordHash: input.passwordHash,
                    isActive: true,
                    emailVerified: input.emailVerified ?? false,
                    ...(input.preferredLanguage ? { preferredLanguage: input.preferredLanguage } : {}),
                    ...(input.primaryRegionId != null ? { primaryRegionId: input.primaryRegionId } : {}),
                },
            });
            await tx.authUserRole.create({
                data: { userId: createdUser.id, roleId: role.id },
            });
            if (input.passwordHash) {
                await tx.authIdentity.create({
                    data: {
                        userId: createdUser.id,
                        provider: "password",
                        providerSubject: createdUser.publicId,
                        providerEmail: createdUser.email,
                        providerEmailVerified: input.emailVerified ?? false,
                    },
                });
            }
            return tx.authUser.findUniqueOrThrow({
                where: { id: createdUser.id },
                include: userWithRolesInclude,
            });
        });
        return mapAuthUserProfile(user, 0);
    }

    async adminAreaExists(adminAreaId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id FROM core.core_admin_areas WHERE id = ${adminAreaId} LIMIT 1
        `);
        return rows.length > 0;
    }

    async updateProfile(userId: bigint, fields: UpdatableProfileFields): Promise<void> {
        const data: Prisma.AuthUserUpdateInput = { updatedAt: new Date() };
        if (fields.displayName !== undefined) data.displayName = fields.displayName;
        if (fields.phone !== undefined) data.phone = fields.phone;
        if (fields.preferredLanguage !== undefined) data.preferredLanguage = fields.preferredLanguage;
        if (fields.primaryRegionId !== undefined) data.primaryRegionId = fields.primaryRegionId;
        await this.prisma.authUser.update({ where: { id: userId }, data });
    }

    async createSession(input: {
        userId: bigint;
        refreshTokenHash: string;
        expiresAt: Date;
        idleExpiresAt: Date;
        absoluteExpiresAt: Date;
        tokenFamilyId?: string;
        userAgent?: string | null;
        ipAddress?: string | null;
        clientType?: string;
    }): Promise<{ id: bigint; public_id: string; token_family_id: string; client_type: string }> {
        const session = await this.prisma.authSession.create({
            data: {
                userId: input.userId,
                refreshTokenHash: input.refreshTokenHash,
                expiresAt: input.expiresAt,
                idleExpiresAt: input.idleExpiresAt,
                absoluteExpiresAt: input.absoluteExpiresAt,
                ...(input.tokenFamilyId ? { tokenFamilyId: input.tokenFamilyId } : {}),
                userAgent: input.userAgent ?? null,
                ipAddress: input.ipAddress ?? null,
                clientType: input.clientType ?? "web",
                lastUsedAt: new Date(),
            },
        });
        return {
            id: session.id,
            public_id: session.publicId,
            token_family_id: session.tokenFamilyId,
            client_type: session.clientType,
        };
    }

    async findActiveSessionByTokenHash(refreshTokenHash: string): Promise<ActiveSession | null> {
        const now = new Date();
        const session = await this.prisma.authSession.findFirst({
            where: {
                refreshTokenHash,
                revokedAt: null,
                AND: [
                    { OR: [{ idleExpiresAt: null }, { idleExpiresAt: { gt: now } }] },
                    { OR: [{ absoluteExpiresAt: null }, { absoluteExpiresAt: { gt: now } }] },
                    { expiresAt: { gt: now } },
                ],
            },
            include: { user: { include: userWithRolesInclude } },
        });
        if (!session) return null;
        return {
            id: session.id,
            public_id: session.publicId,
            token_family_id: session.tokenFamilyId,
            user: mapAuthUserRecord(session.user),
        };
    }

    async findActiveSessionByPublicId(publicId: string): Promise<ActiveSession | null> {
        const now = new Date();
        const session = await this.prisma.authSession.findFirst({
            where: {
                publicId,
                revokedAt: null,
                AND: [
                    { OR: [{ idleExpiresAt: null }, { idleExpiresAt: { gt: now } }] },
                    { OR: [{ absoluteExpiresAt: null }, { absoluteExpiresAt: { gt: now } }] },
                    { expiresAt: { gt: now } },
                ],
            },
            include: { user: { include: userWithRolesInclude } },
        });
        if (!session) return null;
        return {
            id: session.id,
            public_id: session.publicId,
            token_family_id: session.tokenFamilyId,
            user: mapAuthUserRecord(session.user),
        };
    }

    async rotateSessionAtomic(input: {
        currentHash: string;
        nextHash: string;
        idleExpiresAt: Date;
        expiresAt: Date;
    }): Promise<ActiveSession | null> {
        const now = new Date();
        const rows = await this.prisma.$queryRaw<
            {
                id: bigint;
                public_id: string;
                token_family_id: string;
                user_id: bigint;
            }[]
        >(Prisma.sql`
            UPDATE app_auth.auth_sessions
            SET previous_refresh_token_hash = refresh_token_hash,
                refresh_token_hash = ${input.nextHash},
                last_used_at = ${now},
                expires_at = ${input.expiresAt},
                idle_expires_at = ${input.idleExpiresAt}
            WHERE refresh_token_hash = ${input.currentHash}
              AND revoked_at IS NULL
              AND expires_at > ${now}
              AND (idle_expires_at IS NULL OR idle_expires_at > ${now})
              AND (absolute_expires_at IS NULL OR absolute_expires_at > ${now})
            RETURNING id, public_id, token_family_id, user_id
        `);
        const row = rows[0];
        if (!row) return null;
        const user = await this.prisma.authUser.findUnique({
            where: { id: row.user_id },
            include: userWithRolesInclude,
        });
        if (!user) return null;
        return {
            id: row.id,
            public_id: row.public_id,
            token_family_id: row.token_family_id,
            user: mapAuthUserRecord(user),
        };
    }

    async findSessionByPreviousHash(hash: string): Promise<{
        id: bigint;
        token_family_id: string;
        last_used_at: Date | null;
    } | null> {
        const session = await this.prisma.authSession.findFirst({
            where: { previousRefreshTokenHash: hash },
            select: { id: true, tokenFamilyId: true, lastUsedAt: true },
        });
        return session
            ? {
                  id: session.id,
                  token_family_id: session.tokenFamilyId,
                  last_used_at: session.lastUsedAt,
              }
            : null;
    }

    async revokeFamily(tokenFamilyId: string, reason: string): Promise<number> {
        const result = await this.prisma.authSession.updateMany({
            where: { tokenFamilyId, revokedAt: null },
            data: { revokedAt: new Date(), revokeReason: reason },
        });
        return result.count;
    }

    async revokeSessionByTokenHash(refreshTokenHash: string, reason = "logout"): Promise<number> {
        const result = await this.prisma.authSession.updateMany({
            where: { refreshTokenHash, revokedAt: null },
            data: { revokedAt: new Date(), revokeReason: reason },
        });
        return result.count;
    }

    async revokeSessionByPublicId(userId: bigint, publicId: string, reason: string): Promise<number> {
        const result = await this.prisma.authSession.updateMany({
            where: { userId, publicId, revokedAt: null },
            data: { revokedAt: new Date(), revokeReason: reason },
        });
        return result.count;
    }

    async revokeAllUserSessions(userId: bigint, reason: string, exceptPublicId?: string): Promise<number> {
        const result = await this.prisma.authSession.updateMany({
            where: {
                userId,
                revokedAt: null,
                ...(exceptPublicId ? { publicId: { not: exceptPublicId } } : {}),
            },
            data: { revokedAt: new Date(), revokeReason: reason },
        });
        return result.count;
    }

    async listSessions(userId: bigint): Promise<
        {
            public_id: string;
            created_at: Date;
            last_used_at: Date | null;
            user_agent: string | null;
            client_type: string;
        }[]
    > {
        const now = new Date();
        const rows = await this.prisma.authSession.findMany({
            where: {
                userId,
                revokedAt: null,
                expiresAt: { gt: now },
                AND: [
                    { OR: [{ idleExpiresAt: null }, { idleExpiresAt: { gt: now } }] },
                    { OR: [{ absoluteExpiresAt: null }, { absoluteExpiresAt: { gt: now } }] },
                ],
            },
            orderBy: [{ lastUsedAt: "desc" }, { createdAt: "desc" }],
            take: 50,
            select: {
                publicId: true,
                createdAt: true,
                lastUsedAt: true,
                userAgent: true,
                clientType: true,
            },
        });
        return rows.map((row) => ({
            public_id: row.publicId,
            created_at: row.createdAt,
            last_used_at: row.lastUsedAt,
            user_agent: row.userAgent,
            client_type: row.clientType,
        }));
    }

    async cleanupExpiredSessions(): Promise<void> {
        const now = new Date();
        await this.prisma.authSession.updateMany({
            where: {
                revokedAt: null,
                OR: [
                    { expiresAt: { lte: now } },
                    { absoluteExpiresAt: { lte: now } },
                    { idleExpiresAt: { lte: now } },
                ],
            },
            data: { revokedAt: now, revokeReason: "expired" },
        });
    }

    async findVerificationUserByPublicId(publicId: string): Promise<EmailVerificationUser | null> {
        const user = await this.prisma.authUser.findUnique({
            where: { publicId },
            include: userWithRolesInclude,
        });
        if (!user) return null;
        return {
            id: user.id,
            email: user.email,
            email_verified: user.emailVerified,
            is_active: user.isActive,
            account_status: user.accountStatus,
            roles: mapRoles(user),
        };
    }

    async findLatestOtp(userId: bigint, email: string, purpose: string): Promise<EmailOtpRecord | null> {
        const otp = await this.prisma.emailVerificationOtp.findFirst({
            where: { userId, email, purpose },
            orderBy: { createdAt: "desc" },
        });
        return otp ? mapOtpRecord(otp) : null;
    }

    async findUserById(userId: bigint): Promise<AuthUserRecord | null> {
        const user = await this.prisma.authUser.findUnique({
            where: { id: userId },
            include: userWithRolesInclude,
        });
        return user ? mapAuthUserRecord(user) : null;
    }

    async findLatestUnconsumedOtp(
        userId: bigint,
        email: string,
        purpose: string
    ): Promise<EmailOtpRecord | null> {
        const otp = await this.prisma.emailVerificationOtp.findFirst({
            where: { userId, email, purpose, consumedAt: null },
            orderBy: { createdAt: "desc" },
        });
        return otp ? mapOtpRecord(otp) : null;
    }

    async findLatestUnconsumedOtpByPurpose(
        userId: bigint,
        purpose: string
    ): Promise<(EmailOtpRecord & { email: string }) | null> {
        const otp = await this.prisma.emailVerificationOtp.findFirst({
            where: { userId, purpose, consumedAt: null },
            orderBy: { createdAt: "desc" },
        });
        return otp ? { ...mapOtpRecord(otp), email: otp.email } : null;
    }

    async invalidateActiveOtps(userId: bigint, email: string, purpose: string): Promise<void> {
        await this.prisma.emailVerificationOtp.updateMany({
            where: { userId, email, purpose, consumedAt: null },
            data: { consumedAt: new Date() },
        });
    }

    async createEmailOtp(input: {
        userId: bigint;
        email: string;
        otpHash: string;
        purpose: string;
        maxAttempts: number;
        expiresAt: Date;
    }): Promise<{ id: bigint }> {
        const otp = await this.prisma.emailVerificationOtp.create({
            data: {
                userId: input.userId,
                email: input.email,
                otpHash: input.otpHash,
                purpose: input.purpose,
                maxAttempts: input.maxAttempts,
                expiresAt: input.expiresAt,
            },
        });
        return { id: otp.id };
    }

    async deleteOtp(otpId: bigint): Promise<void> {
        await this.prisma.emailVerificationOtp.delete({ where: { id: otpId } });
    }

    async incrementOtpAttemptsAtomic(otpId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            UPDATE app_auth.email_verification_otps
            SET attempts_count = attempts_count + 1
            WHERE id = ${otpId}
              AND consumed_at IS NULL
              AND attempts_count < max_attempts
            RETURNING id
        `);
        return rows.length > 0;
    }

    async consumeOtpAtomic(otpId: bigint): Promise<boolean> {
        const now = new Date();
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            UPDATE app_auth.email_verification_otps
            SET consumed_at = ${now}
            WHERE id = ${otpId}
              AND consumed_at IS NULL
              AND expires_at > ${now}
              AND attempts_count < max_attempts
            RETURNING id
        `);
        return rows.length > 0;
    }

    async markEmailVerified(
        userId: bigint,
        otpId: bigint,
        audit: { ipAddress?: string | null; userAgent?: string | null }
    ): Promise<boolean> {
        return this.prisma.$transaction(async (tx) => {
            const now = new Date();
            const consumed = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
                UPDATE app_auth.email_verification_otps
                SET consumed_at = ${now}
                WHERE id = ${otpId}
                  AND consumed_at IS NULL
                  AND expires_at > ${now}
                  AND attempts_count < max_attempts
                RETURNING id
            `);
            if (consumed.length === 0) return false;
            await tx.authUser.update({
                where: { id: userId },
                data: { emailVerified: true },
            });
            await tx.auditLog.create({
                data: {
                    actorUserId: userId,
                    actionType: "email_verified",
                    entityType: "auth_user",
                    entityId: userId,
                    beforeSnapshot: { email_verified: false },
                    afterSnapshot: { email_verified: true },
                    ipAddress: audit.ipAddress ?? null,
                    userAgent: audit.userAgent ?? null,
                },
            });
            return true;
        });
    }

    async recordSecurityEvent(input: {
        userId?: bigint | null;
        sessionId?: bigint | null;
        eventType: string;
        provider?: string | null;
        success: boolean;
        ipAddress?: string | null;
        userAgent?: string | null;
        metadata?: Prisma.InputJsonValue;
    }): Promise<void> {
        await this.prisma.authSecurityEvent.create({
            data: {
                userId: input.userId ?? null,
                sessionId: input.sessionId ?? null,
                eventType: input.eventType,
                provider: input.provider ?? null,
                success: input.success,
                ipAddress: input.ipAddress ?? null,
                userAgent: input.userAgent ?? null,
                metadata: input.metadata ?? Prisma.JsonNull,
            },
        });
    }

    async listSecurityEvents(userId: bigint, limit = 20) {
        return this.prisma.authSecurityEvent.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: limit,
            select: {
                eventType: true,
                success: true,
                provider: true,
                createdAt: true,
                ipAddress: true,
            },
        });
    }

    async createPasswordResetToken(input: {
        userId: bigint;
        tokenHash: string;
        expiresAt: Date;
    }): Promise<void> {
        const now = new Date();
        await this.prisma.$transaction(async (tx) => {
            await tx.passwordResetToken.updateMany({
                where: { userId: input.userId, usedAt: null },
                data: { usedAt: now },
            });
            await tx.passwordResetToken.create({
                data: input,
            });
        });
    }

    async consumePasswordResetToken(tokenHash: string): Promise<{ user_id: bigint } | null> {
        const now = new Date();
        const rows = await this.prisma.$queryRaw<{ user_id: bigint }[]>(Prisma.sql`
            UPDATE app_auth.password_reset_tokens
            SET used_at = ${now}
            WHERE token_hash = ${tokenHash}
              AND used_at IS NULL
              AND expires_at > ${now}
            RETURNING user_id
        `);
        return rows[0] ?? null;
    }

    async findIdentity(provider: string, subject: string) {
        return this.prisma.authIdentity.findUnique({
            where: { provider_providerSubject: { provider, providerSubject: subject } },
            include: { user: { include: userWithRolesInclude } },
        });
    }

    async listIdentitiesForUser(userId: bigint) {
        return this.prisma.authIdentity.findMany({
            where: { userId },
            orderBy: { createdAt: "asc" },
            select: {
                provider: true,
                providerEmail: true,
                providerEmailVerified: true,
                createdAt: true,
                lastLoginAt: true,
            },
        });
    }

    async countUsableAuthMethods(userId: bigint): Promise<{
        hasPassword: boolean;
        oauthProviders: string[];
    }> {
        const [user, identities] = await Promise.all([
            this.prisma.authUser.findUnique({
                where: { id: userId },
                select: { passwordHash: true },
            }),
            this.prisma.authIdentity.findMany({
                where: { userId, provider: { in: ["google", "facebook", "password"] } },
                select: { provider: true },
            }),
        ]);
        const providers = new Set(identities.map((row) => row.provider));
        const hasPassword =
            Boolean(user?.passwordHash && user.passwordHash.trim().length > 0) || providers.has("password");
        const oauthProviders = ["google", "facebook"].filter((provider) => providers.has(provider));
        return { hasPassword, oauthProviders };
    }

    async createIdentity(input: {
        userId: bigint;
        provider: string;
        providerSubject: string;
        providerEmail?: string | null;
        providerEmailVerified: boolean;
    }): Promise<void> {
        await this.prisma.authIdentity.create({
            data: {
                userId: input.userId,
                provider: input.provider,
                providerSubject: input.providerSubject,
                providerEmail: input.providerEmail ?? null,
                providerEmailVerified: input.providerEmailVerified,
                lastLoginAt: new Date(),
            },
        });
    }

    async deleteIdentityForUser(userId: bigint, provider: string): Promise<boolean> {
        const result = await this.prisma.authIdentity.deleteMany({
            where: { userId, provider },
        });
        return result.count > 0;
    }

    async touchIdentityLogin(id: bigint): Promise<void> {
        await this.prisma.authIdentity.update({
            where: { id },
            data: { lastLoginAt: new Date(), updatedAt: new Date() },
        });
    }

    async createOAuthState(input: {
        stateHash: string;
        codeVerifierHash?: string | null;
        nonceHash?: string | null;
        client: string;
        returnTo?: string | null;
        purpose?: "login" | "link";
        linkUserId?: bigint | null;
        linkSessionPublicId?: string | null;
        expiresAt: Date;
    }): Promise<void> {
        await this.prisma.oAuthState.create({
            data: {
                stateHash: input.stateHash,
                codeVerifierHash: input.codeVerifierHash ?? null,
                nonceHash: input.nonceHash ?? null,
                client: input.client,
                returnTo: input.returnTo ?? null,
                purpose: input.purpose ?? "login",
                linkUserId: input.linkUserId ?? null,
                linkSessionPublicId: input.linkSessionPublicId ?? null,
                expiresAt: input.expiresAt,
            },
        });
    }

    async consumeOAuthState(stateHash: string) {
        const now = new Date();
        const rows = await this.prisma.$queryRaw<
            {
                code_verifier_hash: string | null;
                nonce_hash: string | null;
                client: string;
                return_to: string | null;
                purpose: string;
                link_user_id: bigint | null;
                link_session_public_id: string | null;
            }[]
        >(Prisma.sql`
            UPDATE app_auth.oauth_states
            SET consumed_at = ${now}
            WHERE state_hash = ${stateHash}
              AND consumed_at IS NULL
              AND expires_at > ${now}
            RETURNING
                code_verifier_hash,
                nonce_hash,
                client,
                return_to,
                purpose,
                link_user_id,
                link_session_public_id
        `);
        return rows[0] ?? null;
    }

    async invalidateActiveOAuthPending(provider: string, providerSubject: string): Promise<void> {
        await this.prisma.oAuthPendingRegistration.updateMany({
            where: { provider, providerSubject, consumedAt: null },
            data: { consumedAt: new Date() },
        });
    }

    async createOAuthPending(input: {
        tokenHash: string;
        provider: string;
        providerSubject: string;
        providerName?: string | null;
        providerEmail?: string | null;
        providerEmailVerified?: boolean;
        client: string;
        returnTo?: string | null;
        expiresAt: Date;
    }): Promise<{ id: bigint; public_id: string }> {
        await this.invalidateActiveOAuthPending(input.provider, input.providerSubject);
        const row = await this.prisma.oAuthPendingRegistration.create({
            data: {
                tokenHash: input.tokenHash,
                provider: input.provider,
                providerSubject: input.providerSubject,
                providerName: input.providerName ?? null,
                providerEmail: input.providerEmail ?? null,
                providerEmailVerified: input.providerEmailVerified ?? false,
                client: input.client,
                returnTo: input.returnTo ?? null,
                expiresAt: input.expiresAt,
            },
        });
        return { id: row.id, public_id: row.publicId };
    }

    async findActiveOAuthPendingByTokenHash(tokenHash: string): Promise<{
        id: bigint;
        public_id: string;
        provider: string;
        provider_subject: string;
        provider_name: string | null;
        provider_email: string | null;
        provider_email_verified: boolean;
        client: string;
        return_to: string | null;
        email_pending: string | null;
        otp_hash: string | null;
        otp_expires_at: Date | null;
        otp_attempts_count: number;
        otp_max_attempts: number;
        expires_at: Date;
    } | null> {
        const now = new Date();
        const row = await this.prisma.oAuthPendingRegistration.findFirst({
            where: {
                tokenHash,
                consumedAt: null,
                expiresAt: { gt: now },
            },
        });
        if (!row) return null;
        return {
            id: row.id,
            public_id: row.publicId,
            provider: row.provider,
            provider_subject: row.providerSubject,
            provider_name: row.providerName,
            provider_email: row.providerEmail,
            provider_email_verified: row.providerEmailVerified,
            client: row.client,
            return_to: row.returnTo,
            email_pending: row.emailPending,
            otp_hash: row.otpHash,
            otp_expires_at: row.otpExpiresAt,
            otp_attempts_count: row.otpAttemptsCount,
            otp_max_attempts: row.otpMaxAttempts,
            expires_at: row.expiresAt,
        };
    }

    async setOAuthPendingOtp(input: {
        id: bigint;
        emailPending: string;
        otpHash: string;
        otpExpiresAt: Date;
        otpMaxAttempts: number;
    }): Promise<boolean> {
        const now = new Date();
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            UPDATE app_auth.oauth_pending_registrations
            SET email_pending = ${input.emailPending},
                otp_hash = ${input.otpHash},
                otp_expires_at = ${input.otpExpiresAt},
                otp_attempts_count = 0,
                otp_max_attempts = ${input.otpMaxAttempts}
            WHERE id = ${input.id}
              AND consumed_at IS NULL
              AND expires_at > ${now}
            RETURNING id
        `);
        return rows.length > 0;
    }

    async incrementOAuthPendingOtpAttempts(id: bigint): Promise<boolean> {
        const now = new Date();
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            UPDATE app_auth.oauth_pending_registrations
            SET otp_attempts_count = otp_attempts_count + 1
            WHERE id = ${id}
              AND consumed_at IS NULL
              AND expires_at > ${now}
              AND otp_attempts_count < otp_max_attempts
            RETURNING id
        `);
        return rows.length > 0;
    }

    /**
     * Atomically consume a pending OAuth registration and create user + identity.
     * Returns null if the pending row was already consumed/expired or identity taken.
     */
    async consumeOAuthPendingAndCreateUser(input: {
        pendingId: bigint;
        email: string;
        displayName: string;
        provider: string;
        providerSubject: string;
        providerEmail: string | null;
        providerEmailVerified: boolean;
    }): Promise<{ userPublicId: string; userId: bigint } | null> {
        return this.prisma.$transaction(async (tx) => {
            const now = new Date();
            const consumed = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
                UPDATE app_auth.oauth_pending_registrations
                SET consumed_at = ${now}
                WHERE id = ${input.pendingId}
                  AND consumed_at IS NULL
                  AND expires_at > ${now}
                RETURNING id
            `);
            if (consumed.length === 0) return null;

            const existingIdentity = await tx.authIdentity.findUnique({
                where: {
                    provider_providerSubject: {
                        provider: input.provider,
                        providerSubject: input.providerSubject,
                    },
                },
                select: { id: true },
            });
            if (existingIdentity) return null;

            const role = await tx.authRole.findUnique({ where: { code: "user" } });
            if (!role) throw new AuthRoleNotFoundError("user");

            const created = await tx.authUser.create({
                data: {
                    email: input.email,
                    displayName: input.displayName,
                    passwordHash: null,
                    emailVerified: true,
                    accountStatus: "active",
                    isActive: true,
                    preferredLanguage: "en",
                },
            });
            await tx.authUserRole.create({
                data: { userId: created.id, roleId: role.id },
            });
            await tx.authIdentity.create({
                data: {
                    userId: created.id,
                    provider: input.provider,
                    providerSubject: input.providerSubject,
                    providerEmail: input.providerEmail,
                    providerEmailVerified: input.providerEmailVerified,
                    lastLoginAt: now,
                },
            });
            await tx.authUser.update({
                where: { id: created.id },
                data: { lastLoginAt: now },
            });
            return { userPublicId: created.publicId, userId: created.id };
        });
    }

    async findActiveTotp(userId: bigint) {
        return this.prisma.authMfaMethod.findFirst({
            where: { userId, method: "totp", revokedAt: null, verifiedAt: { not: null } },
        });
    }

    async findPendingTotp(userId: bigint) {
        return this.prisma.authMfaMethod.findFirst({
            where: { userId, method: "totp", revokedAt: null, verifiedAt: null },
        });
    }

    async createPendingTotp(userId: bigint, secretEncrypted: string) {
        await this.prisma.authMfaMethod.updateMany({
            where: { userId, revokedAt: null, verifiedAt: null },
            data: { revokedAt: new Date() },
        });
        return this.prisma.authMfaMethod.create({
            data: { userId, secretEncrypted, method: "totp" },
        });
    }

    async activateTotp(methodId: bigint, recoveryHashes: string[]): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            await tx.authMfaMethod.update({
                where: { id: methodId },
                data: { verifiedAt: new Date() },
            });
            await tx.authMfaRecoveryCode.createMany({
                data: recoveryHashes.map((codeHash) => ({ methodId, codeHash })),
            });
        });
    }

    async consumeRecoveryCode(methodId: bigint, codeHash: string): Promise<boolean> {
        const now = new Date();
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            UPDATE app_auth.auth_mfa_recovery_codes
            SET used_at = ${now}
            WHERE method_id = ${methodId}
              AND code_hash = ${codeHash}
              AND used_at IS NULL
            RETURNING id
        `);
        return rows.length > 0;
    }

    async updateEmail(userId: bigint, email: string): Promise<void> {
        await this.prisma.authUser.update({
            where: { id: userId },
            data: { email, emailVerified: true, updatedAt: new Date() },
        });
    }

    async anonymizeAndDelete(userId: bigint): Promise<void> {
        const tombstone = `deleted+${userId}@deleted.coremapmm.invalid`;
        await this.prisma.$transaction(async (tx) => {
            await tx.authSession.updateMany({
                where: { userId, revokedAt: null },
                data: { revokedAt: new Date(), revokeReason: "account_deleted" },
            });
            await tx.authUser.update({
                where: { id: userId },
                data: {
                    email: tombstone,
                    displayName: "Deleted user",
                    phone: null,
                    passwordHash: null,
                    isActive: false,
                    accountStatus: "deleted",
                    deletedAt: new Date(),
                    emailVerified: false,
                },
            });
        });
    }
}

type EmailOtpRow = Prisma.EmailVerificationOtpGetPayload<Record<string, never>>;

function mapOtpRecord(otp: EmailOtpRow): EmailOtpRecord {
    return {
        id: otp.id,
        otp_hash: otp.otpHash,
        attempts_count: otp.attemptsCount,
        max_attempts: otp.maxAttempts,
        expires_at: otp.expiresAt,
        consumed_at: otp.consumedAt,
        created_at: otp.createdAt,
    };
}

function mapRoles(user: AuthUserWithRoles): string[] {
    return user.userRoles.map((userRole) => userRole.role.code);
}

function mapAuthUserRecord(user: AuthUserWithRoles): AuthUserRecord {
    return {
        id: user.id.toString(),
        public_id: user.publicId,
        email: user.email,
        display_name: user.displayName,
        password_hash: user.passwordHash,
        is_active: user.isActive,
        account_status: user.accountStatus,
        email_verified: user.emailVerified,
        roles: mapRoles(user),
    };
}

function mapAuthUserProfile(user: AuthUserWithRoles, totalPoints: number): AuthUserProfile {
    return {
        public_id: user.publicId,
        email: user.email,
        display_name: user.displayName,
        phone: user.phone,
        email_verified: user.emailVerified,
        account_status: user.accountStatus,
        primary_region_id: user.primaryRegionId !== null ? user.primaryRegionId.toString() : null,
        preferred_language: user.preferredLanguage,
        roles: mapRoles(user),
        total_points: totalPoints,
    };
}
