"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { referencesPath } from "@/src/lib/dashboardPaths";

import { createReferenceRow, listReferenceRows, updateReferenceRow } from "./api";
import { getReferenceUiConfig } from "./registry";
import type { ReferenceFieldDef, ReferenceTypeKey } from "./types";

const PRIMARY_BTN =
    "rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50";
const SECONDARY_BTN =
    "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const INPUT_CLASS =
    "mt-1 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

type Banner = { tone: "success" | "error"; message: string } | null;
type DialogMode = { kind: "create" } | { kind: "edit"; row: Record<string, unknown> } | null;

function displayValue(value: unknown): string {
    if (value === null || value === undefined) return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
}

function buildInitialValues(
    fields: ReferenceFieldDef[],
    row: Record<string, unknown> | null,
    mode: "create" | "edit",
): Record<string, string> {
    const values: Record<string, string> = {};
    for (const field of fields) {
        if (mode === "edit" && field.createOnly) continue;
        if (mode === "create" && !(field.createOnly || field.editable || field.required)) continue;
        if (mode === "edit" && !field.editable && !field.createOnly) continue;

        const raw = row?.[field.key];
        if (field.kind === "boolean") {
            values[field.key] = raw === false ? "false" : "true";
        } else if (raw === null || raw === undefined) {
            values[field.key] = "";
        } else {
            values[field.key] = String(raw);
        }
    }
    return values;
}

function formFields(fields: ReferenceFieldDef[], mode: "create" | "edit"): ReferenceFieldDef[] {
    return fields.filter((field) => {
        if (mode === "create") {
            return Boolean(field.createOnly || field.editable || field.required);
        }
        return Boolean(field.editable);
    });
}

function toPayload(
    fields: ReferenceFieldDef[],
    values: Record<string, string>,
    mode: "create" | "edit",
): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const field of formFields(fields, mode)) {
        const raw = values[field.key] ?? "";
        if (field.kind === "boolean") {
            payload[field.key] = raw === "true";
            continue;
        }
        if (field.kind === "number") {
            if (raw.trim() === "") {
                if (field.required) {
                    throw new Error(`${field.label} is required.`);
                }
                continue;
            }
            const n = Number(raw);
            if (!Number.isFinite(n)) {
                throw new Error(`${field.label} must be a number.`);
            }
            payload[field.key] = n;
            continue;
        }
        if (field.kind === "parent") {
            payload[field.key] = raw.trim() === "" ? null : raw.trim();
            continue;
        }
        if (field.kind === "select") {
            payload[field.key] = raw.trim() === "" ? null : raw.trim();
            continue;
        }
        const text = raw.trim();
        if (!text) {
            if (field.required || field.createOnly) {
                throw new Error(`${field.label} is required.`);
            }
            payload[field.key] = null;
            continue;
        }
        payload[field.key] = text;
    }
    return payload;
}

