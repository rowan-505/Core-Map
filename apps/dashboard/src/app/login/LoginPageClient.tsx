"use client";

import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";

import { hasDashboardAccess, rolesFromJwtAccessToken } from "@/src/lib/jwtRoles";
import { accountPath } from "@/src/lib/dashboardPaths";
import { getAccessToken, setAccessToken, tryRestoreDashboardSession } from "@/src/lib/api";
import { MfaQrCode } from "@/src/components/auth/MfaQrCode";

type LoginResponse = {
    accessToken?: string;
    refreshToken?: string;
    mfaRequired?: boolean;
    mfaToken?: string;
    mfaEnrollmentRequired?: boolean;
    enrollmentToken?: string;
    recoveryCodes?: string[];
    secret?: string;
    otpauthUrl?: string;
    user?: {
        public_id: string;
        email: string;
        display_name: string;
        roles: string[];
    };
};

type LoginApiPayload = {
    message?: unknown;
    error?: unknown;
    data?: {
        message?: unknown;
        error?: unknown;
    };
};

type OAuthProviders = { google: boolean; facebook: boolean };

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "");

function parseJsonSafely(value: string): unknown {
    if (!value.trim()) {
        return null;
    }

    try {
        return JSON.parse(value) as unknown;
    } catch {
        return null;
    }
}

function getString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getApiErrorMessage(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") {
        return null;
    }

    const data = payload as LoginApiPayload;

    return (
        getString(data.message) ??
        getString(data.error) ??
        getString(data.data?.message) ??
        getString(data.data?.error)
    );
}

function resolvePostLoginPath(nextParam: string | null): string {
    const fallback = accountPath();
    if (!nextParam?.trim()) {
        return fallback;
    }
    const next = nextParam.trim();
    if (!next.startsWith("/") || next.startsWith("//")) {
        return fallback;
    }
    if (!next.startsWith("/dashboard")) {
        return fallback;
    }
    return next;
}

function getLoginErrorMessage(status: number, payload: unknown): string {
    const apiMessage = getApiErrorMessage(payload);

    if (apiMessage) {
        return apiMessage;
    }

    switch (status) {
        case 401:
            return "Invalid email or password";
        case 403:
            return "Account is inactive";
        case 404:
            return "User not found";
        default:
            return "Login failed";
    }
}

function PasswordField({
    id,
    label,
    value,
    onChange,
    disabled,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}) {
    const [visible, setVisible] = useState(false);

    return (
        <label className="block" htmlFor={id}>
            <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
            <div className="relative">
                <input
                    id={id}
                    type={visible ? "text" : "password"}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-11 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-50"
                    autoComplete="current-password"
                    required
                    disabled={disabled}
                />
                <button
                    type="button"
                    onClick={() => setVisible((current) => !current)}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500 transition hover:text-slate-800"
                    aria-label={visible ? "Hide password" : "Show password"}
                    aria-pressed={visible}
                    tabIndex={-1}
                >
                    {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
            </div>
        </label>
    );
}

function AuthShell({ children }: { children: ReactNode }) {
    return (
        <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-100 px-4 py-10">
            <div
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.08),_transparent_55%)]"
                aria-hidden
            />
            <div className="relative w-full max-w-[420px]">{children}</div>
        </main>
    );
}

