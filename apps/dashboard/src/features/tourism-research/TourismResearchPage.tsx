"use client";

import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { getAdminAreaOptions } from "@/src/lib/api";
import { tourismPath } from "@/src/lib/dashboardPaths";

import { listAdminTourismResearch } from "./api";
import {
  TOURISM_RESEARCH_ENTITY_TYPES,
  TOURISM_RESEARCH_STATUSES,
  entityTypeLabel,
  researchStatusLabel,
} from "./types";

const SELECT_CLASS =
  "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const SECONDARY_BTN =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const TAB_ACTIVE = "rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white";
const TAB_IDLE =
  "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50";
const PAGE_SIZE = 20;

function statusBadgeClass(status: string) {
  if (status === "new") return "bg-blue-100 text-blue-900";
  if (status === "reviewing") return "bg-amber-100 text-amber-900";
  if (status === "added") return "bg-emerald-100 text-emerald-800";
  if (status === "rejected") return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-700";
}

export default function TourismResearchPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const researchStatus = searchParams.get("research_status")?.trim() || "";
  const entityType = searchParams.get("entity_type")?.trim() || "";
  const adminAreaId = searchParams.get("admin_area_id")?.trim() || "";
  const q = searchParams.get("q")?.trim() || "";
  const offset = Number(searchParams.get("offset") || "0") || 0;
  const [searchDraft, setSearchDraft] = useState(q);
  const [areaQuery, setAreaQuery] = useState("");

  const replaceFilters = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    if (!("offset" in patch)) next.delete("offset");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const filters = useMemo(
    () => ({
      research_status: researchStatus || undefined,
      entity_type: entityType || undefined,
      admin_area_id: adminAreaId || undefined,
      q: q || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [researchStatus, entityType, adminAreaId, q, offset],
  );

  const listQuery = useQuery({
    queryKey: ["tourism-research", "list", filters],
    queryFn: ({ signal }) => listAdminTourismResearch(filters, { signal }),
    placeholderData: keepPreviousData,
  });
  const areasQuery = useQuery({
    queryKey: ["admin-area-options", "tourism-research", areaQuery],
    queryFn: () =>
      getAdminAreaOptions({ limit: 200, q: areaQuery || undefined, townshipOnly: true }),
  });

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Research candidates</h1>
        <p className="mt-1 text-sm text-gray-600">
          Staging records from research runs — not shown on the public map.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-2">
        <button
          type="button"
          className={!researchStatus ? TAB_ACTIVE : TAB_IDLE}
          onClick={() => replaceFilters({ research_status: null })}
        >
          All statuses
        </button>
        {TOURISM_RESEARCH_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={researchStatus === status ? TAB_ACTIVE : TAB_IDLE}
            onClick={() => replaceFilters({ research_status: status })}
          >
            {researchStatusLabel(status)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-gray-700">
          Search
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") replaceFilters({ q: searchDraft.trim() || null });
            }}
            className={`${SELECT_CLASS} ml-2 w-48`}
            placeholder="Name"
          />
        </label>
        <label className="text-sm text-gray-700">
          Entity type
          <select
            value={entityType}
            onChange={(e) => replaceFilters({ entity_type: e.target.value || null })}
            className={`${SELECT_CLASS} ml-2`}
          >
            <option value="">All types</option>
            {TOURISM_RESEARCH_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {entityTypeLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-700">
          Township
          <input
            value={areaQuery}
            onChange={(e) => setAreaQuery(e.target.value)}
            className={`${SELECT_CLASS} ml-2 w-36`}
            placeholder="Filter townships"
          />
          <select
            value={adminAreaId}
            onChange={(e) => replaceFilters({ admin_area_id: e.target.value || null })}
            className={`${SELECT_CLASS} ml-2 max-w-xs`}
          >
            <option value="">All townships</option>
            {(areasQuery.data ?? []).map((area) => (
              <option key={area.id} value={area.id}>
                {area.canonical_name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={SECONDARY_BTN}
          onClick={() => replaceFilters({ q: searchDraft.trim() || null })}
        >
          Apply
        </button>
      </div>

      {listQuery.isError ? (
        <p className="text-sm text-red-700">
          {listQuery.error instanceof Error ? listQuery.error.message : "Failed to load research"}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Township</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Confidence</th>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2">Researched</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.public_id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2">
                  <Link
                    href={tourismPath(`research/${row.public_id}`)}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-gray-700">{entityTypeLabel(row.entity_type)}</td>
                <td className="px-3 py-2 text-gray-700">{row.admin_area_name}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${statusBadgeClass(row.research_status)}`}
                  >
                    {researchStatusLabel(row.research_status)}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-700">
                  {row.evidence_confidence != null ? row.evidence_confidence : "—"}
                </td>
                <td className="px-3 py-2 text-gray-700">{row.research_provider}</td>
                <td className="px-3 py-2 text-gray-700">
                  {new Date(row.researched_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {!listQuery.isLoading && items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                  No research candidates found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={SECONDARY_BTN}
          disabled={offset <= 0}
          onClick={() =>
            replaceFilters({ offset: String(Math.max(0, offset - PAGE_SIZE)) || null })
          }
        >
          Previous
        </button>
        <button
          type="button"
          className={SECONDARY_BTN}
          disabled={offset + PAGE_SIZE >= total}
          onClick={() => replaceFilters({ offset: String(offset + PAGE_SIZE) })}
        >
          Next
        </button>
        <span className="text-sm text-gray-500">
          {total === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)}`} of {total}
        </span>
      </div>
    </div>
  );
}
