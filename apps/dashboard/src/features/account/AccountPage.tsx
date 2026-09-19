"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
    changeDashboardPassword,
    enrollDashboardMfa,
    getAuthMe,
    isAbortError,
    listDashboardSecurityEvents,
    listDashboardSessions,
    logout,
    revokeDashboardSession,
    revokeOtherDashboardSessions,
    verifyDashboardMfaEnroll,
    type AuthMeProfile,
} from "@/src/lib/api";
import { RolePills, VerifiedBadge } from "@/src/features/user-management/ui";
import { statusLabel } from "@/src/features/user-management/constants";
import { MfaQrCode } from "@/src/components/auth/MfaQrCode";

const LANGUAGE_LABELS: Record<string, string> = {
    my: "Myanmar",
    en: "English",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
            <dd className="mt-1 text-sm text-gray-900">{children}</dd>
        </div>
    );
}

export default function AccountPage() {
    const [profile, setProfile] = useState<AuthMeProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [loggingOut, setLoggingOut] = useState(false);

    const load = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError("");
        try {
            setProfile(await getAuthMe(signal ? { signal } : undefined));
        } catch (err) {
            if (isAbortError(err)) return;
            setError(err instanceof Error ? err.message : "Failed to load account.");
            setProfile(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    async function handleLogout() {
        setLoggingOut(true);
        try {
            await logout();
        } catch {
            setLoggingOut(false);
        }
    }

    return (
        <main className="p-6">
            <div className="mx-auto max-w-xl space-y-4">
                <div>
                    <h1 className="text-lg font-semibold text-gray-900">Account</h1>
                    <p className="mt-1 text-sm text-gray-600">Your signed-in dashboard profile.</p>
                </div>

                {loading ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-sm">
                        Loading account…
                    </div>
                ) : null}

                {error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        {error}
                    </div>
                ) : null}

                {profile ? (
                    <>
                    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label="Display name">{profile.display_name}</Field>
                            <Field label="Email">{profile.email}</Field>
                            <Field label="Email verified">
                                <VerifiedBadge verified={profile.email_verified} />
                            </Field>
                            <Field label="Status">{statusLabel(profile.account_status)}</Field>
                            <Field label="Roles">
                                <RolePills roles={profile.roles} />
                            </Field>
                            <Field label="Language">
                                {LANGUAGE_LABELS[profile.preferred_language] ?? profile.preferred_language}
                            </Field>
                            <Field label="Points">{profile.total_points}</Field>
                            {profile.phone ? <Field label="Phone">{profile.phone}</Field> : null}
                        </dl>
                    </section>
                    <AccountSecurityPanel roles={profile.roles} />
                    </>
                ) : null}

                <div>
                    <button
                        type="button"
                        disabled={loggingOut}
                        onClick={() => void handleLogout()}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                    >
                        {loggingOut ? "Signing out…" : "Log out"}
                    </button>
                </div>
            </div>
        </main>
    );
}

