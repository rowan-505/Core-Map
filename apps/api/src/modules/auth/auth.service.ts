import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";

import { getAuthEnv, getPublicAppUrl, isFacebookOAuthEnabled } from "../../config/env.js";
import { generateOtpCode, hashOtp, safeCompareHex } from "../../lib/security/otp.js";
import { hasDashboardAccess } from "../../plugins/auth.js";
import type { EmailService } from "../email/email.service.js";
import {
    AuthRepository,
    AuthRoleNotFoundError,
    type AuthUserProfile,
    type AuthUserRecord,
    type UpdatableProfileFields,
} from "./auth.repo.js";
import { decryptSecret, encryptSecret } from "./mfa-crypto.js";
import {
    buildFacebookAuthorization,
    exchangeFacebookCode,
} from "./oauth/facebook.js";
import { buildGoogleAuthorization, exchangeGoogleCode } from "./oauth/google.js";
import {
    sanitizeReturnTo,
    type AuthClientType,
    type OAuthBrowserClient,
} from "./auth-client.js";
import type { NormalizedIdentity, OAuthClient, OAuthProviderName } from "./oauth/types.js";
import {
    assertPasswordPolicy,
    isMfaRequiredRoleList,
    isPrivilegedRoleList,
    PasswordPolicyError,
    privilegedDashboardOAuthMfaAction,
} from "./password-policy.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
    absoluteExpiry,
    generateRefreshToken,
    hashRefreshToken,
    idleExpiry,
    refreshTokenExpiry,
} from "./refresh-token.js";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "./totp.js";

const EMAIL_VERIFICATION_PURPOSE = "email_verification";
const EMAIL_CHANGE_PURPOSE = "email_change";
const OTP_RESEND_THROTTLE_SECONDS = 60;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_PENDING_TTL_MS = 12 * 60 * 1000;
const FAMILY_REUSE_GRACE_MS = 15_000;
const RECOVERY_CODE_COUNT = 10;

export class AuthError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code?: string
    ) {
        super(message);
        this.name = "AuthError";
    }
}

export type AuthUserResponse = {
    public_id: string;
    email: string;
    display_name: string;
    roles: string[];
};

export type AccessTokenClaims = {
    sub: string;
    email: string;
    roles: string[];
    sid: string;
};

export type SessionContext = {
    userAgent?: string | null;
    ipAddress?: string | null;
    /** Session metadata only — never used for authorization. */
    clientType?: AuthClientType;
};

export type AuthSessionResult = {
    user: AuthUserResponse;
    accessTokenClaims: AccessTokenClaims;
    refreshToken: string;
};

export type LoginOutcome =
    | { kind: "session"; session: AuthSessionResult }
    | { kind: "mfa"; mfaClaims: { sub: string; purpose: "mfa"; email: string; roles: string[] } }
    | {
          kind: "mfa_enrollment_required";
          enrollmentClaims: {
              sub: string;
              purpose: "mfa_enroll";
              email: string;
              roles: string[];
          };
      };

export type OAuthProviderStatus = {
    provider: "google" | "facebook";
    connected: boolean;
    provider_email: string | null;
    linked_at: string | null;
    last_login_at: string | null;
};

export type OAuthCompleteResult =
    | { kind: "session"; session: AuthSessionResult; client: OAuthClient; returnTo: string | null }
    | {
          kind: "mfa";
          mfaClaims: { sub: string; purpose: "mfa"; email: string; roles: string[] };
          client: OAuthClient;
          returnTo: string | null;
      }
    | {
          kind: "linked";
          provider: OAuthProviderName;
          client: OAuthClient;
          returnTo: string | null;
      }
    | {
          kind: "complete_profile";
          flowToken: string;
          client: OAuthClient;
          returnTo: string | null;
      };

export type CompleteProfileVerifyResult =
    | { kind: "session"; session: AuthSessionResult }
    | { kind: "existing_account_link_required" };

export type EmailOtpDeps = {
    emailService: EmailService;
    otpSecret: string | null;
    ttlMinutes: number;
    maxAttempts: number;
};

export type EmailOtpStatus = { status: "sent" | "verified" | "already_verified" };

export class AuthService {
    constructor(
        private readonly authRepo: AuthRepository,
        private readonly emailOtp?: EmailOtpDeps
    ) {}

