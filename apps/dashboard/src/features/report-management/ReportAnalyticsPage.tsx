"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import StatsCard from "@/src/components/dashboard/StatsCard";
import { reportsPath } from "@/src/lib/dashboardPaths";

import {
    getReportAnalyticsAnonymous,
    getReportAnalyticsByRegion,
    getReportAnalyticsByStatus,
    getReportAnalyticsByType,
    getReportAnalyticsSummary,
} from "./api";
import { reportTypeLabel, statusLabel } from "./constants";

const BUTTON_CLASS =
    "inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
    return (
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
            <div className="mt-4 h-72 w-full">{children}</div>
        </section>
    );
}

function EmptyChart({ label }: { label: string }) {
    return <div className="flex h-full items-center justify-center text-sm text-gray-500">{label}</div>;
}

function AnalyticsSkeleton() {
    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-6 animate-pulse">
                <div className="h-16 rounded-lg bg-gray-200" />
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                    {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-28 rounded-lg bg-gray-200" />)}
                </div>
                <div className="grid gap-6 lg:grid-cols-2">
                    <div className="h-80 rounded-lg bg-gray-200" />
                    <div className="h-80 rounded-lg bg-gray-200" />
                </div>
            </div>
        </main>
    );
}

export default function ReportAnalyticsPage() {
    const analyticsQuery = useQuery({
        queryKey: ["reports", "analytics"],
        queryFn: async ({ signal }) => {
            const init = { signal };
            const [summaryResult, typeResult, statusResult, regionResult, reportersResult] = await Promise.allSettled([
                getReportAnalyticsSummary(init),
                getReportAnalyticsByType(init),
                getReportAnalyticsByStatus(init),
                getReportAnalyticsByRegion(init),
                getReportAnalyticsAnonymous(init),
            ]);
            if (summaryResult.status === "rejected") throw summaryResult.reason;
            const failedSections = [typeResult, statusResult, regionResult, reportersResult].filter((result) => result.status === "rejected").length;
            return {
                summary: summaryResult.value,
                byType: typeResult.status === "fulfilled" ? typeResult.value : [],
                byStatus: statusResult.status === "fulfilled" ? statusResult.value : [],
                byRegion: regionResult.status === "fulfilled" ? regionResult.value : [],
                reporters: reportersResult.status === "fulfilled" ? reportersResult.value : { anonymous: 0, logged_in: 0 },
                failedSections,
            };
        },
        staleTime: 60_000,
    });

    const data = analyticsQuery.data;
    const typeData = useMemo(
        () => (data?.byType ?? []).filter((row) => row.count > 0).map((row) => ({ name: reportTypeLabel(row.code), count: row.count })),
        [data?.byType],
    );
    const statusData = useMemo(
        () => (data?.byStatus ?? []).filter((row) => row.count > 0).map((row) => ({ name: statusLabel(row.code), count: row.count })),
        [data?.byStatus],
    );
    const regionData = useMemo(
        () => (data?.byRegion ?? []).filter((row) => row.count > 0).slice(0, 10).map((row) => ({ name: row.region_name ?? "Unassigned", count: row.count })),
        [data?.byRegion],
    );

    if (analyticsQuery.isPending) return <AnalyticsSkeleton />;

    const summary = data?.summary;
    const openBacklog = summary ? summary.submitted + summary.in_review + summary.needs_more_info : 0;
    const closed = summary ? summary.accepted + summary.rejected + summary.duplicate + summary.resolved : 0;
    const completionRate = summary && summary.total > 0 ? Math.round((closed / summary.total) * 100) : 0;
    const loggedInShare = data?.reporters && summary && summary.total > 0
        ? Math.round((data.reporters.logged_in / summary.total) * 100)
        : 0;

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-gray-200 pb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Report analytics</h1>
                        <p className="mt-1 text-sm text-gray-600">Operational health of the reports queue and its current backlog.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {analyticsQuery.dataUpdatedAt ? <span className="hidden text-xs text-gray-500 sm:inline">Updated {new Date(analyticsQuery.dataUpdatedAt).toLocaleTimeString()}</span> : null}
                        <button type="button" onClick={() => void analyticsQuery.refetch()} disabled={analyticsQuery.isFetching} className={BUTTON_CLASS}>
                            <RefreshCw className={`h-4 w-4 ${analyticsQuery.isFetching ? "animate-spin" : ""}`} aria-hidden />
                            Refresh
                        </button>
                        <Link href={reportsPath()} prefetch={false} className={BUTTON_CLASS}>Reports queue</Link>
                    </div>
                </header>

                {analyticsQuery.error ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        <span>{analyticsQuery.error instanceof Error ? analyticsQuery.error.message : "Failed to load report analytics."}</span>
                        <button type="button" onClick={() => void analyticsQuery.refetch()} className="font-semibold underline underline-offset-2">Try again</button>
                    </div>
                ) : null}

                {data && data.failedSections > 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        {data.failedSections} analytics section{data.failedSections === 1 ? "" : "s"} could not refresh. Available metrics are still shown.
                    </div>
                ) : null}

                {summary ? (
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                        <StatsCard title="Open backlog" value={openBacklog} description="Requires action" statusColor={openBacklog > 0 ? "warning" : "success"} />
                        <StatsCard title="Submitted" value={summary.submitted} description="Not started" />
                        <StatsCard title="In review" value={summary.in_review} description="Active reviews" />
                        <StatsCard title="Needs info" value={summary.needs_more_info} description="Waiting on users" statusColor={summary.needs_more_info > 0 ? "warning" : "default"} />
                        <StatsCard title="Closed" value={closed} description={`${completionRate}% of all reports`} statusColor="success" />
                        <StatsCard title="New this week" value={summary.this_week} description={`${summary.this_month.toLocaleString()} this month`} />
                    </div>
                ) : null}

                <section className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 text-sm shadow-sm sm:grid-cols-3">
                    <div><span className="text-gray-500">Total reports</span><strong className="ml-2 tabular-nums text-gray-900">{summary?.total ?? 0}</strong></div>
                    <div><span className="text-gray-500">Logged-in reporters</span><strong className="ml-2 tabular-nums text-gray-900">{data?.reporters.logged_in ?? 0} ({loggedInShare}%)</strong></div>
                    <div><span className="text-gray-500">Anonymous reports</span><strong className="ml-2 tabular-nums text-gray-900">{data?.reporters.anonymous ?? 0}</strong></div>
                </section>

                <div className="grid gap-6 lg:grid-cols-2">
                    <ChartCard title="Queue by status" subtitle="Only statuses containing reports are shown">
                        {statusData.length === 0 ? <EmptyChart label="No reports yet." /> : (
                            <ResponsiveContainer>
                                <BarChart data={statusData} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 16 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                                    <Tooltip cursor={{ fill: "#f8fafc" }} />
                                    <Bar dataKey="count" name="Reports" fill="#0891b2" radius={[0, 5, 5, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </ChartCard>

                    <ChartCard title="Reports by type" subtitle="Report categories ranked by volume">
                        {typeData.length === 0 ? <EmptyChart label="No reports yet." /> : (
                            <ResponsiveContainer>
                                <BarChart data={typeData} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 16 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={125} />
                                    <Tooltip cursor={{ fill: "#f8fafc" }} />
                                    <Bar dataKey="count" name="Reports" fill="#4f46e5" radius={[0, 5, 5, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </ChartCard>

                    <div className="lg:col-span-2">
                        <ChartCard title="Top admin areas" subtitle="Ten admin areas with the highest report volume">
                            {regionData.length === 0 ? <EmptyChart label="No reports with a region yet." /> : (
                                <ResponsiveContainer>
                                    <BarChart data={regionData} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 16 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                                        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={210} />
                                        <Tooltip cursor={{ fill: "#f8fafc" }} />
                                        <Bar dataKey="count" name="Reports" fill="#16a34a" radius={[0, 5, 5, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </ChartCard>
                    </div>
                </div>
            </div>
        </main>
    );
}