export default function LoginPageClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [authChecked, setAuthChecked] = useState(false);
    const [mfaToken, setMfaToken] = useState<string | null>(null);
    const [mfaCode, setMfaCode] = useState("");
    const [enrollmentToken, setEnrollmentToken] = useState<string | null>(null);
    const [enrollmentSecret, setEnrollmentSecret] = useState<string | null>(null);
    const [enrollmentOtpauthUrl, setEnrollmentOtpauthUrl] = useState<string | null>(null);
    const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
    const [oauthProviders, setOauthProviders] = useState<OAuthProviders>({
        google: true,
        facebook: false,
    });

    useEffect(() => {
        if (!API_BASE_URL) return;
        void fetch(`${API_BASE_URL}/auth/providers`, { credentials: "include" })
            .then(async (response) => {
                if (!response.ok) return;
                const body = (await response.json()) as { providers?: OAuthProviders };
                if (!body.providers) return;
                setOauthProviders({
                    google: Boolean(body.providers.google),
                    facebook: Boolean(body.providers.facebook),
                });
            })
            .catch(() => undefined);
    }, []);

    useEffect(() => {
        const pathname = window.location.pathname;
        const postLoginPath = resolvePostLoginPath(searchParams.get("next"));
        const queryError = searchParams.get("error");
        if (queryError === "dashboard_forbidden") {
            setError("This account does not have dashboard access.");
        } else if (queryError === "mfa_enrollment_required") {
            setError("Super admin MFA setup required. Sign in with email and password to enroll.");
        } else if (queryError) {
            setError("Sign-in with that provider did not complete.");
        }

        // OAuth MFA challenge lands here as `#mfa_token=...` (hash avoids Referer/log leakage).
        const hash = window.location.hash.startsWith("#")
            ? window.location.hash.slice(1)
            : window.location.hash;
        const hashParams = new URLSearchParams(hash);
        const oauthMfaToken = hashParams.get("mfa_token")?.trim();
        if (oauthMfaToken) {
            setMfaToken(oauthMfaToken);
            window.history.replaceState(null, "", `${pathname}${window.location.search}`);
            setAuthChecked(true);
            return;
        }

        const finishWithToken = (accessToken: string) => {
            if (!hasDashboardAccess(rolesFromJwtAccessToken(accessToken))) {
                setError("This account does not have dashboard access.");
                setAuthChecked(true);
                return;
            }
            router.replace(postLoginPath);
        };

        const memoryToken = getAccessToken()?.trim();
        if (memoryToken) {
            finishWithToken(memoryToken);
            return;
        }

        void tryRestoreDashboardSession().then((ok) => {
            const restored = getAccessToken()?.trim();
            if (ok && restored) {
                finishWithToken(restored);
                return;
            }
            setAuthChecked(true);
        });
    }, [router, searchParams]);

    if (!authChecked) {
        return (
            <AuthShell>
                <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" aria-hidden />
                    <p className="mt-3 text-sm text-slate-600">Checking authentication…</p>
                </div>
            </AuthShell>
        );
    }

    function persistAccess(accessToken: string, roles: string[]) {
        if (!hasDashboardAccess(roles)) {
            throw new Error("This account does not have dashboard access.");
        }
        setAccessToken(accessToken);
        router.replace(resolvePostLoginPath(searchParams.get("next")));
    }

    async function startEnrollment(token: string) {
        if (!API_BASE_URL) {
            throw new Error("Cannot connect to server");
        }
        const response = await fetch(`${API_BASE_URL}/auth/mfa/enroll/bootstrap`, {
            method: "POST",
            credentials: "include",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ enrollmentToken: token }),
        });
        const responseData = parseJsonSafely(await response.text()) as LoginResponse | null;
        if (!response.ok || !responseData?.secret || !responseData?.otpauthUrl) {
            throw new Error(getLoginErrorMessage(response.status, responseData));
        }
        setEnrollmentToken(token);
        setEnrollmentSecret(responseData.secret);
        setEnrollmentOtpauthUrl(responseData.otpauthUrl);
        setMfaCode("");
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(null);
        setLoading(true);

        try {
            if (!API_BASE_URL) {
                throw new Error("Cannot connect to server");
            }

            if (enrollmentToken) {
                const response = await fetch(`${API_BASE_URL}/auth/mfa/enroll/bootstrap/verify`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ enrollmentToken, code: mfaCode }),
                });
                const responseData = parseJsonSafely(await response.text()) as LoginResponse | null;
                if (!response.ok || !responseData?.accessToken) {
                    throw new Error(getLoginErrorMessage(response.status, responseData));
                }
                if (responseData.recoveryCodes?.length) {
                    setRecoveryCodes(responseData.recoveryCodes);
                }
                persistAccess(
                    responseData.accessToken,
                    responseData.user?.roles ?? rolesFromJwtAccessToken(responseData.accessToken)
                );
                return;
            }

            if (mfaToken) {
                const response = await fetch(`${API_BASE_URL}/auth/mfa/verify`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ mfaToken, code: mfaCode }),
                });
                const responseData = parseJsonSafely(await response.text()) as LoginResponse | null;
                if (!response.ok || !responseData?.accessToken) {
                    throw new Error(getLoginErrorMessage(response.status, responseData));
                }
                persistAccess(
                    responseData.accessToken,
                    responseData.user?.roles ?? rolesFromJwtAccessToken(responseData.accessToken)
                );
                return;
            }

            const response = await fetch(`${API_BASE_URL}/auth/login`, {
                method: "POST",
                credentials: "include",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    email: email.trim(),
                    password,
                }),
            });

            const responseData = parseJsonSafely(await response.text()) as LoginResponse | null;
            if (!response.ok) {
                throw new Error(getLoginErrorMessage(response.status, responseData));
            }
            if (responseData?.mfaRequired && responseData.mfaToken) {
                setMfaToken(responseData.mfaToken);
                return;
            }
            if (responseData?.mfaEnrollmentRequired && responseData.enrollmentToken) {
                await startEnrollment(responseData.enrollmentToken);
                return;
            }
            if (!responseData?.accessToken) {
                throw new Error("Login failed");
            }
            persistAccess(
                responseData.accessToken,
                responseData.user?.roles ?? rolesFromJwtAccessToken(responseData.accessToken)
            );
        } catch (err) {
            if (err instanceof TypeError) {
                setError("Cannot connect to server");
                return;
            }
            setError(err instanceof Error ? err.message : "Login failed");
        } finally {
            setLoading(false);
        }
    }

    const oauthStart = (provider: "google" | "facebook") => {
        if (!API_BASE_URL) return;
        const next = resolvePostLoginPath(searchParams.get("next"));
        const returnTo = `${window.location.origin}/login`;
        window.location.href = `${API_BASE_URL}/auth/oauth/${provider}/start?client=dashboard&return_to=${encodeURIComponent(returnTo)}`;
        void next;
    };

    const challengeMode = Boolean(mfaToken || enrollmentToken);
    const title = enrollmentToken
        ? "Enable authenticator"
        : mfaToken
          ? "Verify identity"
          : "Sign in";
    const subtitle = enrollmentToken
        ? "Add the secret to your authenticator app, then enter a 6-digit code."
        : mfaToken
          ? "Enter the 6-digit code from your authenticator app."
          : "Use your CoreMap admin account to open the dashboard.";

    return (
        <AuthShell>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 bg-slate-50/80 px-6 py-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        CoreMap
                    </p>
                    <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{subtitle}</p>
                </div>

                <form onSubmit={handleSubmit} noValidate className="space-y-4 px-6 py-6">
                    {enrollmentSecret && enrollmentOtpauthUrl ? (
                        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-950">
                            <div className="flex items-start gap-2">
                                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                                <div className="space-y-1">
                                    <p className="font-medium">Super admin MFA setup required</p>
                                    <p className="text-xs leading-relaxed text-amber-900/90">
                                        Scan the QR code with your authenticator app, or enter the secret
                                        manually, then enter a 6-digit code.
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                                <MfaQrCode otpauthUrl={enrollmentOtpauthUrl} size={168} />
                                <div className="min-w-0 flex-1 space-y-2">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-900/70">
                                        Manual secret
                                    </p>
                                    <code className="block break-all rounded-lg border border-amber-200 bg-white px-2.5 py-2 font-mono text-[11px] text-slate-800">
                                        {enrollmentSecret}
                                    </code>
                                    {recoveryCodes?.length ? (
                                        <p className="text-xs">Save recovery codes shown after verification.</p>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {challengeMode ? (
                        <label className="block" htmlFor="dashboard-mfa-code">
                            <span className="mb-1.5 block text-sm font-medium text-slate-700">
                                Authenticator code
                            </span>
                            <input
                                id="dashboard-mfa-code"
                                value={mfaCode}
                                onChange={(event) => setMfaCode(event.target.value)}
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm tracking-[0.2em] text-slate-900 shadow-sm outline-none transition placeholder:tracking-normal placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                placeholder="000000"
                                required
                                disabled={loading}
                            />
                        </label>
                    ) : (
                        <>
                            {(oauthProviders.google || oauthProviders.facebook) && (
                                <div className="space-y-2">
                                    {oauthProviders.google ? (
                                        <button
                                            type="button"
                                            onClick={() => oauthStart("google")}
                                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50"
                                        >
                                            Continue with Google
                                        </button>
                                    ) : null}
                                    {oauthProviders.facebook ? (
                                        <button
                                            type="button"
                                            onClick={() => oauthStart("facebook")}
                                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50"
                                        >
                                            Continue with Facebook
                                        </button>
                                    ) : null}
                                    <div className="flex items-center gap-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                        <span className="h-px flex-1 bg-slate-200" />
                                        or
                                        <span className="h-px flex-1 bg-slate-200" />
                                    </div>
                                </div>
                            )}

                            <label className="block" htmlFor="dashboard-email">
                                <span className="mb-1.5 block text-sm font-medium text-slate-700">Email</span>
                                <input
                                    id="dashboard-email"
                                    type="email"
                                    value={email}
                                    onChange={(event) => setEmail(event.target.value)}
                                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                                    autoComplete="email"
                                    placeholder="you@example.com"
                                    required
                                    disabled={loading}
                                />
                            </label>

                            <PasswordField
                                id="dashboard-password"
                                label="Password"
                                value={password}
                                onChange={setPassword}
                                disabled={loading}
                            />
                        </>
                    )}

                    {error ? (
                        <p
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                            role="alert"
                        >
                            {error}
                        </p>
                    ) : null}

                    <button
                        type="submit"
                        disabled={loading}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                        {loading
                            ? "Signing in…"
                            : enrollmentToken
                              ? "Verify and enable MFA"
                              : mfaToken
                                ? "Verify"
                                : "Sign in"}
                    </button>
                </form>
            </div>
        </AuthShell>
    );
}