    async register(input: {
        email: string;
        displayName: string;
        password: string;
        preferredLanguage?: "my" | "en";
        primaryRegionId?: number | null;
    }): Promise<AuthUserProfile> {
        const email = normalizeEmail(input.email);
        const displayName = input.displayName.trim();
        assertPasswordPolicy(input.password);

        const existing = await this.authRepo.findUserByEmail(email);
        if (existing) {
            throw new AuthError("Email already registered", 409);
        }

        let primaryRegionId: bigint | undefined;
        if (input.primaryRegionId !== undefined && input.primaryRegionId !== null) {
            primaryRegionId = BigInt(input.primaryRegionId);
            const exists = await this.authRepo.adminAreaExists(primaryRegionId);
            if (!exists) {
                throw new AuthError("primaryRegionId does not reference a known region", 400);
            }
        }

        const passwordHash = await hashPassword(input.password);

        try {
            const user = await this.authRepo.createPublicUser({
                email,
                displayName,
                passwordHash,
                preferredLanguage: input.preferredLanguage,
                primaryRegionId,
            });
            await this.safeEvent({
                eventType: "register",
                success: true,
                metadata: { email },
            });
            return user;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                throw new AuthError("Email already registered", 409);
            }
            if (error instanceof AuthRoleNotFoundError) {
                throw new AuthError("User role is not configured", 500);
            }
            throw error;
        }
    }

    async updateProfile(
        userPublicId: string,
        fields: UpdatableProfileFields
    ): Promise<AuthUserProfile> {
        const current = await this.authRepo.findUserByPublicId(userPublicId);
        if (!current) {
            throw new AuthError("User not found", 404);
        }

        if (fields.primaryRegionId !== undefined && fields.primaryRegionId !== null) {
            const exists = await this.authRepo.adminAreaExists(fields.primaryRegionId);
            if (!exists) {
                throw new AuthError("primaryRegionId does not reference a known region", 400);
            }
        }

        await this.authRepo.updateProfile(BigInt(current.id), fields);

        const updated = await this.authRepo.findProfileByPublicId(userPublicId);
        if (!updated) {
            throw new AuthError("User not found", 404);
        }
        return updated;
    }

    async login(
        credentials: { email?: string; username?: string },
        password: string,
        context: SessionContext = {},
        options: { requireDashboard?: boolean } = {}
    ): Promise<LoginOutcome> {
        const normalizedEmail = normalizeLoginEmail(credentials);
        const user = await this.authRepo.findUserByEmail(normalizedEmail);

        if (!user || !user.password_hash) {
            await this.safeEvent({
                eventType: "login_failed",
                success: false,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
            });
            throw new AuthError("Invalid email or password", 401);
        }

        assertUserUsable(user.is_active, user.account_status);

        const { valid, needsRehash } = await verifyPassword(user.password_hash, password);
        if (!valid) {
            await this.safeEvent({
                userId: BigInt(user.id),
                eventType: "login_failed",
                success: false,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
            });
            throw new AuthError("Invalid email or password", 401);
        }

        if (options.requireDashboard) {
            if (!hasDashboardAccess(user.roles)) {
                throw new AuthError("This account does not have dashboard access.", 403, "dashboard_forbidden");
            }
            if (!user.email_verified) {
                throw new AuthError("Verify your email before using the dashboard.", 403);
            }
        }

        const loginContext: SessionContext = {
            ...context,
            clientType:
                context.clientType ??
                (options.requireDashboard ? "dashboard" : "web"),
        };

        const userId = BigInt(user.id);
        if (needsRehash) {
            try {
                await this.authRepo.updatePasswordHash(userId, await hashPassword(password));
            } catch {
                // Rehash is best-effort; never block a valid login on it.
            }
        }

        // Challenge TOTP when enrolled (required for super_admin; optional for admin).
        const totp = isPrivilegedRoleList(user.roles) ? await this.authRepo.findActiveTotp(userId) : null;
        if (totp) {
            return {
                kind: "mfa",
                mfaClaims: {
                    sub: user.public_id,
                    purpose: "mfa",
                    email: user.email,
                    roles: user.roles,
                },
            };
        }

        // Mandatory MFA enrollment is super_admin only. Admin may use password alone.
        if (options.requireDashboard && isMfaRequiredRoleList(user.roles)) {
            return {
                kind: "mfa_enrollment_required",
                enrollmentClaims: {
                    sub: user.public_id,
                    purpose: "mfa_enroll",
                    email: user.email,
                    roles: user.roles,
                },
            };
        }

        await this.authRepo.touchLastLogin(userId);
        void this.authRepo.cleanupExpiredSessions();
        const session = await this.issueSession(user, loginContext);
        await this.safeEvent({
            userId,
            eventType: "login",
            success: true,
            ipAddress: loginContext.ipAddress,
            userAgent: loginContext.userAgent,
            metadata: { client_type: loginContext.clientType ?? "web" },
        });
        return { kind: "session", session };
    }

    async refresh(refreshToken: string, context: SessionContext = {}): Promise<AuthSessionResult> {
        const currentHash = hashRefreshToken(refreshToken);
        const nextToken = generateRefreshToken();
        const nextHash = hashRefreshToken(nextToken);
        const rotated = await this.authRepo.rotateSessionAtomic({
            currentHash,
            nextHash,
            idleExpiresAt: idleExpiry(),
            expiresAt: refreshTokenExpiry(),
        });

        if (rotated) {
            assertUserUsable(rotated.user.is_active, rotated.user.account_status);
            void this.authRepo.cleanupExpiredSessions();
            return {
                user: toUserResponse(rotated.user),
                accessTokenClaims: toAccessTokenClaims(rotated.user, rotated.public_id),
                refreshToken: nextToken,
            };
        }

        const reused = await this.authRepo.findSessionByPreviousHash(currentHash);
        if (reused) {
            const lastUsed = reused.last_used_at?.getTime() ?? 0;
            const age = Date.now() - lastUsed;
            if (age > FAMILY_REUSE_GRACE_MS) {
                await this.authRepo.revokeFamily(reused.token_family_id, "refresh_reuse");
                await this.safeEvent({
                    eventType: "refresh_reuse",
                    success: false,
                    ipAddress: context.ipAddress,
                    userAgent: context.userAgent,
                    metadata: { family: reused.token_family_id },
                });
                throw new AuthError("Session revoked. Sign in again.", 401);
            }
        }

        throw new AuthError("Invalid or expired refresh token", 401);
    }

    async logout(refreshToken: string | null): Promise<void> {
        if (!refreshToken) return;
        await this.authRepo.revokeSessionByTokenHash(hashRefreshToken(refreshToken), "logout");
    }

    async getMe(userPublicId: string): Promise<AuthUserProfile> {
        const user = await this.requireActiveUser(userPublicId);
        const profile = await this.authRepo.findProfileByPublicId(user.public_id);
        if (!profile) {
            throw new AuthError("User not found", 401);
        }
        return profile;
    }

    async sendEmailOtp(
        userPublicId: string,
        context: SessionContext = {},
        purpose = EMAIL_VERIFICATION_PURPOSE,
        destinationEmail?: string
    ): Promise<EmailOtpStatus> {
        const config = this.requireEmailOtpConfig();
        const user = await this.loadVerificationUser(userPublicId);
        const email = destinationEmail ?? user.email;

        if (purpose === EMAIL_VERIFICATION_PURPOSE && user.email_verified && !destinationEmail) {
            return { status: "already_verified" };
        }

        const latest = await this.authRepo.findLatestOtp(user.id, email, purpose);
        if (latest) {
            const elapsedMs = Date.now() - latest.created_at.getTime();
            if (elapsedMs < OTP_RESEND_THROTTLE_SECONDS * 1000) {
                throw new AuthError("Please wait before requesting another code", 429);
            }
        }

        await this.authRepo.invalidateActiveOtps(user.id, email, purpose);
        const code = generateOtpCode();
        const created = await this.authRepo.createEmailOtp({
            userId: user.id,
            email,
            otpHash: hashOtp(code, config.otpSecret),
            purpose,
            maxAttempts: config.maxAttempts,
            expiresAt: new Date(Date.now() + config.ttlMinutes * 60 * 1000),
        });

        try {
            await config.emailService.sendEmailVerificationOtp({
                to: email,
                code,
                ttlMinutes: config.ttlMinutes,
            });
        } catch (error) {
            await this.authRepo.deleteOtp(created.id);
            throw error;
        }

        void context;
        return { status: "sent" };
    }

    async verifyEmailOtp(
        userPublicId: string,
        code: string,
        context: SessionContext = {},
        purpose = EMAIL_VERIFICATION_PURPOSE
    ): Promise<EmailOtpStatus> {
        const config = this.requireEmailOtpConfig();
        const user = await this.loadVerificationUser(userPublicId);

        if (purpose === EMAIL_VERIFICATION_PURPOSE && user.email_verified) {
            return { status: "already_verified" };
        }

        const otp = await this.authRepo.findLatestUnconsumedOtp(user.id, user.email, purpose);
        if (!otp) {
            throw new AuthError("No active verification code. Request a new one.", 400);
        }
        if (otp.expires_at.getTime() <= Date.now()) {
            throw new AuthError("Verification code has expired", 400);
        }
        if (otp.attempts_count >= otp.max_attempts) {
            throw new AuthError("Too many attempts. Request a new code.", 429);
        }

        const matches = safeCompareHex(hashOtp(code, config.otpSecret), otp.otp_hash);
        if (!matches) {
            const incremented = await this.authRepo.incrementOtpAttemptsAtomic(otp.id);
            if (!incremented) {
                throw new AuthError("Too many attempts. Request a new code.", 429);
            }
            throw new AuthError("Invalid verification code", 400);
        }

        const consumed = await this.authRepo.markEmailVerified(user.id, otp.id, {
            ipAddress: context.ipAddress ?? null,
            userAgent: context.userAgent ?? null,
        });
        if (!consumed) {
            throw new AuthError("Verification code has expired", 400);
        }
        return { status: "verified" };
    }

    async forgotPassword(email: string, context: SessionContext = {}): Promise<void> {
        const normalized = normalizeEmail(email);
        const user = await this.authRepo.findUserByEmail(normalized);
        await this.safeEvent({
            userId: user ? BigInt(user.id) : null,
            eventType: "password_forgot",
            success: true,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
        });
        if (!user || !user.is_active || user.account_status !== "active") {
            return;
        }
        const config = this.emailOtp;
        if (!config?.emailService.isConfigured()) {
            return;
        }
        const token = generateRefreshToken();
        await this.authRepo.createPasswordResetToken({
            userId: BigInt(user.id),
            tokenHash: hashRefreshToken(token),
            expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        });
        const resetUrl = `${getPublicAppUrl()}/reset-password?token=${encodeURIComponent(token)}`;
        await config.emailService.sendPasswordReset({ to: user.email, resetUrl });
    }

    async resetPassword(token: string, password: string, context: SessionContext = {}): Promise<void> {
        const consumed = await this.authRepo.consumePasswordResetToken(hashRefreshToken(token));
        if (!consumed) {
            throw new AuthError("Reset link is invalid or expired", 400);
        }
        const record = await this.authRepo.findUserById(consumed.user_id);
        if (!record) {
            throw new AuthError("Reset link is invalid or expired", 400);
        }
        const privileged = isPrivilegedRoleList(record.roles);
        try {
            assertPasswordPolicy(password, { privileged });
        } catch (error) {
            if (error instanceof PasswordPolicyError) {
                throw new AuthError(error.message, 400, "password_policy");
            }
            throw error;
        }
        await this.authRepo.updatePasswordHash(consumed.user_id, await hashPassword(password));
        await this.authRepo.revokeAllUserSessions(consumed.user_id, "password_reset");
        await this.safeEvent({
            userId: consumed.user_id,
            eventType: "password_reset",
            success: true,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
        });
        try {
            await this.emailOtp?.emailService.sendPasswordChanged({ to: record.email });
        } catch {
            // Notification is best-effort.
        }
    }

    async changePassword(
        userPublicId: string,
        currentPassword: string,
        newPassword: string,
        currentSessionPublicId: string | undefined,
        context: SessionContext = {}
    ): Promise<void> {
        const user = await this.requireActiveUser(userPublicId);
        if (!user.password_hash) {
            throw new AuthError("This account uses a social sign-in and has no password.", 400);
        }
        const privileged = isPrivilegedRoleList(user.roles);
        try {
            assertPasswordPolicy(newPassword, { privileged });
        } catch (error) {
            if (error instanceof PasswordPolicyError) {
                throw new AuthError(error.message, 400, "password_policy");
            }
            throw error;
        }
        if (currentPassword === newPassword) {
            throw new AuthError("New password must be different from the current password.", 400);
        }
        const { valid } = await verifyPassword(user.password_hash, currentPassword);
        if (!valid) {
            throw new AuthError("Current password is incorrect", 401);
        }
        await this.authRepo.updatePasswordHash(BigInt(user.id), await hashPassword(newPassword));
        await this.authRepo.revokeAllUserSessions(BigInt(user.id), "password_change", currentSessionPublicId);
        await this.safeEvent({
            userId: BigInt(user.id),
            eventType: "password_change",
            success: true,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
        });
        try {
            await this.emailOtp?.emailService.sendPasswordChanged({ to: user.email });
        } catch {
            // best-effort
        }
    }

    async listSessions(userPublicId: string, currentSid?: string) {
        const user = await this.requireActiveUser(userPublicId);
        const rows = await this.authRepo.listSessions(BigInt(user.id));
        return rows.map((row) => ({
            public_id: row.public_id,
            current: currentSid === row.public_id,
            created_at: row.created_at.toISOString(),
            last_used_at: row.last_used_at ? row.last_used_at.toISOString() : null,
            user_agent: row.user_agent,
            device_label: deviceLabel(row.user_agent),
            client_type: row.client_type,
        }));
    }

    async revokeSession(userPublicId: string, sessionPublicId: string): Promise<void> {
        const user = await this.requireActiveUser(userPublicId);
        await this.authRepo.revokeSessionByPublicId(BigInt(user.id), sessionPublicId, "user_revoke");
    }

    async revokeOtherSessions(userPublicId: string, currentSid: string): Promise<void> {
        const user = await this.requireActiveUser(userPublicId);
        await this.authRepo.revokeAllUserSessions(BigInt(user.id), "user_revoke_others", currentSid);
    }

    async listSecurityEvents(userPublicId: string) {
        const user = await this.requireActiveUser(userPublicId);
        const rows = await this.authRepo.listSecurityEvents(BigInt(user.id));
        return rows.map((row) => ({
            event_type: row.eventType,
            success: row.success,
            provider: row.provider,
            created_at: row.createdAt.toISOString(),
            ip_address: row.ipAddress,
        }));
    }

    async listConnectedProviders(userPublicId: string): Promise<{
        providers: OAuthProviderStatus[];
        has_password: boolean;
        can_unlink: Record<"google" | "facebook", boolean>;
        facebook_available: boolean;
    }> {
        const user = await this.requireActiveUser(userPublicId);
        const [identities, methods] = await Promise.all([
            this.authRepo.listIdentitiesForUser(BigInt(user.id)),
            this.authRepo.countUsableAuthMethods(BigInt(user.id)),
        ]);
        const byProvider = new Map(identities.map((row) => [row.provider, row]));
        const usableCount =
            (methods.hasPassword ? 1 : 0) + methods.oauthProviders.length;
        const facebookAvailable = isFacebookOAuthEnabled() && Boolean(getAuthEnv().facebook);
        const providerNames = (["google", "facebook"] as const).filter(
            (provider) => provider === "google" || facebookAvailable || byProvider.has("facebook")
        );
        const providers: OAuthProviderStatus[] = providerNames.map((provider) => {
            const row = byProvider.get(provider);
            return {
                provider,
                connected: Boolean(row),
                provider_email: row?.providerEmail ?? null,
                linked_at: row?.createdAt.toISOString() ?? null,
                last_login_at: row?.lastLoginAt?.toISOString() ?? null,
            };
        });
        return {
            providers,
            has_password: methods.hasPassword,
            can_unlink: {
                google: Boolean(byProvider.get("google")) && usableCount > 1,
                facebook: Boolean(byProvider.get("facebook")) && usableCount > 1,
            },
            facebook_available: facebookAvailable,
        };
    }

    async startOAuth(
        provider: OAuthProviderName,
        input: { client: OAuthClient; returnTo?: string | null }
    ): Promise<{ authorizationUrl: string; state: string; cookiePayload: string }> {
        this.assertProviderEnabled(provider);
        return this.beginOAuth(provider, {
            client: input.client,
            returnTo: input.returnTo,
            purpose: "login",
        });
    }

    async startOAuthLink(
        provider: OAuthProviderName,
        input: {
            userPublicId: string;
            sessionPublicId: string;
            returnTo?: string | null;
        }
    ): Promise<{ authorizationUrl: string; state: string; cookiePayload: string }> {
        this.assertProviderEnabled(provider);
        const user = await this.requireActiveUser(input.userPublicId);
        const session = await this.authRepo.findActiveSessionByPublicId(input.sessionPublicId);
        if (!session || session.user.public_id !== user.public_id) {
            throw new AuthError("Sign in again to connect that account.", 401, "auth_failed");
        }
        const existing = await this.authRepo.listIdentitiesForUser(BigInt(user.id));
        if (existing.some((row) => row.provider === provider)) {
            throw new AuthError(
                `${provider === "google" ? "Google" : "Facebook"} is already connected.`,
                409,
                "already_linked"
            );
        }
        const defaultReturn =
            `${getAuthEnv().webAppUrl ?? "http://localhost:5173"}/account/security`;
        return this.beginOAuth(provider, {
            client: "web",
            returnTo: input.returnTo ?? defaultReturn,
            purpose: "link",
            linkUserId: BigInt(user.id),
            linkSessionPublicId: session.public_id,
        });
    }

    async completeOAuth(
        provider: OAuthProviderName,
        input: {
            code: string;
            state: string;
            cookiePayload: string | null;
            refreshToken: string | null;
            context: SessionContext;
        }
    ): Promise<OAuthCompleteResult> {
        this.assertProviderEnabled(provider);
        const env = getAuthEnv();
        const config = provider === "google" ? env.google : env.facebook;
        if (!config) {
            throw new AuthError("That sign-in method is not enabled yet.", 400, "oauth_disabled");
        }
        const stored = await this.authRepo.consumeOAuthState(hashRefreshToken(input.state));
        if (!stored) {
            throw new AuthError("Sign-in expired. Try again.", 400, "auth_failed");
        }
        const cookie = parseOAuthCookie(input.cookiePayload);
        if (!cookie || cookie.state !== input.state) {
            throw new AuthError("Sign-in expired. Try again.", 400, "auth_failed");
        }
        if (stored.code_verifier_hash && hashRefreshToken(cookie.codeVerifier ?? "") !== stored.code_verifier_hash) {
            throw new AuthError("Sign-in expired. Try again.", 400, "auth_failed");
        }
        if (stored.nonce_hash && hashRefreshToken(cookie.nonce ?? "") !== stored.nonce_hash) {
            throw new AuthError("Sign-in expired. Try again.", 400, "auth_failed");
        }

        let identity: NormalizedIdentity;
        try {
            identity =
                provider === "google"
                    ? await exchangeGoogleCode(config, {
                          code: input.code,
                          codeVerifier: cookie.codeVerifier ?? "",
                          nonce: cookie.nonce ?? "",
                      })
                    : await exchangeFacebookCode(config, { code: input.code });
        } catch {
            throw new AuthError("Sign-in with that provider did not complete.", 400, "auth_failed");
        }

        const client: OAuthBrowserClient = stored.client === "dashboard" ? "dashboard" : "web";
        if (stored.purpose === "link") {
            await this.completeOAuthLink({
                provider,
                identity,
                linkUserId: stored.link_user_id,
                linkSessionPublicId: stored.link_session_public_id,
                refreshToken: input.refreshToken,
                context: input.context,
            });
            return { kind: "linked", provider, client, returnTo: stored.return_to };
        }

        const resolved = await this.resolveOAuthIdentity(identity, {
            ...input.context,
            clientType: client,
        }, { client, returnTo: stored.return_to });
        if (resolved.kind === "complete_profile") {
            return {
                kind: "complete_profile",
                flowToken: resolved.flowToken,
                client,
                returnTo: stored.return_to,
            };
        }
        const result = resolved.session;
        if (client === "dashboard") {
            if (!hasDashboardAccess(result.user.roles)) {
                throw new AuthError("This account does not have dashboard access.", 403, "dashboard_forbidden");
            }
            const email = result.user.email;
            if (!email) {
                throw new AuthError("This account does not have dashboard access.", 403, "dashboard_forbidden");
            }
            const profile = await this.authRepo.findProfileByPublicId(result.user.public_id);
            if (!profile?.email_verified) {
                throw new AuthError("Verify your email before using the dashboard.", 403);
            }
            if (isPrivilegedRoleList(result.user.roles)) {
                const profileUser = await this.authRepo.findUserByPublicId(result.user.public_id);
                if (!profileUser) {
                    throw new AuthError("This account does not have dashboard access.", 403, "dashboard_forbidden");
                }
                const totp = await this.authRepo.findActiveTotp(BigInt(profileUser.id));
                const mfaAction = privilegedDashboardOAuthMfaAction(result.user.roles, Boolean(totp));
                if (mfaAction !== "session") {
                    // Revoke the session resolveOAuthIdentity already created — password
                    // login never issues a session before MFA either.
                    await this.authRepo.revokeSessionByTokenHash(
                        hashRefreshToken(result.refreshToken),
                        mfaAction === "mfa" ? "mfa_required" : "mfa_enrollment_required"
                    );
                    if (mfaAction === "enrollment_required") {
                        throw new AuthError(
                            "Super admin MFA enrollment required. Sign in with email and password to set up MFA.",
                            403,
                            "mfa_enrollment_required"
                        );
                    }
                    return {
                        kind: "mfa",
                        mfaClaims: {
                            sub: result.user.public_id,
                            purpose: "mfa",
                            email,
                            roles: result.user.roles,
                        },
                        client,
                        returnTo: stored.return_to,
                    };
                }
            }
        }
        return { kind: "session", session: result, client, returnTo: stored.return_to };
    }

    async sendCompleteProfileOtp(
        flowToken: string,
        email: string,
        context: SessionContext = {}
    ): Promise<{ status: "sent" }> {
        const config = this.requireEmailOtpConfig();
        const pending = await this.requireActiveOAuthPending(flowToken);
        const normalized = normalizeEmail(email);
        assertDeliverableEmail(normalized);

        const owner = await this.authRepo.findUserByEmail(normalized);
        if (owner) {
            // Do not send OTP when email is already taken; caller should guide to link flow.
            throw new AuthError(
                "This email already belongs to a CoreMap account. Sign in to that account first, then connect this provider from Account → Security.",
                409,
                "existing_account_link_required"
            );
        }

        const latestOtpAt = pending.otp_expires_at
            ? new Date(pending.otp_expires_at.getTime() - config.ttlMinutes * 60 * 1000)
            : null;
        if (latestOtpAt && Date.now() - latestOtpAt.getTime() < OTP_RESEND_THROTTLE_SECONDS * 1000) {
            throw new AuthError("Please wait before requesting another code", 429);
        }

        const code = generateOtpCode();
        const stored = await this.authRepo.setOAuthPendingOtp({
            id: pending.id,
            emailPending: normalized,
            otpHash: hashOtp(code, config.otpSecret),
            otpExpiresAt: new Date(Date.now() + config.ttlMinutes * 60 * 1000),
            otpMaxAttempts: config.maxAttempts,
        });
        if (!stored) {
            throw new AuthError("This sign-up step expired. Start again with Facebook or Google.", 400, "oauth_expired");
        }

        try {
            await config.emailService.sendEmailVerificationOtp({
                to: normalized,
                code,
                ttlMinutes: config.ttlMinutes,
            });
        } catch (error) {
            await this.safeEvent({
                eventType: "oauth_pending_otp_failed",
                success: false,
                provider: pending.provider,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
            });
            throw error;
        }

        await this.safeEvent({
            eventType: "oauth_pending_otp_sent",
            success: true,
            provider: pending.provider,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
        });
        return { status: "sent" };
    }

    async verifyCompleteProfile(
        flowToken: string,
        email: string,
        code: string,
        context: SessionContext = {}
    ): Promise<CompleteProfileVerifyResult> {
        const config = this.requireEmailOtpConfig();
        const pending = await this.requireActiveOAuthPending(flowToken);
        const normalized = normalizeEmail(email);
        assertDeliverableEmail(normalized);

        if (!pending.email_pending || pending.email_pending !== normalized || !pending.otp_hash) {
            throw new AuthError("Request a verification code for this email first.", 400);
        }
        if (!pending.otp_expires_at || pending.otp_expires_at.getTime() <= Date.now()) {
            throw new AuthError("Verification code has expired", 400);
        }
        if (pending.otp_attempts_count >= pending.otp_max_attempts) {
            throw new AuthError("Too many attempts. Request a new code.", 429);
        }

        const matches = safeCompareHex(hashOtp(code, config.otpSecret), pending.otp_hash);
        if (!matches) {
            const incremented = await this.authRepo.incrementOAuthPendingOtpAttempts(pending.id);
            if (!incremented) {
                throw new AuthError("Too many attempts. Request a new code.", 429);
            }
            throw new AuthError("Invalid verification code", 400);
        }

        const owner = await this.authRepo.findUserByEmail(normalized);
        if (owner) {
            await this.authRepo.invalidateActiveOAuthPending(pending.provider, pending.provider_subject);
            await this.safeEvent({
                eventType: "oauth_pending_link_required",
                success: false,
                provider: pending.provider,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
            });
            return { kind: "existing_account_link_required" };
        }

        // Re-check identity was not linked meanwhile.
        const existingIdentity = await this.authRepo.findIdentity(
            pending.provider,
            pending.provider_subject
        );
        if (existingIdentity) {
            throw new AuthError(
                "That provider account is already linked to another CoreMap user.",
                409,
                "identity_taken"
            );
        }

        const created = await this.authRepo.consumeOAuthPendingAndCreateUser({
            pendingId: pending.id,
            email: normalized,
            displayName: pending.provider_name?.trim() || "CoreMap user",
            provider: pending.provider,
            providerSubject: pending.provider_subject,
            providerEmail: pending.provider_email,
            providerEmailVerified: pending.provider_email_verified,
        });
        if (!created) {
            throw new AuthError(
                "That provider account is already linked to another CoreMap user.",
                409,
                "identity_taken"
            );
        }

        const user = await this.authRepo.findUserByPublicId(created.userPublicId);
        if (!user) {
            throw new AuthError("User not found", 500);
        }
        const clientType =
            pending.client === "dashboard"
                ? "dashboard"
                : pending.client === "android"
                  ? "android"
                  : pending.client === "ios"
                    ? "ios"
                    : "web";
        const session = await this.issueSession(user, { ...context, clientType });
        await this.safeEvent({
            userId: created.userId,
            eventType: "oauth_register",
            success: true,
            provider: pending.provider,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            metadata: { via: "complete_profile" },
        });
        return { kind: "session", session };
    }

    async unlinkProvider(
        userPublicId: string,
        provider: OAuthProviderName,
        input: { password?: string | null; context?: SessionContext }
    ): Promise<void> {
        const user = await this.requireActiveUser(userPublicId);
        const methods = await this.authRepo.countUsableAuthMethods(BigInt(user.id));
        if (!methods.oauthProviders.includes(provider)) {
            throw new AuthError("That provider is not connected.", 404);
        }
        const usableCount = (methods.hasPassword ? 1 : 0) + methods.oauthProviders.length;
        if (usableCount <= 1) {
            throw new AuthError(
                "Connect another sign-in method or set a password before disconnecting this one.",
                400,
                "last_auth_method"
            );
        }
        if (methods.hasPassword) {
            if (!input.password || !user.password_hash) {
                throw new AuthError("Re-enter your password to disconnect this provider.", 400);
            }
            const { valid } = await verifyPassword(user.password_hash, input.password);
            if (!valid) {
                throw new AuthError("Current password is incorrect", 401);
            }
        }
        const removed = await this.authRepo.deleteIdentityForUser(BigInt(user.id), provider);
        if (!removed) {
            throw new AuthError("That provider is not connected.", 404);
        }
        await this.safeEvent({
            userId: BigInt(user.id),
            eventType: "oauth_unlink",
            success: true,
            provider,
            ipAddress: input.context?.ipAddress,
            userAgent: input.context?.userAgent,
        });
    }

    private async beginOAuth(
        provider: OAuthProviderName,
        input: {
            client: OAuthClient;
            returnTo?: string | null;
            purpose: "login" | "link";
            linkUserId?: bigint | null;
            linkSessionPublicId?: string | null;
        }
    ): Promise<{ authorizationUrl: string; state: string; cookiePayload: string }> {
        const env = getAuthEnv();
        const config = provider === "google" ? env.google : env.facebook;
        if (!config) {
            throw new AuthError("That sign-in method is not enabled yet.", 400, "oauth_disabled");
        }
        const authz =
            provider === "google"
                ? buildGoogleAuthorization(config, { returnTo: input.returnTo })
                : buildFacebookAuthorization(config, { returnTo: input.returnTo });
        const returnTo = sanitizeReturnTo(input.returnTo, input.client, {
            webAppUrl: env.webAppUrl,
            dashboardAppUrl: env.dashboardAppUrl,
        });
        await this.authRepo.createOAuthState({
            stateHash: hashRefreshToken(authz.state),
            codeVerifierHash: authz.codeVerifier ? hashRefreshToken(authz.codeVerifier) : null,
            nonceHash: authz.nonce ? hashRefreshToken(authz.nonce) : null,
            client: input.client,
            returnTo,
            purpose: input.purpose,
            linkUserId: input.linkUserId ?? null,
            linkSessionPublicId: input.linkSessionPublicId ?? null,
            expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
        });
        const cookiePayload = JSON.stringify({
            state: authz.state,
            codeVerifier: authz.codeVerifier ?? null,
            nonce: authz.nonce ?? null,
        });
        return { authorizationUrl: authz.authorizationUrl, state: authz.state, cookiePayload };
    }

    private async completeOAuthLink(input: {
        provider: OAuthProviderName;
        identity: NormalizedIdentity;
        linkUserId: bigint | null;
        linkSessionPublicId: string | null;
        refreshToken: string | null;
        context: SessionContext;
    }): Promise<void> {
        if (!input.linkUserId || !input.linkSessionPublicId) {
            throw new AuthError("Sign-in expired. Try again.", 400, "auth_failed");
        }
        if (!input.refreshToken) {
            throw new AuthError("Sign in again to connect that account.", 401, "auth_failed");
        }
        const session = await this.authRepo.findActiveSessionByTokenHash(
            hashRefreshToken(input.refreshToken)
        );
        if (
            !session ||
            session.user.id !== String(input.linkUserId) ||
            session.public_id !== input.linkSessionPublicId
        ) {
            throw new AuthError("Sign in again to connect that account.", 401, "auth_failed");
        }
        assertUserUsable(session.user.is_active, session.user.account_status);

        const existing = await this.authRepo.findIdentity(input.identity.provider, input.identity.subject);
        if (existing) {
            if (existing.userId === input.linkUserId) {
                await this.authRepo.touchIdentityLogin(existing.id);
                await this.safeEvent({
                    userId: input.linkUserId,
                    eventType: "oauth_link",
                    success: true,
                    provider: input.provider,
                    ipAddress: input.context.ipAddress,
                    userAgent: input.context.userAgent,
                    metadata: { already_linked: true },
                });
                return;
            }
            throw new AuthError(
                "That provider account is already linked to another CoreMap user.",
                409,
                "identity_taken"
            );
        }

        try {
            await this.authRepo.createIdentity({
                userId: input.linkUserId,
                provider: input.identity.provider,
                providerSubject: input.identity.subject,
                providerEmail: input.identity.email,
                providerEmailVerified: input.identity.emailVerified,
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                throw new AuthError(
                    "That provider account is already linked to another CoreMap user.",
                    409,
                    "identity_taken"
                );
            }
            throw error;
        }

        await this.safeEvent({
            userId: input.linkUserId,
            eventType: "oauth_link",
            success: true,
            provider: input.provider,
            ipAddress: input.context.ipAddress,
            userAgent: input.context.userAgent,
        });
    }

    async verifyMfa(
        userPublicId: string,
        code: string,
        context: SessionContext = {}
    ): Promise<AuthSessionResult> {
        const user = await this.requireActiveUser(userPublicId);
        const method = await this.authRepo.findActiveTotp(BigInt(user.id));
        if (!method) {
            throw new AuthError("MFA is not enabled for this account.", 400);
        }
        const key = getAuthEnv().mfaEncryptionKey;
        if (!key) {
            throw new AuthError("MFA is not configured.", 503);
        }
        const secret = decryptSecret(method.secretEncrypted, key);
        const totpOk = verifyTotp(secret, code);
        if (!totpOk) {
            const recovered = await this.authRepo.consumeRecoveryCode(
                method.id,
                hashRefreshToken(normalizeRecoveryCode(code))
            );
            if (!recovered) {
                await this.safeEvent({
                    userId: BigInt(user.id),
                    eventType: "mfa_failed",
                    success: false,
                    ipAddress: context.ipAddress,
                    userAgent: context.userAgent,
                });
                throw new AuthError("Invalid verification code", 400);
            }
        }
        await this.authRepo.touchLastLogin(BigInt(user.id));
        const session = await this.issueSession(user, context);
        await this.safeEvent({
            userId: BigInt(user.id),
            eventType: "mfa_verified",
            success: true,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
        });
        return session;
    }

    async enrollMfaStart(userPublicId: string): Promise<{ secret: string; otpauthUrl: string }> {
        const user = await this.requireActiveUser(userPublicId);
        if (!isPrivilegedRoleList(user.roles)) {
            throw new AuthError("MFA is only available for administrators.", 403);
        }
        const existing = await this.authRepo.findActiveTotp(BigInt(user.id));
        if (existing) {
            throw new AuthError("MFA is already enabled for this account.", 400);
        }
        const key = getAuthEnv().mfaEncryptionKey;
        if (!key) {
            throw new AuthError("MFA is not configured.", 503);
        }
        const secret = generateTotpSecret();
        await this.authRepo.createPendingTotp(BigInt(user.id), encryptSecret(secret, key));
        return { secret, otpauthUrl: otpauthUrl({ secret, email: user.email }) };
    }

    async enrollMfaVerify(
        userPublicId: string,
        code: string
    ): Promise<{ recoveryCodes: string[] }> {
        const user = await this.requireActiveUser(userPublicId);
        const pending = await this.authRepo.findPendingTotp(BigInt(user.id));
        if (!pending) {
            throw new AuthError("No MFA enrollment in progress.", 400);
        }
        const key = getAuthEnv().mfaEncryptionKey;
        if (!key) {
            throw new AuthError("MFA is not configured.", 503);
        }
        const secret = decryptSecret(pending.secretEncrypted, key);
        if (!verifyTotp(secret, code)) {
            throw new AuthError("Invalid verification code", 400);
        }
        const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
            randomBytes(5).toString("hex")
        );
        await this.authRepo.activateTotp(
            pending.id,
            recoveryCodes.map((item) => hashRefreshToken(normalizeRecoveryCode(item)))
        );
        await this.safeEvent({
            userId: BigInt(user.id),
            eventType: "mfa_enrolled",
            success: true,
        });
        return { recoveryCodes };
    }

    /**
     * Finish mandatory super_admin MFA enrollment and issue a full session.
     * Used by the dashboard bootstrap flow after password login (no session yet).
     */
    async completeMfaEnrollmentBootstrap(
        userPublicId: string,
        code: string,
        context: SessionContext = {}
    ): Promise<{ session: AuthSessionResult; recoveryCodes: string[] }> {
        const recoveryCodes = (await this.enrollMfaVerify(userPublicId, code)).recoveryCodes;
        const user = await this.requireActiveUser(userPublicId);
        if (!isMfaRequiredRoleList(user.roles)) {
            throw new AuthError("Mandatory MFA enrollment is only for super admins.", 403);
        }
        await this.authRepo.touchLastLogin(BigInt(user.id));
        const session = await this.issueSession(user, {
            ...context,
            clientType: context.clientType ?? "dashboard",
        });
        await this.safeEvent({
            userId: BigInt(user.id),
            eventType: "mfa_enrollment_completed",
            success: true,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
        });
        return { session, recoveryCodes };
    }

    async startEmailChange(
        userPublicId: string,
        password: string,
        newEmail: string,
        context: SessionContext = {}
    ): Promise<EmailOtpStatus> {
        const user = await this.requireActiveUser(userPublicId);
        if (!user.password_hash) {
            throw new AuthError("Re-enter your password to change email.", 400);
        }
        const { valid } = await verifyPassword(user.password_hash, password);
        if (!valid) {
            throw new AuthError("Current password is incorrect", 401);
        }
        const normalized = normalizeEmail(newEmail);
        if (normalized === user.email) {
            throw new AuthError("That is already your email.", 400);
        }
        const taken = await this.authRepo.findUserByEmail(normalized);
        if (taken) {
            throw new AuthError("Email already registered", 409);
        }
        return this.sendEmailOtp(userPublicId, context, EMAIL_CHANGE_PURPOSE, normalized);
    }

    async confirmEmailChange(
        userPublicId: string,
        code: string,
        context: SessionContext = {},
        currentSessionPublicId?: string
    ): Promise<void> {
        const config = this.requireEmailOtpConfig();
        const user = await this.requireActiveUser(userPublicId);
        const latest = await this.authRepo.findLatestUnconsumedOtpByPurpose(
            BigInt(user.id),
            EMAIL_CHANGE_PURPOSE
        );
        if (!latest) {
            throw new AuthError("No active verification code. Request a new one.", 400);
        }
        if (latest.expires_at.getTime() <= Date.now()) {
            throw new AuthError("Verification code has expired", 400);
        }
        const matches = safeCompareHex(hashOtp(code, config.otpSecret), latest.otp_hash);
        if (!matches) {
            await this.authRepo.incrementOtpAttemptsAtomic(latest.id);
            throw new AuthError("Invalid verification code", 400);
        }
        const consumed = await this.authRepo.consumeOtpAtomic(latest.id);
        if (!consumed) {
            throw new AuthError("Verification code has expired", 400);
        }
        const oldEmail = user.email;
        await this.authRepo.updateEmail(BigInt(user.id), latest.email);
        await this.authRepo.revokeAllUserSessions(
            BigInt(user.id),
            "email_change",
            currentSessionPublicId
        );
        await this.safeEvent({
            userId: BigInt(user.id),
            eventType: "email_changed",
            success: true,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
        });
        try {
            await this.emailOtp?.emailService.sendEmailChangedNotice({
                to: oldEmail,
                newEmail: latest.email,
            });
        } catch {
            // best-effort
        }
    }

    async deleteAccount(
        userPublicId: string,
        password: string,
        context: SessionContext = {}
    ): Promise<void> {
        const user = await this.requireActiveUser(userPublicId);
        if (!user.password_hash) {
            throw new AuthError("Re-enter your password to delete this account.", 400);
        }
        const { valid } = await verifyPassword(user.password_hash, password);
        if (!valid) {
            throw new AuthError("Current password is incorrect", 401);
        }
        await this.authRepo.anonymizeAndDelete(BigInt(user.id));
        await this.safeEvent({
            userId: BigInt(user.id),
            eventType: "account_deleted",
            success: true,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
        });
    }

    private async resolveOAuthIdentity(
        identity: NormalizedIdentity,
        context: SessionContext,
        oauthMeta: { client: OAuthClient; returnTo: string | null }
    ): Promise<
        | { kind: "session"; session: AuthSessionResult }
        | { kind: "complete_profile"; flowToken: string }
    > {
        const existing = await this.authRepo.findIdentity(identity.provider, identity.subject);
        if (existing) {
            const user = await this.authRepo.findUserByPublicId(existing.user.publicId);
            if (!user) {
                throw new AuthError("User not found", 401);
            }
            assertUserUsable(user.is_active, user.account_status);
            await this.authRepo.touchIdentityLogin(existing.id);
            await this.authRepo.touchLastLogin(BigInt(user.id));
            const session = await this.issueSession(user, context);
            await this.safeEvent({
                userId: BigInt(user.id),
                eventType: "oauth_login",
                success: true,
                provider: identity.provider,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
            });
            return { kind: "session", session };
        }

        // Verified provider email may collide with an existing CoreMap account.
        // Never auto-merge; require authenticated Account → Security linking.
        if (identity.email && identity.emailVerified) {
            const emailOwner = await this.authRepo.findUserByEmail(normalizeEmail(identity.email));
            if (emailOwner) {
                throw new AuthError(
                    "That email already belongs to a CoreMap account.",
                    409,
                    "link_required"
                );
            }

            const email = normalizeEmail(identity.email);
            const created = await this.authRepo.createPublicUser({
                email,
                displayName: identity.displayName?.trim() || "CoreMap user",
                passwordHash: null,
                emailVerified: true,
            });
            const createdUser = await this.authRepo.findUserByPublicId(created.public_id);
            if (!createdUser) {
                throw new AuthError("User not found", 500);
            }
            await this.authRepo.createIdentity({
                userId: BigInt(createdUser.id),
                provider: identity.provider,
                providerSubject: identity.subject,
                providerEmail: identity.email,
                providerEmailVerified: identity.emailVerified,
            });
            await this.authRepo.touchLastLogin(BigInt(createdUser.id));
            const session = await this.issueSession(createdUser, context);
            await this.safeEvent({
                userId: BigInt(createdUser.id),
                eventType: "oauth_register",
                success: true,
                provider: identity.provider,
                ipAddress: context.ipAddress,
                userAgent: context.userAgent,
            });
            return { kind: "session", session };
        }

        // No usable verified email (common for Facebook). Never invent placeholder emails.
        const flowToken = randomBytes(32).toString("base64url");
        await this.authRepo.createOAuthPending({
            tokenHash: hashRefreshToken(flowToken),
            provider: identity.provider,
            providerSubject: identity.subject,
            providerName: identity.displayName,
            providerEmail: identity.email,
            providerEmailVerified: identity.emailVerified,
            client: oauthMeta.client,
            returnTo: oauthMeta.returnTo,
            expiresAt: new Date(Date.now() + OAUTH_PENDING_TTL_MS),
        });
        await this.safeEvent({
            eventType: "oauth_pending_created",
            success: true,
            provider: identity.provider,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
        });
        return { kind: "complete_profile", flowToken };
    }

    private async requireActiveOAuthPending(flowToken: string) {
        const token = flowToken?.trim();
        if (!token || token.length < 20) {
            throw new AuthError("This sign-up step expired. Start again.", 400, "oauth_expired");
        }
        const pending = await this.authRepo.findActiveOAuthPendingByTokenHash(
            hashRefreshToken(token)
        );
        if (!pending) {
            throw new AuthError("This sign-up step expired. Start again.", 400, "oauth_expired");
        }
        return pending;
    }

    private requireEmailOtpConfig(): EmailOtpDeps & { otpSecret: string } {
        if (!this.emailOtp || !this.emailOtp.otpSecret) {
            throw new AuthError("Email verification is not configured", 503);
        }
        return { ...this.emailOtp, otpSecret: this.emailOtp.otpSecret };
    }

    private async loadVerificationUser(userPublicId: string) {
        const user = await this.authRepo.findVerificationUserByPublicId(userPublicId);
        if (!user) {
            throw new AuthError("User not found", 401);
        }
        assertUserUsable(user.is_active, user.account_status);
        return user;
    }

    private assertProviderEnabled(provider: OAuthProviderName): void {
        if (provider === "facebook" && !isFacebookOAuthEnabled()) {
            throw new AuthError(
                "Facebook sign-in is not available in this release.",
                403,
                "feature_disabled"
            );
        }
    }

    private async requireActiveUser(userPublicId: string): Promise<AuthUserRecord> {
        const user = await this.authRepo.findUserByPublicId(userPublicId);
        if (!user) {
            throw new AuthError("User not found", 401);
        }
        assertUserUsable(user.is_active, user.account_status);
        return user;
    }

    private async issueSession(user: AuthUserRecord, context: SessionContext): Promise<AuthSessionResult> {
        const refreshToken = generateRefreshToken();
        const clientType: AuthClientType = context.clientType ?? "web";
        const created = await this.authRepo.createSession({
            userId: BigInt(user.id),
            refreshTokenHash: hashRefreshToken(refreshToken),
            expiresAt: refreshTokenExpiry(),
            idleExpiresAt: idleExpiry(),
            absoluteExpiresAt: absoluteExpiry(),
            userAgent: context.userAgent ?? null,
            ipAddress: context.ipAddress ?? null,
            clientType,
        });
        return {
            user: toUserResponse(user),
            accessTokenClaims: toAccessTokenClaims(user, created.public_id),
            refreshToken,
        };
    }

    private async safeEvent(input: {
        userId?: bigint | null;
        eventType: string;
        success: boolean;
        provider?: string | null;
        ipAddress?: string | null;
        userAgent?: string | null;
        metadata?: Prisma.InputJsonValue;
    }): Promise<void> {
        try {
            await this.authRepo.recordSecurityEvent(input);
        } catch {
            // Security events must never break login/logout.
        }
    }
}