function AccountSecurityPanel({ roles }: { roles: string[] }) {
    const privileged = roles.includes("admin") || roles.includes("super_admin");
    const [sessions, setSessions] = useState<
        { public_id: string; current: boolean; device_label: string; last_used_at: string | null }[]
    >([]);
    const [events, setEvents] = useState<{ event_type: string; created_at: string; success: boolean }[]>([]);
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [message, setMessage] = useState("");
    const [otpauth, setOtpauth] = useState("");
    const [mfaSecret, setMfaSecret] = useState("");
    const [mfaCode, setMfaCode] = useState("");
    const [recovery, setRecovery] = useState<string[]>([]);

    useEffect(() => {
        void listDashboardSessions()
            .then((body) => setSessions(body.sessions))
            .catch(() => undefined);
        void listDashboardSecurityEvents()
            .then((body) => setEvents(body.events))
            .catch(() => undefined);
    }, []);

    return (
        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">Security</h2>
            <form
                className="space-y-2"
                onSubmit={(event) => {
                    event.preventDefault();
                    void changeDashboardPassword(currentPassword, newPassword)
                        .then(() => setMessage("Password updated. Other devices were signed out."))
                        .catch((err) => setMessage(err instanceof Error ? err.message : "Could not update password."));
                }}
            >
                <p className="text-sm font-medium text-gray-800">Change password</p>
                <input
                    type="password"
                    placeholder="Current password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
                <input
                    type="password"
                    placeholder="New password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
                <button type="submit" className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white">
                    Update password
                </button>
            </form>

            <div>
                <p className="text-sm font-medium text-gray-800">Sessions</p>
                <ul className="mt-2 space-y-1 text-sm text-gray-700">
                    {sessions.map((session) => (
                        <li key={session.public_id} className="flex items-center justify-between gap-2">
                            <span>
                                {session.device_label}
                                {session.current ? " (this device)" : ""}
                            </span>
                            {session.current ? null : (
                                <button
                                    type="button"
                                    className="text-xs text-blue-700 underline"
                                    onClick={() => {
                                        void revokeDashboardSession(session.public_id).then(() =>
                                            setSessions((rows) => rows.filter((row) => row.public_id !== session.public_id))
                                        );
                                    }}
                                >
                                    Sign out
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
                <button
                    type="button"
                    className="mt-2 text-xs text-gray-700 underline"
                    onClick={() => {
                        void revokeOtherDashboardSessions().then(() =>
                            setSessions((rows) => rows.filter((row) => row.current))
                        );
                    }}
                >
                    Sign out other devices
                </button>
            </div>

            {privileged ? (
                <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-800">Authenticator MFA</p>
                    <button
                        type="button"
                        className="rounded border border-gray-300 px-3 py-1.5 text-sm"
                        onClick={() => {
                            void enrollDashboardMfa()
                                .then((body) => {
                                    setOtpauth(body.otpauthUrl);
                                    setMfaSecret(body.secret);
                                })
                                .catch((err) => setMessage(err instanceof Error ? err.message : "Could not start MFA."));
                        }}
                    >
                        Start enrollment
                    </button>
                    {otpauth ? (
                        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <p className="text-xs text-amber-950">
                                Scan this QR code with your authenticator app, or enter the secret manually.
                            </p>
                            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                                <MfaQrCode otpauthUrl={otpauth} size={160} />
                                {mfaSecret ? (
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-900/70">
                                            Manual secret
                                        </p>
                                        <code className="block break-all rounded border border-amber-200 bg-white px-2 py-1.5 font-mono text-[11px] text-gray-800">
                                            {mfaSecret}
                                        </code>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : null}
                    {otpauth ? (
                        <form
                            className="space-y-2"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void verifyDashboardMfaEnroll(mfaCode)
                                    .then((body) => setRecovery(body.recoveryCodes))
                                    .catch((err) => setMessage(err instanceof Error ? err.message : "Invalid code."));
                            }}
                        >
                            <input
                                value={mfaCode}
                                onChange={(event) => setMfaCode(event.target.value)}
                                placeholder="6-digit code"
                                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                            />
                            <button type="submit" className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white">
                                Verify MFA
                            </button>
                        </form>
                    ) : null}
                    {recovery.length > 0 ? (
                        <p className="text-xs text-gray-700">
                            Save these recovery codes: {recovery.join(", ")}
                        </p>
                    ) : null}
                </div>
            ) : null}

            <div>
                <p className="text-sm font-medium text-gray-800">Recent activity</p>
                <ul className="mt-2 space-y-1 text-xs text-gray-600">
                    {events.map((event) => (
                        <li key={`${event.event_type}-${event.created_at}`}>
                            {event.created_at}: {event.event_type}
                            {event.success ? "" : " (failed)"}
                        </li>
                    ))}
                </ul>
            </div>
            {message ? <p className="text-sm text-gray-700">{message}</p> : null}
        </section>
    );
}
