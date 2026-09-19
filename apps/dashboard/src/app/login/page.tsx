import { Suspense } from "react";
import { Loader2 } from "lucide-react";

import LoginPageClient from "./LoginPageClient";

function LoginFallback() {
    return (
        <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-100 px-4 py-10">
            <div
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.08),_transparent_55%)]"
                aria-hidden
            />
            <div className="relative w-full max-w-[420px] rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" aria-hidden />
                <p className="mt-3 text-sm text-slate-600">Checking authentication…</p>
            </div>
        </main>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={<LoginFallback />}>
            <LoginPageClient />
        </Suspense>
    );
}
