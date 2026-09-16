"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import {
    isImportReviewDevRouteBypassActive,
    logImportReviewAuthDecision,
    readImportReviewAuthDebugState,
} from "@/src/lib/importReviewDevAccess";
import { getAccessToken, tryRestoreDashboardSession } from "@/src/lib/api";

type GateStatus = "loading" | "allowed" | "redirecting";

/**
 * Client gate for `/import-review/*` only (mounted from import-review layout).
 * In development with NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN, allows the shell without JWT.
 */
export default function ImportReviewRouteAuthGate({ children }: { children: ReactNode }) {
    const pathname = usePathname() ?? "";
    const router = useRouter();
    const [status, setStatus] = useState<GateStatus>("loading");

    useEffect(() => {
        let cancelled = false;

        async function resolveGate() {
            if (isImportReviewDevRouteBypassActive(pathname)) {
                logImportReviewAuthDecision("ImportReviewRouteAuthGate", "allow-dev-bypass", {
                    ...readImportReviewAuthDebugState(pathname, false),
                    authLoading: false,
                    importReviewDevBypassActive: true,
                });
                if (!cancelled) setStatus("allowed");
                return;
            }

            if (getAccessToken()?.trim()) {
                logImportReviewAuthDecision("ImportReviewRouteAuthGate", "allow-jwt", {
                    ...readImportReviewAuthDebugState(pathname, false),
                    authLoading: false,
                });
                if (!cancelled) setStatus("allowed");
                return;
            }

            const restored = await tryRestoreDashboardSession();
            if (cancelled) return;
            if (restored && getAccessToken()?.trim()) {
                logImportReviewAuthDecision("ImportReviewRouteAuthGate", "allow-jwt", {
                    ...readImportReviewAuthDebugState(pathname, false),
                    authLoading: false,
                });
                setStatus("allowed");
                return;
            }

            logImportReviewAuthDecision(
                "ImportReviewRouteAuthGate",
                "redirect-login",
                readImportReviewAuthDebugState(pathname, false)
            );
            setStatus("redirecting");
            router.replace("/login");
        }

        void resolveGate();
        return () => {
            cancelled = true;
        };
    }, [pathname, router]);

    if (status === "loading" || status === "redirecting") {
        return (
            <main className="p-6">
                <p className="text-sm text-gray-600">
                    {status === "redirecting" ? "Redirecting to login…" : "Loading import review…"}
                </p>
            </main>
        );
    }

    return <>{children}</>;
}
