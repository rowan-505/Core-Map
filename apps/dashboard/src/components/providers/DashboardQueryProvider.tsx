"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { ensureAuthChannel } from "@/src/lib/authTokenStorage";

function createDashboardQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: 1,
                refetchOnWindowFocus: false,
            },
        },
    });
}

export default function DashboardQueryProvider({ children }: { children: ReactNode }) {
    const [queryClient] = useState(() => createDashboardQueryClient());

    useEffect(() => {
        ensureAuthChannel();
    }, []);

    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