function assertUserUsable(isActive: boolean, accountStatus: string): void {
    if (!isActive || accountStatus !== "active") {
        throw new AuthError("User account is inactive", 403);
    }
}

function toUserResponse(user: {
    public_id: string;
    email: string;
    display_name: string;
    roles: string[];
}): AuthUserResponse {
    return {
        public_id: user.public_id,
        email: user.email,
        display_name: user.display_name,
        roles: user.roles,
    };
}

function toAccessTokenClaims(
    user: { public_id: string; email: string; roles: string[] },
    sessionPublicId: string
): AccessTokenClaims {
    return {
        sub: user.public_id,
        email: user.email,
        roles: user.roles,
        sid: sessionPublicId,
    };
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function assertDeliverableEmail(email: string): void {
    if (!email.includes("@") || email.endsWith(".invalid") || email.includes("noreply.coremapmm")) {
        throw new AuthError("Enter a valid email address", 400);
    }
}

function normalizeLoginEmail(credentials: { email?: string; username?: string }): string {
    if (credentials.username) {
        return `${credentials.username.trim().toLowerCase()}@demo.local`;
    }
    return normalizeEmail(credentials.email!);
}

function normalizeRecoveryCode(code: string): string {
    return code.replace(/\s+/g, "").toLowerCase();
}

function parseOAuthCookie(raw: string | null): {
    state: string;
    codeVerifier: string | null;
    nonce: string | null;
} | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as {
            state?: string;
            codeVerifier?: string | null;
            nonce?: string | null;
        };
        if (!parsed.state) return null;
        return {
            state: parsed.state,
            codeVerifier: parsed.codeVerifier ?? null,
            nonce: parsed.nonce ?? null,
        };
    } catch {
        return null;
    }
}

export function deviceLabel(userAgent: string | null): string {
    if (!userAgent) return "Unknown device";
    const browser = userAgent.includes("Edg")
        ? "Edge"
        : userAgent.includes("Chrome")
          ? "Chrome"
          : userAgent.includes("Firefox")
            ? "Firefox"
            : userAgent.includes("Safari")
              ? "Safari"
              : "Browser";
    const os = userAgent.includes("Android")
        ? "Android"
        : userAgent.includes("iPhone") || userAgent.includes("iPad")
          ? "iOS"
          : userAgent.includes("Mac")
            ? "macOS"
            : userAgent.includes("Windows")
              ? "Windows"
              : userAgent.includes("Linux")
                ? "Linux"
                : "Unknown OS";
    return `${browser} on ${os}`;
}

export { FAMILY_REUSE_GRACE_MS };
