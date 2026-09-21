export type AddressComponentDto = {
    id?: string | null;
    component_type_code: string | null;
    component_value: string | null;
    language_code: string | null;
    sort_order?: number | null;
    confidence_score?: number | null;
    match_type?: string | null;
    source_tag?: string | null;
    is_inferred?: boolean | null;
    is_reviewed?: boolean | null;
    source_admin_area_id?: string | null;
    boundary_status?: string | null;
    address_usage?: string | null;
};

export type AddressComponentsPatchBody = {
    upsert: Array<{
        id?: string;
        component_type_code: string;
        component_value: string;
        language_code: string;
        confidence_score: number | null;
        match_type: string | null;
        is_reviewed?: boolean;
    }>;
    delete_ids?: string[];
};

export type AddressComponentEditorRow = {
    rowKey: string;
    component_type_code: string;
    en: string;
    my: string;
    und: string;
    match_type: string;
    confidence_score: string;
    source_summary: string;
    component_ids: { en?: string; my?: string; und?: string };
    is_reviewed: boolean;
};

let rowKeyCounter = 0;
function newRowKey(type: string): string {
    rowKeyCounter += 1;
    return `${type}::${rowKeyCounter}`;
}

export function flatComponentsToEditorRows(
    flat: readonly AddressComponentDto[] | undefined
): AddressComponentEditorRow[] {
    if (!flat?.length) {
        return [];
    }
    const byType = new Map<string, AddressComponentEditorRow>();

    for (const c of flat) {
        const typeCode = (c.component_type_code ?? "").trim() || "unknown";
        let row = byType.get(typeCode);
        if (!row) {
            row = {
                rowKey: newRowKey(typeCode),
                component_type_code: typeCode,
                en: "",
                my: "",
                und: "",
                match_type: c.match_type ?? "",
                confidence_score:
                    c.confidence_score !== null && c.confidence_score !== undefined
                        ? String(c.confidence_score)
                        : "",
                source_summary: summarizeSource(c),
                component_ids: {},
                is_reviewed: Boolean(c.is_reviewed),
            };
            byType.set(typeCode, row);
        }
        const value = c.component_value ?? "";
        const id = c.id ?? undefined;
        if (c.language_code === "en") {
            row.en = value;
            row.component_ids.en = id;
        } else if (c.language_code === "my") {
            row.my = value;
            row.component_ids.my = id;
        } else {
            row.und = value;
            row.component_ids.und = id;
        }
        if (c.is_reviewed) {
            row.is_reviewed = true;
        }
        if (!row.match_type && c.match_type) {
            row.match_type = c.match_type;
        }
        if (!row.confidence_score && c.confidence_score !== null && c.confidence_score !== undefined) {
            row.confidence_score = String(c.confidence_score);
        }
        row.source_summary = summarizeSource(c);
    }

    return [...byType.values()].sort((a, b) => a.component_type_code.localeCompare(b.component_type_code));
}

function summarizeSource(c: AddressComponentDto): string {
    const parts: string[] = [];
    if (c.match_type) {
        parts.push(c.match_type);
    }
    if (c.source_tag) {
        parts.push(c.source_tag);
    }
    if (c.is_inferred) {
        parts.push("inferred");
    }
    if (c.is_reviewed) {
        parts.push("reviewed");
    }
    return parts.join(" · ") || "—";
}

export function editorRowsToPatchBody(
    rows: readonly AddressComponentEditorRow[],
    deletedIds: readonly string[]
): AddressComponentsPatchBody {
    const upsert: AddressComponentsPatchBody["upsert"] = [];

    for (const row of rows) {
        const confidence =
            row.confidence_score.trim() === "" ? null : Number(row.confidence_score);
        const matchType = row.match_type.trim() || null;
        const langs: Array<{ key: "en" | "my" | "und"; value: string; id?: string }> = [
            { key: "en", value: row.en.trim(), id: row.component_ids.en },
            { key: "my", value: row.my.trim(), id: row.component_ids.my },
            { key: "und", value: row.und.trim(), id: row.component_ids.und },
        ];
        for (const lang of langs) {
            if (lang.value === "") {
                continue;
            }
            upsert.push({
                ...(lang.id ? { id: lang.id } : {}),
                component_type_code: row.component_type_code.trim(),
                component_value: lang.value,
                language_code: lang.key,
                confidence_score: Number.isFinite(confidence as number) ? confidence : null,
                match_type: matchType,
                is_reviewed: row.is_reviewed || undefined,
            });
        }
    }

    return {
        upsert,
        delete_ids: deletedIds.length > 0 ? [...deletedIds] : undefined,
    };
}

export function collectDeleteIdsForRemovedRows(
    previous: readonly AddressComponentEditorRow[],
    next: readonly AddressComponentEditorRow[]
): string[] {
    const nextIds = new Set(next.map((r) => r.rowKey));
    const out: string[] = [];
    for (const row of previous) {
        if (nextIds.has(row.rowKey)) {
            continue;
        }
        for (const id of Object.values(row.component_ids)) {
            if (id) {
                out.push(id);
            }
        }
    }
    return out;
}

export function collectDeleteIdsForClearedLanguages(
    previous: AddressComponentEditorRow,
    next: AddressComponentEditorRow
): string[] {
    const out: string[] = [];
    if (previous.component_ids.en && !next.en.trim()) {
        out.push(previous.component_ids.en);
    }
    if (previous.component_ids.my && !next.my.trim()) {
        out.push(previous.component_ids.my);
    }
    if (previous.component_ids.und && !next.und.trim()) {
        out.push(previous.component_ids.und);
    }
    return out;
}
