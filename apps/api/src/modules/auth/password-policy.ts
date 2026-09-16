const MIN_LENGTH = 8;
const ADMIN_MIN_LENGTH = 12;
const MAX_LENGTH = 200;

const PRIVILEGED_ROLES = new Set(["admin", "super_admin"]);

export class PasswordPolicyError extends Error {
    readonly statusCode = 400;

    constructor(message: string) {
        super(message);
        this.name = "PasswordPolicyError";
    }
}

export function assertPasswordPolicy(
    password: string,
    options: { privileged?: boolean } = {}
): void {
    if (typeof password !== "string") {
        throw new PasswordPolicyError("Password is required");
    }
    if (password.trim().length === 0) {
        throw new PasswordPolicyError("Password cannot be only whitespace");
    }
    const min = options.privileged ? ADMIN_MIN_LENGTH : MIN_LENGTH;
    if (password.length < min) {
        throw new PasswordPolicyError(`Password must be at least ${min} characters`);
    }
    if (password.length > MAX_LENGTH) {
        throw new PasswordPolicyError(`Password must be at most ${MAX_LENGTH} characters`);
    }
}

export function isPrivilegedRoleList(roles: readonly string[]): boolean {
    return roles.some((role) => PRIVILEGED_ROLES.has(role));
}

/**
 * Dashboard OAuth MFA gate for privileged roles — same rules as password login:
 * enrolled → challenge TOTP; not enrolled → block until email/password enrollment.
 */
export function privilegedDashboardOAuthMfaAction(
    roles: readonly string[],
    hasActiveTotp: boolean
): "session" | "mfa" | "enrollment_required" {
    if (!isPrivilegedRoleList(roles)) return "session";
    return hasActiveTotp ? "mfa" : "enrollment_required";
}
