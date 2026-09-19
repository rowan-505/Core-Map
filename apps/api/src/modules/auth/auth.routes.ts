import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { getApiEnv, getOAuthProviderCapabilities } from "../../config/env.js";
import { createEmailService } from "../email/email.service.js";
import { DEV_AUTH_BYPASS_USER, isAuthBypassActive } from "../../plugins/auth.js";
import { resolveBrowserLoginClientType } from "./auth-client.js";
import { AuthError, AuthService, type AuthSessionResult } from "./auth.service.js";
import { AuthRepository, type AuthUserProfile } from "./auth.repo.js";
import { PasswordPolicyError } from "./password-policy.js";
import {
    changeEmailBodySchema,
    changePasswordBodySchema,
    completeProfileSendOtpBodySchema,
    completeProfileVerifyBodySchema,
    confirmEmailChangeBodySchema,
    deleteAccountBodySchema,
    emailOtpStatusResponseSchema,
    enrollMfaVerifyBodySchema,
    mfaEnrollmentCompleteBodySchema,
    mfaEnrollmentTokenBodySchema,
    forgotPasswordBodySchema,
    loginBodySchema,
    logoutBodySchema,
    logoutResponseSchema,
    refreshBodySchema,
    registerBodySchema,
    registerResponseSchema,
    resetPasswordBodySchema,
    sessionResponseSchema,
    updateProfileBodySchema,
    verifyEmailOtpBodySchema,
    verifyMfaBodySchema,
} from "./auth.schema.js";
import {
    getMeSchema,
    patchMeProfileSchema,
    postAuthLoginSchema,
    postAuthLogoutSchema,
    postAuthRefreshSchema,
    postAuthRegisterSchema,
    postAuthSendOtpSchema,
    postAuthVerifyOtpSchema,
} from "./auth.openapi.js";
import { ACCESS_TOKEN_TTL } from "./refresh-token.js";
import {
    assertCookieMutationCsrf,
    assertLoginCsrfOrigin,
    clearOauthStateCookie,
    clearRefreshCookie,
    isBrowserCredentialedRequest,
    readOauthStateCookie,
    readRefreshCookie,
    REFRESH_COOKIE_MAX_AGE_SECONDS,
    setOauthStateCookie,
    setRefreshCookie,
} from "./session-cookie.js";
import type { OAuthClient } from "./oauth/types.js";

const MFA_TOKEN_TTL = "5m";

function sessionContext(request: FastifyRequest) {
    return {
        userAgent: request.headers["user-agent"] ?? null,
        ipAddress: request.ip ?? null,
        // Trusted Origin → client_type. Never take client_type from request body.
        clientType: resolveBrowserLoginClientType(dashboardOrigin(request)),
    };
}

async function issueAccessToken(reply: FastifyReply, result: AuthSessionResult): Promise<string> {
    return reply.jwtSign({ ...result.accessTokenClaims, jti: crypto.randomUUID() }, {
        expiresIn: ACCESS_TOKEN_TTL,
    });
}

function applyRefreshCookie(reply: FastifyReply, refreshToken: string): void {
    setRefreshCookie(reply, refreshToken, REFRESH_COOKIE_MAX_AGE_SECONDS());
}

function sessionJson(request: FastifyRequest, accessToken: string, result: AuthSessionResult) {
    const browser = isBrowserCredentialedRequest(request);
    return sessionResponseSchema.parse({
        accessToken,
        ...(browser ? {} : { refreshToken: result.refreshToken }),
        expiresIn: ACCESS_TOKEN_TTL,
        user: browser ? result.user : { ...result.user, id: result.user.public_id },
    });
}

function resolveRefreshToken(request: FastifyRequest, bodyToken?: string): string | null {
    return bodyToken || readRefreshCookie(request);
}

function dashboardOrigin(request: FastifyRequest): boolean {
    const origin = request.headers.origin;
    if (!origin) return false;
    const dashboard = getApiEnv().auth.dashboardAppUrl;
    return Boolean(dashboard && origin.replace(/\/+$/, "") === dashboard);
}

function oauthRedirectBase(client: OAuthClient): string {
    const env = getApiEnv().auth;
    if (client === "dashboard") {
        return `${env.dashboardAppUrl ?? "http://localhost:3000"}/login`;
    }
    return env.webAppUrl ?? "http://localhost:5173";
}

