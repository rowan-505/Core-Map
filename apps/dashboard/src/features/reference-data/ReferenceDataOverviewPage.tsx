"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { referencesPath } from "@/src/lib/dashboardPaths";

import { listReferenceCatalog } from "./api";
import { listReferenceUiConfigs } from "./registry";

const PRIMARY_BTN =
    "rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800";

export default function ReferenceDataOverviewPage() {
    const catalogQuery = useQuery({
        queryKey: ["reference-data", "catalog"],
        queryFn: ({ signal }) => listReferenceCatalog({ signal }),
    });

    const counts = new Map(
        (catalogQuery.data?.items ?? []).map((item) => [item.type, item.row_count] as const),
    );

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Reference data</h1>
                    <p className="mt-2 text-sm text-gray-600">
                        Manage controlled lookup values used across CoreMap.
                    </p>
                </div>

                {catalogQuery.isError ? (
                    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                        {catalogQuery.error instanceof Error
                            ? catalogQuery.error.message
                            : "Unable to load reference catalog."}
                    </p>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {listReferenceUiConfigs().map((config) => {
                        const count = counts.get(config.key);
                        return (
                            <div
                                key={config.key}
                                className="flex flex-col justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                            >
                                <div>
                                    <h2 className="text-base font-semibold text-gray-900">
                                        {config.label}
                                    </h2>
                                    <p className="mt-1 text-sm text-gray-600">{config.description}</p>
                                    <p className="mt-3 text-xs text-gray-500">
                                        {catalogQuery.isLoading
                                            ? "Loading count…"
                                            : `${count ?? "—"} rows`}
                                    </p>
                                </div>
                                <div className="mt-4">
                                    <Link href={referencesPath(config.key)} className={PRIMARY_BTN}>
                                        Manage
                                    </Link>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </main>
    );
}
