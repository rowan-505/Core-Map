"use client";

import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { getAdminAreaOptions } from "@/src/lib/api";
import { tourismPath } from "@/src/lib/dashboardPaths";

import { listAdminTourismFoods } from "./api";
import { TOURISM_FOOD_LABELS, TOURISM_FOOD_TYPES } from "./types";

const SELECT_CLASS =
  "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const PRIMARY_BTN =
  "rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800";
const SECONDARY_BTN =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const PAGE_SIZE = 20;

export default function TourismFoodsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const adminAreaId = searchParams.get("admin_area_id")?.trim() || "";
  const foodType = searchParams.get("food_type")?.trim() || "";
  const label = searchParams.get("label")?.trim() || "";
  const isActive = searchParams.get("is_active")?.trim() || "";
  const isVerified = searchParams.get("is_verified")?.trim() || "";
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
      admin_area_id: adminAreaId || undefined,
      food_type: foodType || undefined,
      label: label || undefined,
      is_active: isActive === "" ? undefined : isActive === "true",
      is_verified: isVerified === "" ? undefined : isVerified === "true",
      q: q || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [adminAreaId, foodType, label, isActive, isVerified, q, offset],
  );

  const listQuery = useQuery({
    queryKey: ["tourism-visitor", "foods", filters],
    queryFn: ({ signal }) => listAdminTourismFoods(filters, { signal }),
    placeholderData: keepPreviousData,
  });
  const areasQuery = useQuery({
    queryKey: ["admin-area-options", "tourism-foods", areaQuery],
    queryFn: () =>
      getAdminAreaOptions({ limit: 200, q: areaQuery || undefined, townshipOnly: true }),
  });

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Foods</h1>
          <p className="mt-1 text-sm text-gray-600">Curated local foods by township.</p>
        </div>
        <Link href={tourismPath("foods/new")} className={PRIMARY_BTN}>
          New food
        </Link>
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
          Type
          <select
            value={foodType}
            onChange={(e) => replaceFilters({ food_type: e.target.value || null })}
            className={`${SELECT_CLASS} ml-2`}
          >
            <option value="">All types</option>
            {TOURISM_FOOD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-700">
          Label
          <select
            value={label}
            onChange={(e) => replaceFilters({ label: e.target.value || null })}
            className={`${SELECT_CLASS} ml-2`}
          >
            <option value="">Any label</option>
            {TOURISM_FOOD_LABELS.map((l) => (
              <option key={l} value={l}>
                {l}
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
        <label className="text-sm text-gray-700">
          Active
          <select
            value={isActive}
            onChange={(e) => replaceFilters({ is_active: e.target.value || null })}
            className={`${SELECT_CLASS} ml-2`}
          >
            <option value="">Any</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
        <label className="text-sm text-gray-700">
          Verified
          <select
            value={isVerified}
            onChange={(e) => replaceFilters({ is_verified: e.target.value || null })}
            className={`${SELECT_CLASS} ml-2`}
          >
            <option value="">Any</option>
            <option value="true">Verified</option>
            <option value="false">Unverified</option>
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
          {listQuery.error instanceof Error ? listQuery.error.message : "Failed to load foods"}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Township</th>
              <th className="px-3 py-2">Labels</th>
              <th className="px-3 py-2">Places</th>
              <th className="px-3 py-2">Verified</th>
              <th className="px-3 py-2">Active</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.public_id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2">
                  <Link
                    href={tourismPath(`foods/${row.public_id}`)}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-gray-700">{row.food_type}</td>
                <td className="px-3 py-2 text-gray-700">{row.admin_area_name}</td>
                <td className="px-3 py-2 text-gray-700">
                  {row.labels.length ? row.labels.join(", ") : "—"}
                </td>
                <td className="px-3 py-2 text-gray-700">{row.places.length}</td>
                <td className="px-3 py-2">{row.is_verified ? "Yes" : "No"}</td>
                <td className="px-3 py-2">{row.is_active ? "Yes" : "No"}</td>
              </tr>
            ))}
            {!listQuery.isLoading && items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                  No foods found.
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
