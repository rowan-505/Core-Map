import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";

import { AuthRepository } from "../modules/auth/auth.repo.js";

export type JwtUser = {
    sub: string;
    id?: string;
    email: string;
    roles: string[];
    sid?: string;
    jti?: string;
};

/** Dashboard login/read. `user` and `surveyor` authenticate but are not dashboard roles. */
export const DASHBOARD_ACCESS_ROLES = new Set(["viewer", "admin", "super_admin"]);
/** Canonical dashboard/transport writes. `surveyor` must never be added here. */
export const DASHBOARD_WRITE_ROLES = new Set(["admin", "super_admin"]);

/** Field-report review/apply permission — same gate as dashboard writes today. */
export const REPORTS_REVIEW_ROLES = DASHBOARD_WRITE_ROLES;

export function canReviewReports(roles: readonly string[] | null | undefined): boolean {
    return (roles ?? []).some((role) => REPORTS_REVIEW_ROLES.has(role));
}

export async function requireReportsReview(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void | FastifyReply> {
    if (!canReviewReports(request.user?.roles)) {
        return reply.code(403).send({
            code: "FORBIDDEN",
            message: "Report review requires an administrator role.",
        });
    }
}

/** JWT role for the field survey app. Least privilege: no dashboard or transport writes. */
export const FIELD_SURVEYOR_ROLE = "surveyor";

export function hasFieldSurveyorAccess(roles: readonly string[] | null | undefined): boolean {
    return (roles ?? []).includes(FIELD_SURVEYOR_ROLE);
}

export async function requireFieldSurveyor(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void | FastifyReply> {
    if (!hasFieldSurveyorAccess(request.user?.roles)) {
        return reply.code(403).send({
            code: "FORBIDDEN",
            message: "Field survey access requires the surveyor role.",
        });
    }
}

/** Managers for survey assignments = dashboard write roles (admin / super_admin). */
export function canManageSurveyAssignments(roles: readonly string[] | null | undefined): boolean {
    return canDashboardWrite(roles);
}

export function canAccessSurveyAssignments(roles: readonly string[] | null | undefined): boolean {
    return hasFieldSurveyorAccess(roles) || canManageSurveyAssignments(roles);
}

export async function requireSurveyAssignmentAccess(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void | FastifyReply> {
    if (!canAccessSurveyAssignments(request.user?.roles)) {
        return reply.code(403).send({
            code: "FORBIDDEN",
            message: "Survey assignments require the surveyor or administrator role.",
        });
    }
}

export async function requireSurveyAssignmentManage(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void | FastifyReply> {
    if (!canManageSurveyAssignments(request.user?.roles)) {
        return reply.code(403).send({
            code: "FORBIDDEN",
            message: "Managing survey assignments requires an administrator role.",
        });
    }
}

export function hasDashboardAccess(roles: readonly string[] | null | undefined): boolean {
    return (roles ?? []).some((role) => DASHBOARD_ACCESS_ROLES.has(role));
}

export function canDashboardWrite(roles: readonly string[] | null | undefined): boolean {
    return (roles ?? []).some((role) => DASHBOARD_WRITE_ROLES.has(role));
}

export async function requireDashboardAccess(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void | FastifyReply> {
    if (!hasDashboardAccess(request.user?.roles)) {
        return reply.code(403).send({
            code: "FORBIDDEN",
            message: "Dashboard access requires a dashboard role.",
        });
    }
}

export async function requireDashboardWrite(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void | FastifyReply> {
    if (!canDashboardWrite(request.user?.roles)) {
        const readOnly = request.user?.roles?.includes("viewer") ?? false;
        return reply.code(403).send({
            code: readOnly ? "READ_ONLY" : "FORBIDDEN",
            message: readOnly
                ? "Read-only dashboard access cannot modify data."
                : "Dashboard write access requires an administrator role.",
        });
    }
}

export const DEV_AUTH_BYPASS_USER: JwtUser = {
    id: "dev-admin",
    sub: "dev-admin",
    email: "dev@local",
    roles: ["admin"],
};

/**
 * Raw flag check. AUTH_BYPASS is a dev-only convenience; production safety is
 * enforced by {@link assertAuthBypassNotInProduction} (fail-fast at startup) and
 * by {@link isAuthBypassActive} (inert at request time in production).
 */
export function isAuthBypassEnabled() {
    return process.env.AUTH_BYPASS === "true";
}

/** True only when bypass is requested AND we are not in production. */
export function isAuthBypassActive() {
    return isAuthBypassEnabled() && process.env.NODE_ENV !== "production";
}

/**
 * Hard production safety guard: AUTH_BYPASS short-circuits JWT verification and
 * must never be active in production. Fail fast at startup instead of silently
 * shipping an open API.
 */
export function assertAuthBypassNotInProduction(): void {
    if (process.env.NODE_ENV === "production" && isAuthBypassEnabled()) {
        throw new Error(
            "AUTH_BYPASS=true is not allowed when NODE_ENV=production. Unset AUTH_BYPASS."
        );
    }
}

declare module "@fastify/jwt" {
    interface FastifyJWT {
        payload: JwtUser;
        user: JwtUser;
    }
}

declare module "fastify" {
    interface FastifyInstance {
        authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        requireDashboardAccess: typeof requireDashboardAccess;
        requireDashboardWrite: typeof requireDashboardWrite;
        requireFieldSurveyor: typeof requireFieldSurveyor;
        requireReportsReview: typeof requireReportsReview;
        requireSurveyAssignmentAccess: typeof requireSurveyAssignmentAccess;
        requireSurveyAssignmentManage: typeof requireSurveyAssignmentManage;
        requireRole: (
            ...allowedRoles: string[]
        ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void | FastifyReply>;
    }
}

function jwtIssuer(): string {
    return (
        process.env.AUTH_JWT_ISS?.replace(/\/+$/, "") ||
        process.env.API_PUBLIC_URL?.replace(/\/+$/, "") ||
        "http://localhost:3001"
    );
}

function jwtAudience(): string {
    return process.env.AUTH_JWT_AUD?.trim() || "coremap";
}

function jwtSecret(): string {
    const secret = process.env.AUTH_JWT_SECRET?.trim() || process.env.JWT_SECRET?.trim();
    if (!secret) {
        throw new Error("AUTH_JWT_SECRET or JWT_SECRET is required");
    }
    return secret;
}

export default fp(async function authPlugin(app) {
    assertAuthBypassNotInProduction();

    const secret = jwtSecret();
    const iss = jwtIssuer();
    const aud = jwtAudience();

    await app.register(fastifyJwt, {
        secret,
        sign: {
            algorithm: "HS256",
            iss,
            aud,
        },
        verify: {
            algorithms: ["HS256"],
            allowedIss: iss,
            allowedAud: aud,
        },
        decode: { complete: false },
        formatUser: (payload) => {
            const raw = payload as JwtUser & { jti?: string };
            return {
                sub: raw.sub,
                id: raw.id,
                email: raw.email,
                roles: Array.isArray(raw.roles) ? raw.roles : [],
                sid: raw.sid,
                jti: raw.jti,
            };
        },
    });

    app.decorate("authenticate", async function authenticate(request, reply) {
        if (isAuthBypassActive()) {
            request.user = { ...DEV_AUTH_BYPASS_USER };
            return;
        }

        try {
            await request.jwtVerify();
        } catch {
            return reply.code(401).send({ message: "Unauthorized" });
        }

        const user = request.user;
        if (!user?.sub) {
            return reply.code(401).send({ message: "Unauthorized" });
        }

        // Production access tokens must carry sid so session revoke cannot be bypassed.
        // MFA challenge/enrollment tokens never use this authenticate hook.
        const requireSessionId = process.env.NODE_ENV === "production";
        if (requireSessionId && !user.sid) {
            return reply.code(401).send({ message: "Unauthorized" });
        }

        // Session revalidation: when sid is present and Prisma is decorated.
        // Non-production unit tests may inject JWTs without sid.
        if (user.sid && this.prisma) {
            try {
                const authRepo = new AuthRepository(this.prisma);
                const session = await authRepo.findActiveSessionByPublicId(user.sid);
                if (!session || session.user.public_id !== user.sub) {
                    return reply.code(401).send({ message: "Unauthorized" });
                }
                if (!session.user.is_active || session.user.account_status !== "active") {
                    return reply.code(403).send({ message: "User account is inactive" });
                }
                request.user = {
                    ...user,
                    email: session.user.email,
                    roles: session.user.roles,
                    sid: session.public_id,
                };
            } catch {
                return reply.code(401).send({ message: "Unauthorized" });
            }
        }
    });

    app.decorate("requireDashboardAccess", requireDashboardAccess);
    app.decorate("requireDashboardWrite", requireDashboardWrite);
    app.decorate("requireFieldSurveyor", requireFieldSurveyor);
    app.decorate("requireReportsReview", requireReportsReview);
    app.decorate("requireSurveyAssignmentAccess", requireSurveyAssignmentAccess);
    app.decorate("requireSurveyAssignmentManage", requireSurveyAssignmentManage);

    /**
     * Role gate factory. Use as a preHandler AFTER `app.authenticate`, e.g.
     * `{ preHandler: [app.authenticate, app.requireRole("admin", "super_admin")] }`.
     * Backend authorization only — frontend hiding is never authorization.
     */
    app.decorate("requireRole", function requireRole(...allowedRoles: string[]) {
        return async function roleGuard(request: FastifyRequest, reply: FastifyReply) {
            const roles = request.user?.roles ?? [];
            const permitted = allowedRoles.some((role) => roles.includes(role));

            if (!permitted) {
                return reply.code(403).send({ message: "Insufficient role" });
            }
        };
    });
});