function ReferenceFormBody({
    mode,
    singularLabel,
    fields,
    items,
    hierarchical,
    saving,
    error,
    onClose,
    onSubmit,
}: {
    mode: Exclude<DialogMode, null>;
    singularLabel: string;
    fields: ReferenceFieldDef[];
    items: Record<string, unknown>[];
    hierarchical: boolean;
    saving: boolean;
    error: string | null;
    onClose: () => void;
    onSubmit: (payload: Record<string, unknown>) => void;
}) {
    const isCreate = mode.kind === "create";
    const formMode = isCreate ? "create" : "edit";
    const visible = formFields(fields, formMode);
    const [values, setValues] = useState(() =>
        buildInitialValues(fields, mode.kind === "edit" ? mode.row : null, formMode),
    );
    const [localError, setLocalError] = useState<string | null>(null);

    const parentOptions = hierarchical
        ? items.filter((item) => {
              if (mode.kind !== "edit") return true;
              return String(item.id) !== String(mode.row.id);
          })
        : [];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div
                role="dialog"
                aria-modal="true"
                className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
            >
                <h2 className="text-lg font-semibold text-gray-900">
                    {isCreate ? `Add ${singularLabel}` : `Edit ${singularLabel}`}
                </h2>

                <div className="mt-4 space-y-3">
                    {visible.map((field) => (
                        <label key={field.key} className="block text-sm text-gray-700">
                            {field.label}
                            {field.required || field.createOnly ? " *" : ""}
                            {field.kind === "boolean" ? (
                                <select
                                    className={INPUT_CLASS}
                                    value={values[field.key] ?? "true"}
                                    onChange={(e) =>
                                        setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                                    }
                                >
                                    <option value="true">Yes</option>
                                    <option value="false">No</option>
                                </select>
                            ) : field.kind === "parent" ? (
                                <select
                                    className={INPUT_CLASS}
                                    value={values[field.key] ?? ""}
                                    onChange={(e) =>
                                        setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                                    }
                                >
                                    <option value="">None</option>
                                    {parentOptions.map((item) => (
                                        <option key={String(item.id)} value={String(item.id)}>
                                            {String(item.code)} —{" "}
                                            {String(item.name ?? item.name_en ?? item.id)}
                                        </option>
                                    ))}
                                </select>
                            ) : field.kind === "select" ? (
                                <select
                                    className={INPUT_CLASS}
                                    value={values[field.key] ?? ""}
                                    onChange={(e) =>
                                        setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                                    }
                                >
                                    <option value="">None</option>
                                    {(field.options ?? []).map((opt) => (
                                        <option key={opt} value={opt}>
                                            {opt}
                                        </option>
                                    ))}
                                </select>
                            ) : field.kind === "textarea" ? (
                                <textarea
                                    className={INPUT_CLASS}
                                    rows={3}
                                    value={values[field.key] ?? ""}
                                    onChange={(e) =>
                                        setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                                    }
                                />
                            ) : (
                                <input
                                    type={field.kind === "number" ? "number" : "text"}
                                    className={INPUT_CLASS}
                                    value={values[field.key] ?? ""}
                                    min={field.min}
                                    max={field.max}
                                    onChange={(e) =>
                                        setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                                    }
                                />
                            )}
                        </label>
                    ))}
                </div>

                {localError || error ? (
                    <p className="mt-3 text-sm text-red-700" role="alert">
                        {localError || error}
                    </p>
                ) : null}

                <div className="mt-5 flex justify-end gap-2">
                    <button type="button" className={SECONDARY_BTN} onClick={onClose} disabled={saving}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className={PRIMARY_BTN}
                        disabled={saving}
                        onClick={() => {
                            try {
                                setLocalError(null);
                                onSubmit(toPayload(fields, values, formMode));
                            } catch (err) {
                                setLocalError(err instanceof Error ? err.message : "Invalid form.");
                            }
                        }}
                    >
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function ReferenceFormDialog({
    open,
    mode,
    singularLabel,
    fields,
    items,
    hierarchical,
    saving,
    error,
    onClose,
    onSubmit,
}: {
    open: boolean;
    mode: DialogMode;
    singularLabel: string;
    fields: ReferenceFieldDef[];
    items: Record<string, unknown>[];
    hierarchical: boolean;
    saving: boolean;
    error: string | null;
    onClose: () => void;
    onSubmit: (payload: Record<string, unknown>) => void;
}) {
    if (!open || !mode) return null;

    const openKey =
        mode.kind === "edit" ? `edit:${String(mode.row.id)}` : "create:new";

    return (
        <ReferenceFormBody
            key={openKey}
            mode={mode}
            singularLabel={singularLabel}
            fields={fields}
            items={items}
            hierarchical={hierarchical}
            saving={saving}
            error={error}
            onClose={onClose}
            onSubmit={onSubmit}
        />
    );
}

export default function ReferenceDataPage({ type }: { type: ReferenceTypeKey }) {
    const ui = getReferenceUiConfig(type);
    const queryClient = useQueryClient();
    const [search, setSearch] = useState("");
    const [banner, setBanner] = useState<Banner>(null);
    const [dialog, setDialog] = useState<DialogMode>(null);
    const [formError, setFormError] = useState<string | null>(null);

    const listQuery = useQuery({
        queryKey: ["reference-data", type],
        queryFn: ({ signal }) => listReferenceRows(type, { signal }),
    });

    const createMutation = useMutation({
        mutationFn: (body: Record<string, unknown>) => createReferenceRow(type, body),
        onSuccess: async () => {
            setDialog(null);
            setBanner({ tone: "success", message: `${ui.singularLabel} created.` });
            await queryClient.invalidateQueries({ queryKey: ["reference-data", type] });
            await queryClient.invalidateQueries({ queryKey: ["reference-data", "catalog"] });
        },
        onError: (err) => {
            setFormError(err instanceof Error ? err.message : "Create failed.");
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
            updateReferenceRow(type, id, body),
        onSuccess: async () => {
            setDialog(null);
            setBanner({ tone: "success", message: `${ui.singularLabel} updated.` });
            await queryClient.invalidateQueries({ queryKey: ["reference-data", type] });
            await queryClient.invalidateQueries({ queryKey: ["reference-data", "catalog"] });
        },
        onError: (err) => {
            setFormError(err instanceof Error ? err.message : "Update failed.");
        },
    });

    const fields = listQuery.data?.fields ?? [];
    const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data?.items]);
    const hierarchical = listQuery.data?.hierarchical ?? false;
    const listColumns = fields.filter((f) => f.list);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return items;
        return items.filter((item) =>
            Object.values(item).some((value) => String(value ?? "").toLowerCase().includes(q)),
        );
    }, [items, search]);

    const parentLabel = (parentId: unknown) => {
        if (parentId === null || parentId === undefined || parentId === "") return "—";
        const parent = items.find((item) => String(item.id) === String(parentId));
        if (!parent) return String(parentId);
        return String(parent.code ?? parent.name ?? parent.name_en ?? parentId);
    };

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <nav className="text-sm text-gray-500">
                    <Link href={referencesPath()} className="hover:text-gray-800">
                        Reference data
                    </Link>
                    <span className="mx-1.5">/</span>
                    <span className="text-gray-800">{ui.label}</span>
                </nav>

                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">{ui.label}</h1>
                        <p className="mt-2 text-sm text-gray-600">{ui.description}</p>
                    </div>
                    <button
                        type="button"
                        className={PRIMARY_BTN}
                        onClick={() => {
                            setFormError(null);
                            setDialog({ kind: "create" });
                        }}
                    >
                        Add {ui.singularLabel}
                    </button>
                </div>

                {banner ? (
                    <p
                        className={
                            banner.tone === "success"
                                ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                                : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                        }
                        role="status"
                    >
                        {banner.message}
                    </p>
                ) : null}

                <div className="flex flex-wrap items-end gap-2">
                    <label className="text-sm text-gray-700">
                        Search
                        <input
                            className={`${INPUT_CLASS} w-64`}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Filter rows"
                        />
                    </label>
                </div>

                {listQuery.isLoading ? (
                    <p className="text-sm text-gray-600">Loading…</p>
                ) : listQuery.isError ? (
                    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                        {listQuery.error instanceof Error
                            ? listQuery.error.message
                            : "Unable to load reference rows."}
                    </p>
                ) : filtered.length === 0 ? (
                    <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-6 text-center text-sm text-gray-600">
                        No reference rows yet.
                    </p>
                ) : (
                    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    {listColumns.map((col) => (
                                        <th
                                            key={col.key}
                                            className="px-3 py-2 text-left font-medium text-gray-700"
                                        >
                                            {col.label}
                                        </th>
                                    ))}
                                    <th className="px-3 py-2 text-left font-medium text-gray-700">In use</th>
                                    <th className="px-3 py-2 text-right font-medium text-gray-700">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filtered.map((row) => (
                                    <tr key={String(row.id)} className="hover:bg-gray-50">
                                        {listColumns.map((col) => (
                                            <td key={col.key} className="px-3 py-2 text-gray-800">
                                                {col.kind === "parent"
                                                    ? parentLabel(row[col.key])
                                                    : displayValue(row[col.key])}
                                            </td>
                                        ))}
                                        <td className="px-3 py-2 text-gray-700">
                                            {row.usage_count === null || row.usage_count === undefined
                                                ? "—"
                                                : Number(row.usage_count) > 0
                                                  ? `Yes (${row.usage_count})`
                                                  : "No"}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <button
                                                type="button"
                                                className={SECONDARY_BTN}
                                                onClick={() => {
                                                    setFormError(null);
                                                    setDialog({ kind: "edit", row });
                                                }}
                                            >
                                                Edit
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <ReferenceFormDialog
                open={dialog !== null}
                mode={dialog}
                singularLabel={ui.singularLabel}
                fields={fields}
                items={items}
                hierarchical={hierarchical}
                saving={createMutation.isPending || updateMutation.isPending}
                error={formError}
                onClose={() => setDialog(null)}
                onSubmit={(payload) => {
                    setFormError(null);
                    if (dialog?.kind === "create") {
                        createMutation.mutate(payload);
                    } else if (dialog?.kind === "edit") {
                        updateMutation.mutate({ id: String(dialog.row.id), body: payload });
                    }
                }}
            />
        </main>
    );
}