function oauthErrorRedirect(client: OAuthClient, code: string): string {
    const base = oauthRedirectBase(client);
    const url = new URL(base);
    if (client === "web") {
        return `${getApiEnv().auth.webAppUrl ?? "http://localhost:5173"}/auth/callback?error=${encodeURIComponent(code)}`;
    }
    url.searchParams.set("error", code);
    return url.toString();
}

/** Pass MFA challenge via URL hash so the token is less likely to hit server logs / Referer. */
function oauthMfaRedirect(mfaToken: string, returnTo: string | null): string {
    const base = oauthRedirectBase("dashboard");
    const url = new URL(base);
    if (returnTo) {
        try {
            const next = new URL(returnTo);
            const dashboard = getApiEnv().auth.dashboardAppUrl ?? "http://localhost:3000";
            if (next.origin === new URL(dashboard).origin) {
                url.searchParams.set("next", `${next.pathname}${next.search}`);
            }
        } catch {
            // ignore invalid returnTo
        }
    }
    url.hash = `mfa_token=${encodeURIComponent(mfaToken)}`;
    return url.toString();
}

function oauthCompleteProfileRedirect(flowToken: string): string {
    const web = getApiEnv().auth.webAppUrl ?? "http://localhost:5173";
    const url = new URL("/auth/complete-profile", web);
    url.searchParams.set("flow", flowToken);
    return url.toString();
}

function oauthLinkSuccessRedirect(provider: string, returnTo: string | null): string {
    const fallback = `${getApiEnv().auth.webAppUrl ?? "http://localhost:5173"}/account/security`;
    try {
        const url = new URL(returnTo || fallback);
        url.searchParams.set("linked", provider);
        return url.toString();
    } catch {
        return `${fallback}?linked=${encodeURIComponent(provider)}`;
    }
}

function handleAuthError(error: unknown, reply: FastifyReply): FastifyReply {
    if (error instanceof AuthError) {
        return reply.code(error.statusCode).send({ message: error.message, code: error.code });
    }
    if (error instanceof PasswordPolicyError) {
        return reply.code(400).send({ message: error.message, code: "password_policy" });
    }
    if (
        error instanceof Error &&
        "statusCode" in error &&
        typeof (error as { statusCode?: unknown }).statusCode === "number"
    ) {
        const statusCode = (error as { statusCode: number }).statusCode;
        const maybeCode = (error as { code?: unknown }).code;
        const code = typeof maybeCode === "string" ? maybeCode : undefined;
        return reply.code(statusCode).send({ message: error.message, code });
    }
    throw error;
}

function validationError(reply: FastifyReply, parsed: { error: { flatten: () => unknown; issues: { message: string }[] } }) {
    const first = parsed.error.issues[0]?.message ?? "Invalid payload";
    return reply.code(400).send({
        message: first,
        code: "validation_error",
        issues: parsed.error.flatten(),
    });
}

function devBypassProfile(): AuthUserProfile {
    return {
        public_id: DEV_AUTH_BYPASS_USER.sub,
        email: DEV_AUTH_BYPASS_USER.email,
        display_name: "Development Admin",
        phone: null,
        roles: DEV_AUTH_BYPASS_USER.roles,
        email_verified: true,
        account_status: "active",
        primary_region_id: null,
        preferred_language: "my",
        total_points: 0,
    };
}

