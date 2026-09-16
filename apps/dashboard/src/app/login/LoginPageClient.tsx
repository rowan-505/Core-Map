"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
    consumeImportReviewApiAuthFailed,
    isImportReviewDevRouteBypassActive,
    logImportReviewAuthDecision,
    readImportReviewAuthDebugState,
} from "@/src/lib/importReviewDevAccess";
import { hasDashboardAccess, rolesFromJwtAccessToken } from "@/src/lib/jwtRoles";
import { accountPath } from "@/src/lib/dashboardPaths";
import { getAccessToken, setAccessToken, tryRestoreDashboardSession } from "@/src/lib/api";

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
        const state = readImportReviewAuthDebugState(pathname, true);
        const postLoginPath = resolvePostLoginPath(searchParams.get("next"));
        const queryError = searchParams.get("error");
        if (queryError === "dashboard_forbidden") {
            setError("This account does not have dashboard access.");
        } else if (queryError === "mfa_enrollment_required") {
            setError("Administrator MFA setup required. Sign in with email and password to enroll.");
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

        if (consumeImportReviewApiAuthFailed()) {
            logImportReviewAuthDecision(
                "LoginPageClient",
                "stay-on-login-after-import-review-api-401",
                { ...state, authLoading: false, importReviewApiAuthFailedFlag: true }
            );
            setAuthChecked(true);
            return;
        }

        const finishWithToken = (accessToken: string) => {
            if (!hasDashboardAccess(rolesFromJwtAccessToken(accessToken))) {
                setError("This account does not have dashboard access.");
                setAuthChecked(true);
                return;
            }
            logImportReviewAuthDecision("LoginPageClient", "redirect-after-login", {
                ...readImportReviewAuthDebugState(pathname, false),
                hasAccessToken: true,
            });
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
            logImportReviewAuthDecision("LoginPageClient", "show-login-form", {
                ...state,
                authLoading: false,
            });
            setAuthChecked(true);
        });
    }, [router, searchParams]);

    if (!authChecked) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
                <p className="text-sm text-gray-600">Checking authentication…</p>
            </main>
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
        if (!response.ok || !responseData?.secret) {
            throw new Error(getLoginErrorMessage(response.status, responseData));
        }
        setEnrollmentToken(token);
        setEnrollmentSecret(responseData.secret);
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

    return (
        <main className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
            <form
                onSubmit={handleSubmit}
                noValidate
                className="w-full max-w-sm rounded-lg bg-white p-6 shadow"
            >
                <h1 className="mb-4 text-2xl font-semibold text-gray-900">Dashboard Login</h1>

                {enrollmentSecret ? (
                    <div className="mb-4 space-y-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                        <p className="font-medium">Administrator MFA setup required</p>
                        <p>Add this secret in your authenticator app, then enter a 6-digit code.</p>
                        <code className="block break-all rounded bg-white px-2 py-1 text-[11px]">
                            {enrollmentSecret}
                        </code>
                        {recoveryCodes?.length ? (
                            <p>Save recovery codes shown after verification.</p>
                        ) : null}
                    </div>
                ) : null}

                {challengeMode ? (
                    <label className="mb-4 block">
                        <span className="mb-1 block text-sm text-gray-700">Authenticator code</span>
                        <input
                            value={mfaCode}
                            onChange={(event) => setMfaCode(event.target.value)}
                            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            required
                        />
                    </label>
                ) : (
                    <>
                        <div className="mb-4 space-y-2">
                            {oauthProviders.google ? (
                                <button
                                    type="button"
                                    onClick={() => oauthStart("google")}
                                    className="w-full rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-800"
                                >
                                    Continue with Google
                                </button>
                            ) : null}
                            {oauthProviders.facebook ? (
                                <button
                                    type="button"
                                    onClick={() => oauthStart("facebook")}
                                    className="w-full rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-800"
                                >
                                    Continue with Facebook
                                </button>
                            ) : null}
                        </div>
                        <label className="mb-4 block">
                            <span className="mb-1 block text-sm text-gray-700">Email</span>
                            <input
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                required
                            />
                        </label>
                        <label className="mb-4 block">
                            <span className="mb-1 block text-sm text-gray-700">Password</span>
                            <input
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                required
                            />
                        </label>
                    </>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-60"
                >
                    {loading
                        ? "Signing in..."
                        : enrollmentToken
                          ? "Verify and enable MFA"
                          : mfaToken
                            ? "Verify"
                            : "Sign in"}
                </button>

                {error ? <p className="mt-2 text-sm text-red-500">{error}</p> : null}

                {isImportReviewDevRouteBypassActive("/dashboard/import-review") ? (
                    <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        Development: you can open{" "}
                        <Link href="/dashboard/import-review" className="font-medium underline">
                            Import review
                        </Link>{" "}
                        without signing in when{" "}
                        <code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN</code> is
                        set.
                    </p>
                ) : null}
            </form>
        </main>
    );
}
