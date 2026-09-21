import { apiFetch } from "@/src/lib/api";

import type { ReferenceCatalogItem, ReferenceListResponse, ReferenceTypeKey } from "./types";

export function listReferenceCatalog(init?: Pick<RequestInit, "signal">) {
    return apiFetch<{ items: ReferenceCatalogItem[] }>(
        "/admin/references",
        { method: "GET", ...init },
    );
}

export function listReferenceRows(type: ReferenceTypeKey, init?: Pick<RequestInit, "signal">) {
    return apiFetch<ReferenceListResponse>(`/admin/references/${type}`, {
        method: "GET",
        ...init,
    });
}

export function createReferenceRow(
    type: ReferenceTypeKey,
    body: Record<string, unknown>,
) {
    return apiFetch<Record<string, unknown>>(`/admin/references/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

export function updateReferenceRow(
    type: ReferenceTypeKey,
    id: string,
    body: Record<string, unknown>,
) {
    return apiFetch<Record<string, unknown>>(`/admin/references/${type}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}
