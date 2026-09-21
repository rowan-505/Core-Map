"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

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

    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
