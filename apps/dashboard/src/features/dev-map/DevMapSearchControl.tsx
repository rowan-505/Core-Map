"use client";

import { useEffect, useId, useRef, useState } from "react";

import { isAbortError } from "@/src/lib/api";

import {
    DEV_MAP_SEARCH_INPUT_TEST_ID,
    DEV_MAP_SEARCH_RESULTS_TEST_ID,
    DEV_MAP_SEARCH_TEST_ID,
} from "./devMapChromeIds";
import { getDevMapEntityEntry } from "./devMapEntityRegistry";
import {
    getDevMapSearchDebounceMs,
    runDevMapSearch,
    type DevMapSearchHit,
} from "./devMapSearch";

export type DevMapSearchControlProps = {
    disabled?: boolean;
    onSelectHit: (hit: DevMapSearchHit) => void | Promise<void>;
};

/**
 * Compact top-bar search — debounced, abortable, dropdown results only.
 * Selecting a hit calls the parent (same selection/inspector path as map click).
 */
export function DevMapSearchControl({ disabled = false, onSelectHit }: DevMapSearchControlProps) {
    const listId = useId();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hits, setHits] = useState<DevMapSearchHit[]>([]);
    const [selecting, setSelecting] = useState(false);

    useEffect(() => {
        if (disabled) {
            setHits([]);
            setError(null);
            setLoading(false);
            return;
        }

        const trimmed = query.trim();
        if (!trimmed) {
            setHits([]);
            setError(null);
            setLoading(false);
            return;
        }

        const controller = new AbortController();
        const handle = window.setTimeout(() => {
            setLoading(true);
            setError(null);
            void runDevMapSearch(trimmed, controller.signal)
                .then((next) => {
                    if (controller.signal.aborted) return;
                    setHits(next);
                    setOpen(true);
                })
                .catch((err) => {
                    if (isAbortError(err) || controller.signal.aborted) return;
                    setHits([]);
                    setError(err instanceof Error ? err.message : "Search failed.");
                    setOpen(true);
                })
                .finally(() => {
                    if (!controller.signal.aborted) {
                        setLoading(false);
                    }
                });
        }, getDevMapSearchDebounceMs());

        return () => {
            window.clearTimeout(handle);
            controller.abort();
        };
    }, [query, disabled]);

    useEffect(() => {
        const onPointerDown = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        window.addEventListener("mousedown", onPointerDown);
        return () => window.removeEventListener("mousedown", onPointerDown);
    }, []);

    const onPick = async (hit: DevMapSearchHit) => {
        setSelecting(true);
        setError(null);
        try {
            await onSelectHit(hit);
            setOpen(false);
            setQuery(hit.label);
        } catch (err) {
            if (isAbortError(err)) return;
            setError(err instanceof Error ? err.message : "Could not open result.");
            setOpen(true);
        } finally {
            setSelecting(false);
        }
    };

    return (
        <div
            ref={rootRef}
            data-testid={DEV_MAP_SEARCH_TEST_ID}
            className="relative min-w-[12rem] flex-1 max-w-xs"
        >
            <input
                type="search"
                data-testid={DEV_MAP_SEARCH_INPUT_TEST_ID}
                aria-autocomplete="list"
                aria-controls={listId}
                aria-expanded={open}
                disabled={disabled || selecting}
                placeholder="Search places, streets…"
                value={query}
                className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none disabled:opacity-50"
                onChange={(event) => {
                    setQuery(event.target.value);
                    setOpen(true);
                }}
                onFocus={() => {
                    if (hits.length > 0 || error) setOpen(true);
                }}
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        setOpen(false);
                    }
                }}
            />
            {open && (loading || error || hits.length > 0 || query.trim().length > 0) ? (
                <div
                    id={listId}
                    role="listbox"
                    data-testid={DEV_MAP_SEARCH_RESULTS_TEST_ID}
                    className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded border border-slate-200 bg-white py-1 shadow-md"
                >
                    {loading ? (
                        <p className="px-2 py-1.5 text-[11px] text-slate-500">Searching…</p>
                    ) : null}
                    {error ? (
                        <p className="px-2 py-1.5 text-[11px] text-red-600">{error}</p>
                    ) : null}
                    {!loading && !error && hits.length === 0 && query.trim().length > 0 ? (
                        <p className="px-2 py-1.5 text-[11px] text-slate-500">No matches</p>
                    ) : null}
                    {hits.map((hit) => {
                        const entry = getDevMapEntityEntry(hit.entityType);
                        return (
                            <button
                                key={hit.key}
                                type="button"
                                role="option"
                                data-search-hit-key={hit.key}
                                data-entity-type={hit.entityType}
                                className="flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-slate-50"
                                onClick={() => {
                                    void onPick(hit);
                                }}
                            >
                                <span className="text-xs font-medium text-slate-800">
                                    {hit.label}
                                </span>
                                <span className="text-[10px] text-slate-500">
                                    {entry.label}
                                    {hit.subtitle ? ` · ${hit.subtitle}` : ""}
                                </span>
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