const authRoutes: FastifyPluginAsync = async (app) => {
    const authRepo = new AuthRepository(app.prisma);
    const emailEnv = getApiEnv().email;
    const rl = getApiEnv().authRateLimit;
    const ipRateLimit = (max: number) => ({ rateLimit: { max, timeWindow: rl.windowMs } });
    const authService = new AuthService(authRepo, {
        emailService: createEmailService(),
        otpSecret: emailEnv.otpSecret,
        ttlMinutes: emailEnv.otpTtlMinutes,
        maxAttempts: emailEnv.otpMaxAttempts,
    });

    app.post(
        "/auth/register",
        { schema: postAuthRegisterSchema, config: ipRateLimit(rl.register) },
        async (request, reply) => {
            const parsed = registerBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid registration payload",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                const user = await authService.register({
                    email: parsed.data.email,
                    displayName: parsed.data.displayName,
                    password: parsed.data.password,
                    preferredLanguage: parsed.data.preferredLanguage,
                    primaryRegionId: parsed.data.primaryRegionId,
                });
                return reply.code(201).send(registerResponseSchema.parse({ message: "Account created", user }));
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.post(
        "/auth/login",
        { schema: postAuthLoginSchema, config: ipRateLimit(rl.login) },
        async (request, reply) => {
            const parsed = loginBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid login payload",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                assertLoginCsrfOrigin(request);
                const outcome = await authService.login(
                    { email: parsed.data.email, username: parsed.data.username },
                    parsed.data.password,
                    sessionContext(request),
                    { requireDashboard: dashboardOrigin(request) }
                );
                if (outcome.kind === "mfa") {
                    const mfaToken = await reply.jwtSign(outcome.mfaClaims, { expiresIn: MFA_TOKEN_TTL });
                    return reply.send({ mfaRequired: true, mfaToken, expiresIn: MFA_TOKEN_TTL });
                }
                if (outcome.kind === "mfa_enrollment_required") {
                    const enrollmentToken = await reply.jwtSign(outcome.enrollmentClaims, {
                        expiresIn: MFA_TOKEN_TTL,
                    });
                    return reply.send({
                        mfaEnrollmentRequired: true,
                        enrollmentToken,
                        expiresIn: MFA_TOKEN_TTL,
                    });
                }
                applyRefreshCookie(reply, outcome.session.refreshToken);
                const accessToken = await issueAccessToken(reply, outcome.session);
                return reply.send(sessionJson(request, accessToken, outcome.session));
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.post(
        "/auth/refresh",
        { schema: postAuthRefreshSchema, config: ipRateLimit(rl.refresh) },
        async (request, reply) => {
            const parsed = refreshBodySchema.safeParse(request.body ?? {});
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid refresh payload",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                assertCookieMutationCsrf(request);
                const token = resolveRefreshToken(request, parsed.data.refreshToken);
                if (!token) {
                    return reply.code(401).send({ message: "Invalid or expired refresh token" });
                }
                const result = await authService.refresh(token, sessionContext(request));
                applyRefreshCookie(reply, result.refreshToken);
                const accessToken = await issueAccessToken(reply, result);
                return reply.send(sessionJson(request, accessToken, result));
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.post(
        "/auth/logout",
        { schema: postAuthLogoutSchema, config: ipRateLimit(rl.refresh) },
        async (request, reply) => {
            const parsed = logoutBodySchema.safeParse(request.body ?? {});
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid logout payload",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                assertCookieMutationCsrf(request);
            } catch (error) {
                return handleAuthError(error, reply);
            }
            const token = resolveRefreshToken(request, parsed.data.refreshToken);
            await authService.logout(token);
            clearRefreshCookie(reply);
            return reply.send(logoutResponseSchema.parse({ message: "Logged out" }));
        }
    );

    app.post(
        "/auth/password/forgot",
        { config: ipRateLimit(rl.forgotPassword) },
        async (request, reply) => {
            const parsed = forgotPasswordBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ message: "Invalid payload" });
            }
            try {
                await authService.forgotPassword(parsed.data.email, sessionContext(request));
                return reply.send({ message: "If that email is registered, a reset link is on its way." });
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.post(
        "/auth/password/reset",
        { config: ipRateLimit(rl.resetPassword) },
        async (request, reply) => {
            const parsed = resetPasswordBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ message: "Invalid payload", issues: parsed.error.flatten() });
            }
            try {
                await authService.resetPassword(
                    parsed.data.token,
                    parsed.data.password,
                    sessionContext(request)
                );
                return reply.send({ message: "Password updated" });
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.post(
        "/auth/mfa/verify",
        { config: ipRateLimit(rl.sensitiveAccount) },
        async (request, reply) => {
            const parsed = verifyMfaBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ message: "Invalid payload" });
            }
            try {
                const claims = app.jwt.verify<{ sub: string; purpose?: string }>(parsed.data.mfaToken);
                if (claims.purpose !== "mfa" || !claims.sub) {
                    return reply.code(401).send({ message: "Invalid or expired MFA token" });
                }
                const result = await authService.verifyMfa(
                    claims.sub,
                    parsed.data.code,
                    sessionContext(request)
                );
                applyRefreshCookie(reply, result.refreshToken);
                const accessToken = await issueAccessToken(reply, result);
                return reply.send(sessionJson(request, accessToken, result));
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    for (const provider of ["google", "facebook"] as const) {
        app.get(
            `/auth/oauth/${provider}/start`,
            { config: ipRateLimit(rl.oauthStart) },
            async (request, reply) => {
                const query = request.query as { client?: string; return_to?: string };
                const client: OAuthClient = query.client === "dashboard" ? "dashboard" : "web";
                try {
                    const started = await authService.startOAuth(provider, {
                        client,
                        returnTo: query.return_to ?? null,
                    });
                    setOauthStateCookie(reply, started.cookiePayload);
                    return reply.redirect(started.authorizationUrl);
                } catch (error) {
                    if (error instanceof AuthError) {
                        return reply.redirect(oauthErrorRedirect(client, error.code ?? "auth_failed"));
                    }
                    throw error;
                }
            }
        );

        app.get(
            `/auth/oauth/${provider}/link`,
            {
                preHandler: app.authenticate,
                config: ipRateLimit(rl.oauthStart),
            },
            async (request, reply) => {
                const query = request.query as { return_to?: string };
                try {
                    const started = await authService.startOAuthLink(provider, {
                        userPublicId: request.user.sub,
                        sessionPublicId: request.user.sid ?? "",
                        returnTo: query.return_to ?? null,
                    });
                    setOauthStateCookie(reply, started.cookiePayload);
                    return reply.redirect(started.authorizationUrl);
                } catch (error) {
                    if (error instanceof AuthError) {
                        return reply.redirect(
                            oauthErrorRedirect("web", error.code ?? "auth_failed")
                        );
                    }
                    throw error;
                }
            }
        );

        app.get(`/auth/oauth/${provider}/callback`, async (request, reply) => {
            const query = request.query as { code?: string; state?: string; error?: string };
            const cookiePayload = readOauthStateCookie(request);
            const fallbackClient: OAuthClient = "web";
            clearOauthStateCookie(reply);
            if (query.error || !query.code || !query.state) {
                return reply.redirect(oauthErrorRedirect(fallbackClient, "auth_failed"));
            }
            try {
                const completed = await authService.completeOAuth(provider, {
                    code: query.code,
                    state: query.state,
                    cookiePayload,
                    refreshToken: readRefreshCookie(request),
                    context: sessionContext(request),
                });
                if (completed.kind === "linked") {
                    return reply.redirect(
                        oauthLinkSuccessRedirect(completed.provider, completed.returnTo)
                    );
                }
                if (completed.kind === "complete_profile") {
                    return reply.redirect(oauthCompleteProfileRedirect(completed.flowToken));
                }
                if (completed.kind === "mfa") {
                    const mfaToken = await reply.jwtSign(completed.mfaClaims, {
                        expiresIn: MFA_TOKEN_TTL,
                    });
                    return reply.redirect(oauthMfaRedirect(mfaToken, completed.returnTo));
                }
                applyRefreshCookie(reply, completed.session.refreshToken);
                const dest =
                    completed.returnTo ||
                    (completed.client === "dashboard"
                        ? oauthRedirectBase("dashboard")
                        : getApiEnv().auth.webAppUrl ?? "http://localhost:5173");
                return reply.redirect(dest);
            } catch (error) {
                const code = error instanceof AuthError ? error.code ?? "auth_failed" : "auth_failed";
                const client =
                    error instanceof AuthError && error.code === "dashboard_forbidden"
                        ? "dashboard"
                        : fallbackClient;
                return reply.redirect(oauthErrorRedirect(client, code));
            }
        });
    }

    app.get("/auth/providers", async (_request, reply) => {
        return reply.send({ providers: getOAuthProviderCapabilities() });
    });

    app.get(
        "/auth/identities",
        { preHandler: app.authenticate },
        async (request, reply) => {
            try {
                const result = await authService.listConnectedProviders(request.user.sub);
                return reply.send(result);
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.delete(
        "/auth/identities/:provider",
        {
            preHandler: app.authenticate,
            config: ipRateLimit(rl.sensitiveAccount),
        },
        async (request, reply) => {
            const params = request.params as { provider?: string };
            const provider = params.provider === "facebook" ? "facebook" : params.provider === "google" ? "google" : null;
            if (!provider) {
                return reply.code(400).send({ message: "Unsupported provider" });
            }
            const body = (request.body ?? {}) as { password?: string };
            try {
                await authService.unlinkProvider(request.user.sub, provider, {
                    password: body.password ?? null,
                    context: sessionContext(request),
                });
                return reply.send({ message: "Provider disconnected" });
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.post(
        "/auth/oauth/complete-profile/send-otp",
        { config: ipRateLimit(rl.sendOtp) },
        async (request, reply) => {
            const parsed = completeProfileSendOtpBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid payload",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                const result = await authService.sendCompleteProfileOtp(
                    parsed.data.flowToken,
                    parsed.data.email,
                    sessionContext(request)
                );
                return reply.send(emailOtpStatusResponseSchema.parse(result));
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.post(
        "/auth/oauth/complete-profile/verify",
        { config: ipRateLimit(rl.verifyOtp) },
        async (request, reply) => {
            const parsed = completeProfileVerifyBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid payload",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                const result = await authService.verifyCompleteProfile(
                    parsed.data.flowToken,
                    parsed.data.email,
                    parsed.data.code,
                    sessionContext(request)
                );
                if (result.kind === "existing_account_link_required") {
                    return reply.code(409).send({
                        message:
                            "This email already belongs to a CoreMap account. Sign in to that account first, then connect Facebook from Account → Security.",
                        code: "existing_account_link_required",
                    });
                }
                applyRefreshCookie(reply, result.session.refreshToken);
                const accessToken = await issueAccessToken(reply, result.session);
                return reply.send(sessionJson(request, accessToken, result.session));
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.post(
        "/auth/email/send-otp",
        {
            preHandler: app.authenticate,
            schema: postAuthSendOtpSchema,
            config: ipRateLimit(rl.sendOtp),
        },
        async (request, reply) => {
            if (isAuthBypassActive()) {
                return reply.send(emailOtpStatusResponseSchema.parse({ status: "already_verified" }));
            }
            try {
                const result = await authService.sendEmailOtp(request.user.sub, sessionContext(request));
                return reply.send(emailOtpStatusResponseSchema.parse(result));
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.post(
        "/auth/email/verify-otp",
        {
            preHandler: app.authenticate,
            schema: postAuthVerifyOtpSchema,
            config: ipRateLimit(rl.verifyOtp),
        },
        async (request, reply) => {
            if (isAuthBypassActive()) {
                return reply.send(emailOtpStatusResponseSchema.parse({ status: "already_verified" }));
            }
            const parsed = verifyEmailOtpBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid verification payload",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                const result = await authService.verifyEmailOtp(
                    request.user.sub,
                    parsed.data.code,
                    sessionContext(request)
                );
                return reply.send(emailOtpStatusResponseSchema.parse(result));
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.get("/auth/me", { preHandler: app.authenticate, schema: getMeSchema }, async (request, reply) => {
        if (isAuthBypassActive()) {
            return reply.send(devBypassProfile());
        }
        try {
            return reply.send(await authService.getMe(request.user.sub));
        } catch (error) {
            return handleAuthError(error, reply);
        }
    });

    app.patch(
        "/me/profile",
        { preHandler: app.authenticate, schema: patchMeProfileSchema },
        async (request, reply) => {
            if (isAuthBypassActive()) {
                return reply.send(devBypassProfile());
            }
            const parsed = updateProfileBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({
                    message: "Invalid profile payload",
                    issues: parsed.error.flatten(),
                });
            }
            try {
                const updated = await authService.updateProfile(request.user.sub, {
                    displayName: parsed.data.displayName,
                    phone: parsed.data.phone,
                    preferredLanguage: parsed.data.preferredLanguage,
                    primaryRegionId:
                        parsed.data.primaryRegionId === undefined
                            ? undefined
                            : parsed.data.primaryRegionId === null
                              ? null
                              : BigInt(parsed.data.primaryRegionId),
                });
                return reply.send(updated);
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.get("/auth/sessions", { preHandler: app.authenticate }, async (request, reply) => {
        try {
            return reply.send({ sessions: await authService.listSessions(request.user.sub, request.user.sid) });
        } catch (error) {
            return handleAuthError(error, reply);
        }
    });

    app.delete("/auth/sessions/:publicId", { preHandler: app.authenticate }, async (request, reply) => {
        const publicId = (request.params as { publicId: string }).publicId;
        try {
            await authService.revokeSession(request.user.sub, publicId);
            return reply.send({ message: "Session revoked" });
        } catch (error) {
            return handleAuthError(error, reply);
        }
    });

    app.post("/auth/sessions/revoke-others", { preHandler: app.authenticate }, async (request, reply) => {
        if (!request.user.sid) {
            return reply.code(400).send({ message: "Current session is unknown" });
        }
        try {
            await authService.revokeOtherSessions(request.user.sub, request.user.sid);
            return reply.send({ message: "Other sessions revoked" });
        } catch (error) {
            return handleAuthError(error, reply);
        }
    });

    app.get("/auth/security-events", { preHandler: app.authenticate }, async (request, reply) => {
        try {
            return reply.send({ events: await authService.listSecurityEvents(request.user.sub) });
        } catch (error) {
            return handleAuthError(error, reply);
        }
    });

    app.post(
        "/auth/password/change",
        { preHandler: app.authenticate, config: ipRateLimit(rl.sensitiveAccount) },
        async (request, reply) => {
            const parsed = changePasswordBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return validationError(reply, parsed);
            }
            try {
                await authService.changePassword(
                    request.user.sub,
                    parsed.data.currentPassword,
                    parsed.data.newPassword,
                    request.user.sid,
                    sessionContext(request)
                );
                return reply.send({ message: "Password updated" });
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.post(
        "/auth/mfa/enroll",
        { preHandler: [app.authenticate, app.requireRole("admin", "super_admin")], config: ipRateLimit(rl.sensitiveAccount) },
        async (request, reply) => {
            try {
                return reply.send(await authService.enrollMfaStart(request.user.sub));
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.post(
        "/auth/mfa/enroll/verify",
        { preHandler: [app.authenticate, app.requireRole("admin", "super_admin")], config: ipRateLimit(rl.sensitiveAccount) },
        async (request, reply) => {
            const parsed = enrollMfaVerifyBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ message: "Invalid payload" });
            }
            try {
                return reply.send(await authService.enrollMfaVerify(request.user.sub, parsed.data.code));
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    // Restricted MFA enrollment for super_admin users who do not yet have MFA.
    // Enrollment JWT only — never a full access session until TOTP verifies.
    app.post(
        "/auth/mfa/enroll/bootstrap",
        { config: ipRateLimit(rl.sensitiveAccount) },
        async (request, reply) => {
            const parsed = mfaEnrollmentTokenBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ message: "Invalid payload" });
            }
            try {
                const claims = app.jwt.verify<{ sub: string; purpose?: string }>(
                    parsed.data.enrollmentToken
                );
                if (claims.purpose !== "mfa_enroll" || !claims.sub) {
                    return reply.code(401).send({ message: "Invalid or expired enrollment token" });
                }
                return reply.send(await authService.enrollMfaStart(claims.sub));
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.post(
        "/auth/mfa/enroll/bootstrap/verify",
        { config: ipRateLimit(rl.sensitiveAccount) },
        async (request, reply) => {
            const parsed = mfaEnrollmentCompleteBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ message: "Invalid payload" });
            }
            try {
                const claims = app.jwt.verify<{ sub: string; purpose?: string }>(
                    parsed.data.enrollmentToken
                );
                if (claims.purpose !== "mfa_enroll" || !claims.sub) {
                    return reply.code(401).send({ message: "Invalid or expired enrollment token" });
                }
                const completed = await authService.completeMfaEnrollmentBootstrap(
                    claims.sub,
                    parsed.data.code,
                    sessionContext(request)
                );
                applyRefreshCookie(reply, completed.session.refreshToken);
                const accessToken = await issueAccessToken(reply, completed.session);
                return reply.send({
                    ...sessionJson(request, accessToken, completed.session),
                    recoveryCodes: completed.recoveryCodes,
                });
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.post(
        "/auth/email/change",
        { preHandler: app.authenticate, config: ipRateLimit(rl.sensitiveAccount) },
        async (request, reply) => {
            const parsed = changeEmailBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return validationError(reply, parsed);
            }
            try {
                const result = await authService.startEmailChange(
                    request.user.sub,
                    parsed.data.password,
                    parsed.data.newEmail,
                    sessionContext(request)
                );
                return reply.send(result);
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.post(
        "/auth/email/change/confirm",
        { preHandler: app.authenticate, config: ipRateLimit(rl.verifyOtp) },
        async (request, reply) => {
            const parsed = confirmEmailChangeBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return validationError(reply, parsed);
            }
            try {
                await authService.confirmEmailChange(
                    request.user.sub,
                    parsed.data.code,
                    sessionContext(request),
                    request.user.sid
                );
                return reply.send({ message: "Email updated" });
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );

    app.post(
        "/auth/account/delete",
        { preHandler: app.authenticate, config: ipRateLimit(rl.sensitiveAccount) },
        async (request, reply) => {
            const parsed = deleteAccountBodySchema.safeParse(request.body);
            if (!parsed.success) {
                return reply.code(400).send({ message: "Type DELETE to confirm." });
            }
            try {
                await authService.deleteAccount(
                    request.user.sub,
                    parsed.data.password,
                    sessionContext(request)
                );
                clearRefreshCookie(reply);
                return reply.send({ message: "Account deleted" });
            } catch (error) {
                return handleAuthError(error, reply);
            }
        }
    );
};

export default authRoutes;
