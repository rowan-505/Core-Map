import type { AccountStatus, PointReasonCode } from "./types";

export const ROLE_OPTIONS = [
    {
        value: "user",
        label: "User",
        authorization: "Public web account. No dashboard or field-survey access.",
        passwordMinLength: 8,
    },
    {
        value: "viewer",
        label: "Viewer",
        authorization: "Read-only dashboard access. Cannot change canonical data.",
        passwordMinLength: 8,
    },
    {
        value: "surveyor",
        label: "Surveyor",
        authorization: "Field-survey access only. No dashboard or canonical data writes.",
        passwordMinLength: 8,
    },
    {
        value: "admin",
        label: "Admin",
        authorization:
            "Dashboard read/write access. Cannot manage privileged roles or super-admin-only actions.",
        passwordMinLength: 12,
    },
    {
        value: "super_admin",
        label: "Super admin",
        authorization: "Full dashboard administration. MFA enrollment is required at login.",
        passwordMinLength: 12,
    },
] as const;

export const PRIVILEGED_ROLES = new Set(["admin", "super_admin"]);

export const ACCOUNT_STATUS_OPTIONS: { value: AccountStatus; label: string }[] = [
    { value: "active", label: "Active" },
    { value: "disabled", label: "Disabled" },
    { value: "deleted", label: "Deleted" },
];

export const POINT_REASON_OPTIONS: { value: PointReasonCode; label: string }[] = [
    { value: "admin_adjustment", label: "Admin adjustment" },
    { value: "valid_contribution", label: "Valid contribution" },
    { value: "reversal", label: "Reversal" },
    { value: "spam_penalty", label: "Spam penalty" },
];

export function roleLabel(code: string): string {
    return ROLE_OPTIONS.find((r) => r.value === code)?.label ?? code;
}

export function reasonLabel(code: string): string {
    return POINT_REASON_OPTIONS.find((r) => r.value === code)?.label ?? code;
}

export function statusLabel(status: string): string {
    return ACCOUNT_STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status;
}

export function formatDateTime(value: string | null): string {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function formatDate(value: string | null): string {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}
