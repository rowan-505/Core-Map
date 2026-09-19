"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { getAdminAreaOptions } from "@/src/lib/api";
import { coreReviewPath } from "@/src/lib/dashboardPaths";

import {
  listAdminFoodDrinkRecommendations,
  type FoodDrinkAdminRankedPlace,
} from "./foodRecommendationsApi";

const SELECT_CLASS =
  "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const PAGE_SIZE = 25;

export default function FoodRecommendationsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const townshipId = searchParams.get("township_admin_area_id")?.trim() || "";
  const offset = Number(searchParams.get("offset") || "0") || 0;
  const [areaQuery, setAreaQuery] = useState("");

  const replaceFilters = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value == null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  const areasQuery = useQuery({
    queryKey: ["admin-area-options", "township", areaQuery],
    queryFn: () =>
      getAdminAreaOptions({
        limit: 500,
        q: areaQuery || undefined,
        townshipOnly: true,
      }),
  });

  const rankingQuery = useQuery({
    queryKey: ["admin-food-drink-recommendations", townshipId, offset],
    queryFn: ({ signal }) =>
      listAdminFoodDrinkRecommendations(
        {
          township_admin_area_id: townshipId,
          limit: PAGE_SIZE,
          offset,
        },
        { signal }
      ),
    enabled: Boolean(townshipId),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Recommendations / Ranking</h1>
        <p className="mt-1 text-sm text-gray-600">
          Food &amp; Drink township recommendations V1. Read-only scores from community reviews,
          food popularity, and place importance. No restaurant editorial score or manual boost.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Ranking group
          </span>
          <select className={SELECT_CLASS} value="food_drink" disabled>
            <option value="food_drink">Food &amp; Drink</option>
          </select>
        </label>

        <label className="min-w-[16rem] flex-1 space-y-1 text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Township
          </span>
          <input
            className={SELECT_CLASS + " mb-1 w-full"}
            placeholder="Filter townships…"
            value={areaQuery}
            onChange={(e) => setAreaQuery(e.target.value)}
          />
          <select
            className={SELECT_CLASS + " w-full"}
            value={townshipId}
            onChange={(e) =>
              replaceFilters({
                township_admin_area_id: e.target.value || null,
                offset: "0",
              })
            }
          >
            <option value="">Select township</option>
            {(areasQuery.data ?? []).map((area) => (
              <option key={area.id} value={area.id}>
                {area.name_en || area.canonical_name} ({area.admin_level_code})
              </option>
            ))}
          </select>
        </label>
      </div>

      {!townshipId ? (
        <p className="text-sm text-amber-800">Select a township to load Food &amp; Drink ranking.</p>
      ) : rankingQuery.isError ? (
        <p className="text-sm text-red-700">Could not load Food &amp; Drink recommendations.</p>
      ) : rankingQuery.isLoading ? (
        <p className="text-sm text-gray-600">Loading ranking…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Rank</th>
                <th className="px-3 py-2">Place</th>
                <th className="px-3 py-2">Rating</th>
                <th className="px-3 py-2">Reviews</th>
                <th className="px-3 py-2">Review score</th>
                <th className="px-3 py-2">Popularity</th>
                <th className="px-3 py-2">Importance</th>
                <th className="px-3 py-2">Final score</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(rankingQuery.data?.items ?? []).map((item) => (
                <FoodRankRow key={item.public_id} item={item} />
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 text-sm">
            <span className="text-gray-600">
              {rankingQuery.data?.total ?? 0} places · {rankingQuery.data?.township_name ?? townshipId}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
                disabled={offset <= 0}
                onClick={() =>
                  replaceFilters({ offset: String(Math.max(0, offset - PAGE_SIZE)) })
                }
              >
                Previous
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40"
                disabled={offset + PAGE_SIZE >= (rankingQuery.data?.total ?? 0)}
                onClick={() => replaceFilters({ offset: String(offset + PAGE_SIZE) })}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FoodRankRow({ item }: { readonly item: FoodDrinkAdminRankedPlace }) {
  return (
    <tr className="border-t border-gray-100">
      <td className="px-3 py-2 font-medium">#{item.rank}</td>
      <td className="px-3 py-2">
        <div className="font-medium text-gray-900">{item.name}</div>
        <div className="text-xs text-gray-500">{item.category_code}</div>
      </td>
      <td className="px-3 py-2">
        {item.average_rating != null ? item.average_rating.toFixed(1) : "—"}
      </td>
      <td className="px-3 py-2">{item.published_review_count}</td>
      <td className="px-3 py-2">{item.review_score.toFixed(1)}</td>
      <td className="px-3 py-2">{item.popularity_score}</td>
      <td className="px-3 py-2">{item.importance_score}</td>
      <td className="px-3 py-2 font-medium">{item.food_score.toFixed(2)}</td>
      <td className="px-3 py-2 text-right">
        <Link
          href={coreReviewPath(`places/${item.public_id}/edit`)}
          className="text-xs font-medium text-gray-900 underline"
        >
          Open place
        </Link>
      </td>
    </tr>
  );
}
