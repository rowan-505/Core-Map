"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useDashboardRoleAccess } from "@/src/hooks/useDashboardRoleAccess";
import { usersPath } from "@/src/lib/dashboardPaths";

import { createUser } from "./api";
import { ROLE_OPTIONS } from "./constants";
import type { ManagedRoleCode } from "./types";
import { INPUT_CLASS, PRIMARY_BTN, SELECT_CLASS } from "./ui";

export default function CreateUserPage() {
    const router = useRouter();
    const access = useDashboardRoleAccess();
    const [displayName, setDisplayName] = useState("");
    const [email, setEmail] = useState("");
    const [roleCode, setRoleCode] = useState<ManagedRoleCode>("viewer");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const selectedRole = useMemo(
        () => ROLE_OPTIONS.find((role) => role.value === roleCode) ?? ROLE_OPTIONS[0],
        [roleCode]
    );
    const isSuperAdmin = access.roles.includes("super_admin");

    if (!access.ready) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-3xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                    Loading access…
                </div>
            </main>
        );
    }

    if (!isSuperAdmin) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-3xl space-y-4">
                    <Link href={usersPath()} className="text-sm text-gray-600 hover:text-gray-900">
                        ← Back to users
                    </Link>
                    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
                        Only a super admin can create accounts.
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="p-6">
            <div className="mx-auto max-w-4xl space-y-5">
                <div>
                    <Link href={usersPath()} className="text-sm text-gray-600 hover:text-gray-900">
                        ← Back to users
                    </Link>
                </div>

                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">Create account</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Create one verified account with an initial password and role.
                    </p>
                </header>

                {error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        {error}
                    </div>
                ) : null}

                <form
                    className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
                    onSubmit={(event) => {
                        event.preventDefault();
                        setError("");
                        if (password !== confirmPassword) {
                            setError("Passwords do not match.");
                            return;
                        }
                        if (password.length < selectedRole.passwordMinLength) {
                            setError(
                                `Password must be at least ${selectedRole.passwordMinLength} characters for ${selectedRole.label}.`
                            );
                            return;
                        }

                        setBusy(true);
                        void createUser({
                            displayName: displayName.trim(),
                            email: email.trim(),
                            password,
                            roleCode,
                        })
                            .then((user) => {
                                setPassword("");
                                setConfirmPassword("");
                                router.push(usersPath(user.public_id));
                            })
                            .catch((err: unknown) => {
                                setError(
                                    err instanceof Error ? err.message : "Failed to create account."
                                );
                            })
                            .finally(() => setBusy(false));
                    }}
                >
                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="flex flex-col gap-1">
                            <span className="text-sm font-medium text-gray-700">Display name</span>
                            <input
                                required
                                minLength={2}
                                maxLength={120}
                                value={displayName}
                                onChange={(event) => setDisplayName(event.target.value)}
                                className={INPUT_CLASS}
                                autoComplete="off"
                            />
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-sm font-medium text-gray-700">Email</span>
                            <input
                                required
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                className={INPUT_CLASS}
                                autoComplete="off"
                            />
                        </label>

                        <label className="flex flex-col gap-1 sm:col-span-2">
                            <span className="text-sm font-medium text-gray-700">Initial role</span>
                            <select
                                value={roleCode}
                                onChange={(event) =>
                                    setRoleCode(event.target.value as ManagedRoleCode)
                                }
                                className={SELECT_CLASS}
                            >
                                {ROLE_OPTIONS.map((role) => (
                                    <option key={role.value} value={role.value}>
                                        {role.label}
                                    </option>
                                ))}
                            </select>
                            <span className="text-xs text-gray-500">
                                {selectedRole.authorization}
                            </span>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-sm font-medium text-gray-700">
                                Initial password
                            </span>
                            <input
                                required
                                type="password"
                                minLength={selectedRole.passwordMinLength}
                                maxLength={200}
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                className={INPUT_CLASS}
                                autoComplete="new-password"
                            />
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-sm font-medium text-gray-700">
                                Confirm password
                            </span>
                            <input
                                required
                                type="password"
                                minLength={selectedRole.passwordMinLength}
                                maxLength={200}
                                value={confirmPassword}
                                onChange={(event) => setConfirmPassword(event.target.value)}
                                className={INPUT_CLASS}
                                autoComplete="new-password"
                            />
                        </label>
                    </div>

                    <p className="mt-4 text-xs text-amber-800">
                        The email is marked verified. The initial password does not expire
                        automatically, so ask the user to change it after login.
                    </p>

                    <button type="submit" disabled={busy} className={`mt-4 ${PRIMARY_BTN}`}>
                        {busy ? "Creating…" : "Create account"}
                    </button>
                </form>

                <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                    <h2 className="text-base font-semibold text-gray-900">Role authorizations</h2>
                    <p className="mt-1 text-xs text-gray-500">
                        These are short summaries. API role checks remain authoritative.
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {ROLE_OPTIONS.map((role) => (
                            <div key={role.value} className="rounded-md border border-gray-200 p-3">
                                <div className="text-sm font-semibold text-gray-900">
                                    {role.label}
                                </div>
                                <p className="mt-1 text-sm text-gray-600">{role.authorization}</p>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </main>
    );
}
