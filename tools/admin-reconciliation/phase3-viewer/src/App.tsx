import { useCallback, useEffect, useMemo, useState } from "react";
import { ReviewMap } from "./components/ReviewMap";
import {
  confidenceLabel,
  decisionStatus,
  isDecisionPayloadValid,
  parseLocalOrVillageRow,
  parseMergeRow,
  type DecisionCode,
  type DecisionRow,
  type GeometryPolicy,
  type NameSource,
  type QueueTab,
  type ReviewItem,
} from "./lib/types";
import "./styles/app.css";

type QueuesPayload = {
  local: Record<string, string>[];
  village: Record<string, string>[];
  merge: Record<string, string>[];
  decisions: {
    local: DecisionRow[];
    village: DecisionRow[];
    merge: DecisionRow[];
  };
  clipPreviews?: Record<string, string>;
};

const DECISION_BUTTONS: Array<{ code: DecisionCode; label: string; hint: string }> = [
  {
    code: "match_existing",
    label: "Match (E)",
    hint: "Same place. Keep CoreMap name and CoreMap geometry (no options).",
  },
  {
    code: "selective_merge",
    label: "Selective merge (U)",
    hint: "Same place. Choose which name and which geometry to keep (MIMU / CoreMap / union).",
  },
  {
    code: "create_new",
    label: "Create new (N)",
    hint: "No good CoreMap match. MIMU should become a new place later.",
  },
  {
    code: "keep_both",
    label: "Keep both (K)",
    hint: "MIMU and CoreMap are different real places. Note is optional.",
  },
  {
    code: "merge_confirmed_duplicate",
    label: "Merge CoreMaps (M)",
    hint: "Two CoreMap rows are duplicates. Green = survivor. Check losers. Note is optional. MIMU is not merged here.",
  },
  {
    code: "reject_source_error",
    label: "Reject MIMU (R)",
    hint: "MIMU row is wrong. Do not import. Note is optional.",
  },
  {
    code: "defer",
    label: "Defer (D)",
    hint: "Skip for now. Note is optional.",
  },
];

function isSelectiveMerge(code: DecisionCode | string): boolean {
  return code === "selective_merge" || code === "selective_merge_union";
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [tab, setTab] = useState<QueueTab>("local");
  const [items, setItems] = useState<Record<QueueTab, ReviewItem[]>>({
    local: [],
    village: [],
    merge: [],
  });
  const [decisions, setDecisions] = useState<Record<QueueTab, Record<string, DecisionRow>>>({
    local: {},
    village: {},
    merge: {},
  });
  const [activeId, setActiveId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [townshipFilter, setTownshipFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [confidenceFilter, setConfidenceFilter] = useState("");
  const [undecidedOnly, setUndecidedOnly] = useState(true);
  const [clipCreateNewOnly, setClipCreateNewOnly] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [losingIds, setLosingIds] = useState<string[]>([]);
  const [decision, setDecision] = useState<DecisionCode>("");
  const [note, setNote] = useState("");
  const [nameSource, setNameSource] = useState<NameSource>("coremap");
  const [geometryPolicy, setGeometryPolicy] = useState<GeometryPolicy>("union");
  const [showSource, setShowSource] = useState(true);
  const [showBasemap, setShowBasemap] = useState(true);
  const [showSelected, setShowSelected] = useState(true);
  const [showOthers, setShowOthers] = useState(false);
  const [showClipPreview, setShowClipPreview] = useState(false);
  const [clipPreviews, setClipPreviews] = useState<Record<string, string>>({});
  const [fitToken, setFitToken] = useState(0);
  const [saveMsg, setSaveMsg] = useState("");
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [validateMsg, setValidateMsg] = useState("");

  const showToast = useCallback((kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    setSaveMsg(text);
    window.setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/queues");
      if (!res.ok) throw new Error(`Failed to load queues (${res.status})`);
      const data = (await res.json()) as QueuesPayload;
      const local = data.local.map((r) => parseLocalOrVillageRow(r, "local"));
      const village = data.village.map((r) => parseLocalOrVillageRow(r, "village"));
      const previewByKey = new Map<string, ReviewItem>();
      for (const item of [...local, ...village]) {
        previewByKey.set(item.reviewId, item);
      }
      // Merge plans are CoreMap↔CoreMap, but source_key links back to the MIMU review row.
      // Attach that MIMU preview + names so orange SOURCE can render.
      const merge = data.merge.map((r) => {
        const item = parseMergeRow(r);
        const linked = previewByKey.get(item.reviewId);
        if (!linked) return item;
        const linkedById = new Map(linked.candidates.map((c) => [c.id, c]));
        return {
          ...item,
          previewPath: linked.previewPath || item.previewPath,
          nameMm: linked.nameMm || item.nameMm,
          nameEn: linked.nameEn || item.nameEn,
          parent: linked.parent || item.parent,
          township: linked.township || item.township,
          nameEvidence: linked.nameEvidence || item.nameEvidence,
          candidates: item.candidates.map((c) => {
            const fromLinked = linkedById.get(c.id);
            if (!fromLinked) return c;
            return {
              ...c,
              name: fromLinked.nameMm || fromLinked.nameEn || fromLinked.name || c.name,
              nameMm: c.nameMm || fromLinked.nameMm,
              nameEn: c.nameEn || fromLinked.nameEn,
              parent: c.parent || fromLinked.parent,
              type: c.type || fromLinked.type,
            };
          }),
        };
      });
      setItems({ local, village, merge });
      const toMap = (rows: DecisionRow[]) =>
        Object.fromEntries(rows.map((d) => [d.review_id, d]));
      setDecisions({
        local: toMap(data.decisions.local || []),
        village: toMap(data.decisions.village || []),
        merge: toMap(data.decisions.merge || []),
      });
      setClipPreviews(data.clipPreviews || {});
      const first = local[0]?.reviewId || village[0]?.reviewId || merge[0]?.reviewId || "";
      setActiveId((prev) => prev || first);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const list = items[tab];
  const decisionMap = decisions[tab];

  const townships = useMemo(() => {
    return Array.from(new Set(list.map((i) => i.township).filter(Boolean))).sort();
  }, [list]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((item) => {
      const st = decisionStatus(decisionMap[item.reviewId]);
      if (clipCreateNewOnly) {
        if (!clipPreviews[item.reviewId]) return false;
      } else if (undecidedOnly && st !== "undecided") {
        return false;
      }
      if (entityFilter && item.entityType !== entityFilter) return false;
      if (townshipFilter && item.township !== townshipFilter) return false;
      if (actionFilter && item.recommendedAction !== actionFilter) return false;
      if (confidenceFilter && confidenceLabel(item) !== confidenceFilter) return false;
      if (reasonFilter) {
        const blob = `${item.reviewReason} ${item.nameEvidence} ${item.recommendedAction}`.toLowerCase();
        if (!blob.includes(reasonFilter.toLowerCase())) return false;
      }
      if (q) {
        const hay = [
          item.nameMm,
          item.nameEn,
          item.township,
          item.parent,
          item.reviewId,
          item.entityType,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    list,
    decisionMap,
    undecidedOnly,
    clipCreateNewOnly,
    clipPreviews,
    entityFilter,
    townshipFilter,
    actionFilter,
    confidenceFilter,
    reasonFilter,
    search,
  ]);

  const active = filtered.find((i) => i.reviewId === activeId) || filtered[0] || null;

  useEffect(() => {
    if (!active) return;
    if (!filtered.some((i) => i.reviewId === active.reviewId) && filtered[0]) {
      setActiveId(filtered[0].reviewId);
    }
  }, [filtered, active]);

  useEffect(() => {
    if (!active) return;
    const existing = decisionMap[active.reviewId];
    const code = (existing?.review_decision as DecisionCode) || "";
    setDecision(code === "selective_merge_union" ? "selective_merge" : code);
    setNote(existing?.review_note || "");
    setNameSource(
      (existing?.name_source as NameSource) ||
        (code === "selective_merge_union" ? "coremap" : "coremap"),
    );
    setGeometryPolicy(
      (existing?.geometry_policy as GeometryPolicy) ||
        (code === "selective_merge_union" || code === "selective_merge" ? "union" : "union"),
    );
    setSelectedCandidateId(
      existing?.selected_core_id ||
        active.survivorId ||
        active.candidates[0]?.id ||
        "",
    );
    setLosingIds(
      existing?.losing_core_ids
        ? existing.losing_core_ids.split(";").filter(Boolean)
        : active.loserIds,
    );
    setShowSource(true);
    setShowSelected(true);
    // Merge tab: always show other CoreMap duplicates (blue) + MIMU source (orange).
    setShowOthers(active.queue === "merge" || active.candidates.length > 1);
    setFitToken((n) => n + 1);
    // Do not clear toast here — save success must remain visible after auto-advance.
  }, [active?.reviewId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCandidate = useMemo(
    () => active?.candidates.find((c) => c.id === selectedCandidateId) || null,
    [active, selectedCandidateId],
  );

  const clipPreviewPath = active ? clipPreviews[active.reviewId] || "" : "";

  useEffect(() => {
    if (clipPreviewPath) setShowClipPreview(true);
  }, [clipPreviewPath]);

  const compareHeadline = useMemo(() => {
    if (!active) return "Select a queue row to compare";
    if (showClipPreview && clipPreviewPath) {
      return "Clip preview: orange MIMU new ↔ gray CoreMap before ↔ red overlap removed ↔ green CoreMap after";
    }
    if (active.queue === "merge") {
      const surv = selectedCandidate
        ? `#${selectedCandidate.index} id ${selectedCandidate.id}`
        : "survivor";
      return `Merge: orange MIMU reference ↔ green survivor (${surv}) ↔ blue other CoreMap`;
    }
    if (decision === "merge_confirmed_duplicate" && selectedCandidate) {
      return `Merge CoreMaps: keep #${selectedCandidate.index} (survivor) · retire losers`;
    }
    if (!selectedCandidate) {
      return "Compare: MIMU source ↔ (no CoreMap candidate)";
    }
    return `Compare: MIMU source ↔ CoreMap candidate #${selectedCandidate.index}`;
  }, [active, selectedCandidate, decision, showClipPreview, clipPreviewPath]);

  const progress = useMemo(() => {
    const all = [...items.local, ...items.village, ...items.merge];
    let decided = 0;
    let deferred = 0;
    let undecided = 0;
    let invalid = 0;
    for (const item of all) {
      const d = decisions[item.queue][item.reviewId];
      const st = decisionStatus(d);
      if (st === "undecided") undecided++;
      else if (st === "deferred") deferred++;
      else decided++;
      if (d && !isDecisionPayloadValid(d, item)) invalid++;
    }
    return {
      total: all.length,
      decided,
      undecided,
      deferred,
      invalid,
      reviewed: decided + deferred,
    };
  }, [items, decisions]);

  const findNextUndecidedId = (
    fromId: string,
    mapForTab: Record<string, DecisionRow>,
    queueItems: ReviewItem[],
  ): string => {
    const undecided = queueItems.filter(
      (item) => decisionStatus(mapForTab[item.reviewId]) === "undecided",
    );
    if (!undecided.length) return fromId;
    const idx = undecided.findIndex((i) => i.reviewId === fromId);
    const next = undecided[(idx < 0 ? 0 : idx + 1) % undecided.length];
    return next?.reviewId || fromId;
  };

  const goUndecided = (dir: -1 | 1) => {
    if (!filtered.length) return;
    const undecidedIdxs = filtered
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => decisionStatus(decisionMap[item.reviewId]) === "undecided");
    if (!undecidedIdxs.length) {
      const idx = filtered.findIndex((i) => i.reviewId === active?.reviewId);
      const next = filtered[(idx + dir + filtered.length) % filtered.length];
      if (next) setActiveId(next.reviewId);
      return;
    }
    const currentPos = undecidedIdxs.findIndex(({ item }) => item.reviewId === active?.reviewId);
    const nextPos =
      currentPos < 0
        ? dir > 0
          ? 0
          : undecidedIdxs.length - 1
        : (currentPos + dir + undecidedIdxs.length) % undecidedIdxs.length;
    setActiveId(undecidedIdxs[nextPos].item.reviewId);
  };

  const cancelDraft = () => {
    if (!active) return;
    const existing = decisionMap[active.reviewId];
    const code = (existing?.review_decision as DecisionCode) || "";
    setDecision(code === "selective_merge_union" ? "selective_merge" : code);
    setNote(existing?.review_note || "");
    setNameSource((existing?.name_source as NameSource) || "coremap");
    setGeometryPolicy((existing?.geometry_policy as GeometryPolicy) || "union");
    setSelectedCandidateId(
      existing?.selected_core_id ||
        active.survivorId ||
        active.candidates[0]?.id ||
        "",
    );
    setLosingIds(
      existing?.losing_core_ids
        ? existing.losing_core_ids.split(";").filter(Boolean)
        : active.loserIds,
    );
    showToast("ok", existing?.review_decision ? "Draft cancelled — restored saved decision." : "Draft cancelled.");
  };

  /** Find Local/Village row that shares this merge source_key (MIMU link). */
  const findLinkedMimuItem = (sourceKey: string): ReviewItem | null => {
    return (
      items.local.find((i) => i.reviewId === sourceKey) ||
      items.village.find((i) => i.reviewId === sourceKey) ||
      null
    );
  };

  const putDecision = async (
    queue: QueueTab,
    payload: Record<string, unknown>,
    confirmReplace = false,
  ): Promise<{ ok: true; decision: DecisionRow } | { ok: false; status: number; body: Record<string, unknown> }> => {
    const res = await fetch(`/api/decisions/${queue}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, confirmReplace }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, body };
    return { ok: true, decision: body.decision as DecisionRow };
  };

  /**
   * One-click on Merge tab: keep selected CoreMap (matches MIMU),
   * auto-merge all other CoreMap duplicates into it,
   * and match the linked MIMU row to that same survivor.
   */
  const resolveUnique = async (confirmReplace = false) => {
    if (!active || active.queue !== "merge") {
      showToast("err", "One unique works on the Merge tab.");
      return;
    }
    if (!selectedCandidateId) {
      showToast("err", "Click the CoreMap that matches orange MIMU (turns green).");
      return;
    }
    const losers = active.candidates
      .map((c) => c.id)
      .filter((id) => id && id !== selectedCandidateId);
    if (!losers.length) {
      showToast("err", "Need at least one other CoreMap duplicate to merge away.");
      return;
    }

    setDecision("merge_confirmed_duplicate");
    setLosingIds(losers);
    setSaving(true);

    const mergeNote =
      note.trim() ||
      `one_unique: keep ${selectedCandidateId}; merge losers ${losers.join(";")}; match MIMU`;

    try {
      const mergeResult = await putDecision(
        "merge",
        {
          review_id: active.reviewId,
          source_key: active.reviewId,
          review_decision: "merge_confirmed_duplicate",
          selected_core_id: selectedCandidateId,
          losing_core_ids: losers.join(";"),
          name_source: "",
          geometry_policy: "",
          review_note: mergeNote,
        },
        confirmReplace,
      );

      if (!mergeResult.ok && mergeResult.status === 409) {
        const ok = window.confirm("A merge decision already exists. Replace it?");
        if (ok) {
          setSaving(false);
          return resolveUnique(true);
        }
        showToast("err", "Cancelled — existing merge decision kept.");
        return;
      }
      if (!mergeResult.ok) {
        showToast(
          "err",
          String(mergeResult.body.error || mergeResult.body.message || `Merge save failed (${mergeResult.status})`),
        );
        return;
      }

      let nextDecisions = {
        ...decisions,
        merge: {
          ...decisions.merge,
          [active.reviewId]: mergeResult.decision,
        },
      };

      const linked = findLinkedMimuItem(active.reviewId);
      let mimuMsg = "";
      if (linked) {
        const existingLinked = decisions[linked.queue][linked.reviewId];
        // If Local/Village is already decided, never overwrite — merge-only.
        // User can change the MIMU row later on Local/Villages tab.
        if (existingLinked?.review_decision) {
          mimuMsg = ` · linked ${linked.queue} kept as ${existingLinked.review_decision} (not changed)`;
        } else {
          const mimuResult = await putDecision(
            linked.queue,
            {
              review_id: linked.reviewId,
              source_key: linked.reviewId,
              review_decision: "match_existing",
              selected_core_id: selectedCandidateId,
              losing_core_ids: "",
              name_source: "",
              geometry_policy: "",
              review_note:
                note.trim() ||
                `one_unique: MIMU matches survivor ${selectedCandidateId}; other CoreMaps merged`,
            },
            false,
          );
          if (mimuResult.ok) {
            nextDecisions = {
              ...nextDecisions,
              [linked.queue]: {
                ...nextDecisions[linked.queue],
                [linked.reviewId]: mimuResult.decision,
              },
            };
            mimuMsg = ` · MIMU matched to ${selectedCandidateId}`;
          } else {
            mimuMsg = ` · MIMU match failed (${mimuResult.status}) — merge still saved`;
          }
        }
      } else {
        mimuMsg = " · no linked Local/Village row";
      }

      setDecisions(nextDecisions);
      setNote(mergeNote);
      showToast(
        "ok",
        `One unique: survivor ${selectedCandidateId}; merged ${losers.join(",")}${mimuMsg}`,
      );

      const nextId = findNextUndecidedId(
        active.reviewId,
        nextDecisions.merge,
        items.merge,
      );
      if (nextId && nextId !== active.reviewId) {
        window.setTimeout(() => setActiveId(nextId), 200);
      } else if (undecidedOnly) {
        window.setTimeout(() => goUndecided(1), 200);
      }
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const saveDecision = async (confirmReplace = false) => {
    if (!active || !decision) {
      showToast("err", "Choose a decision type first (Match / Create / …), then Save.");
      return;
    }
    if (
      (decision === "match_existing" || isSelectiveMerge(decision)) &&
      !selectedCandidateId
    ) {
      showToast(
        "err",
        isSelectiveMerge(decision)
          ? "Selective merge needs a green CoreMap candidate."
          : "Match requires a selected CoreMap candidate (green).",
      );
      return;
    }
    if (isSelectiveMerge(decision)) {
      if (!nameSource) {
        showToast("err", "Selective merge: choose which name to keep.");
        return;
      }
      if (!geometryPolicy) {
        showToast("err", "Selective merge: choose which geometry to keep.");
        return;
      }
    }
    if (decision === "merge_confirmed_duplicate") {
      const losers = losingIds.filter((id) => id && id !== selectedCandidateId);
      if (!selectedCandidateId) {
        showToast("err", "Merge: click the SURVIVOR card first (geometry to keep).");
        return;
      }
      if (!losers.length) {
        showToast("err", "Merge: check at least one LOSER duplicate.");
        return;
      }
    }

    const payload = {
      review_id: active.reviewId,
      source_key: active.reviewId,
      review_decision: decision === "selective_merge_union" ? "selective_merge" : decision,
      selected_core_id:
        decision === "create_new" || decision === "reject_source_error" ? "" : selectedCandidateId,
      losing_core_ids:
        decision === "merge_confirmed_duplicate"
          ? losingIds.filter((id) => id !== selectedCandidateId).join(";")
          : "",
      name_source: isSelectiveMerge(decision) ? nameSource : "",
      geometry_policy: isSelectiveMerge(decision) ? geometryPolicy : "",
      review_note: note.trim(),
      confirmReplace,
    };

    setSaving(true);
    try {
      const res = await fetch(`/api/decisions/${active.queue}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        const ok = window.confirm("A decision already exists for this row. Replace it?");
        if (ok) {
          setSaving(false);
          return saveDecision(true);
        }
        showToast("err", "Save cancelled — existing decision kept.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast("err", body.error || body.message || `Save failed (${res.status})`);
        return;
      }
      const body = (await res.json()) as { decision: DecisionRow };
      if (!body.decision?.review_decision) {
        showToast("err", "Save returned an empty decision — check server.");
        return;
      }

      const saved = body.decision;
      const nextTabMap = {
        ...decisions[active.queue],
        [active.reviewId]: saved,
      };
      setDecisions((prev) => ({
        ...prev,
        [active.queue]: nextTabMap,
      }));

      const st = decisionStatus(saved);
      showToast(
        "ok",
        st === "deferred"
          ? `Saved defer · undecided should drop · deferred +1`
          : `Saved ${saved.review_decision} · progress updated`,
      );

      // Advance using the fresh decision map (avoid stale closure).
      const nextId = findNextUndecidedId(active.reviewId, nextTabMap, items[active.queue]);
      if (nextId && nextId !== active.reviewId) {
        window.setTimeout(() => setActiveId(nextId), 200);
      } else if (undecidedOnly) {
        // Stay; filtered list will drop this card.
        window.setTimeout(() => goUndecided(1), 200);
      }
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key >= "1" && e.key <= "9" && active) {
        const cand = active.candidates[Number(e.key) - 1];
        if (cand) setSelectedCandidateId(cand.id);
      }
      if (e.key === "ArrowLeft") goUndecided(-1);
      if (e.key === "ArrowRight") goUndecided(1);
      if (e.key.toLowerCase() === "y" && active?.queue === "merge") {
        e.preventDefault();
        void resolveUnique(false);
        return;
      }
      const map: Record<string, DecisionCode> = {
        e: "match_existing",
        u: "selective_merge",
        n: "create_new",
        k: "keep_both",
        m: "merge_confirmed_duplicate",
        r: "reject_source_error",
        d: "defer",
      };
      const code = map[e.key.toLowerCase()];
      if (code) setDecision(code);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const runValidate = async () => {
    setValidateMsg("Validating…");
    const res = await fetch("/api/validate", { method: "POST" });
    const body = await res.json();
    if (!res.ok) {
      setValidateMsg(`Validation request failed (${res.status})`);
      return;
    }
    setValidateMsg(
      body.ok
        ? `Validation OK (0 blocking). Report: ${body.reportPath}. Manifests not generated by viewer.`
        : `Validation found ${body.blocking} blocking / ${body.warnings} warnings. See ${body.reportPath}`,
    );
  };

  if (loading) {
    return <div className="state-box">Loading review queues…</div>;
  }
  if (error) {
    return (
      <div className="state-box">
        <div className="error-box">
          <strong>Could not load local review files.</strong>
          <div>{error}</div>
          <p>Queues must exist under reports/admin-reconciliation-v2/. No database is used.</p>
          <button type="button" className="primary-btn" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {toast ? (
        <div className={`toast toast-${toast.kind}`} role="status">
          {toast.text}
          <button type="button" className="toast-close" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      ) : null}
      <header className="topbar">
        <h1>Phase 3 review viewer</h1>
        <span className="muted">Local only · queues immutable · decisions saved separately</span>
        <div className="progress">
          <span>total {progress.total}</span>
          <span>reviewed {progress.reviewed}</span>
          <span>decided {progress.decided}</span>
          <span>undecided {progress.undecided}</span>
          <span>deferred {progress.deferred}</span>
          <span>invalid {progress.invalid}</span>
        </div>
        <button type="button" className="primary-btn" style={{ flex: "0 0 auto" }} onClick={() => void runValidate()}>
          Validate decisions
        </button>
      </header>

      <aside className="panel">
        <div className="tabs">
          {(
            [
              ["local", `Local (${items.local.length})`],
              ["village", `Villages (${items.village.length})`],
              ["merge", `Merge (${items.merge.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "active" : ""}
              onClick={() => {
                setTab(id);
                setActiveId(items[id][0]?.reviewId || "");
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="filters">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search MM / EN / township / source key"
          />
          <div className="filter-row">
            <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
              <option value="">All entity types</option>
              {Array.from(new Set(list.map((i) => i.entityType).filter(Boolean))).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select value={townshipFilter} onChange={(e) => setTownshipFilter(e.target.value)}>
              <option value="">All townships</option>
              {townships.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-row">
            <input
              value={reasonFilter}
              onChange={(e) => setReasonFilter(e.target.value)}
              placeholder="Review reason contains…"
            />
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="">All recommended</option>
              {Array.from(new Set(list.map((i) => i.recommendedAction).filter(Boolean))).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select value={confidenceFilter} onChange={(e) => setConfidenceFilter(e.target.value)}>
              <option value="">All confidence</option>
              {Array.from(new Set(list.map((i) => confidenceLabel(i)))).sort().map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>
            <input
              type="checkbox"
              checked={undecidedOnly}
              disabled={clipCreateNewOnly}
              onChange={(e) => setUndecidedOnly(e.target.checked)}
            />{" "}
            Undecided only
          </label>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>
            <input
              type="checkbox"
              checked={clipCreateNewOnly}
              onChange={(e) => {
                const on = e.target.checked;
                setClipCreateNewOnly(on);
                if (on) {
                  setTab("local");
                  setUndecidedOnly(false);
                  setShowClipPreview(true);
                }
              }}
            />{" "}
            Clip create_new only ({Object.keys(clipPreviews).length})
          </label>
        </div>
        <div className="queue-list">
          {!filtered.length && <div className="state-box">No rows match filters.</div>}
          {filtered.map((item) => {
            const st = decisionStatus(decisionMap[item.reviewId]);
            return (
              <button
                key={item.reviewId}
                type="button"
                className={`queue-card ${active?.reviewId === item.reviewId ? "active" : ""}`}
                onClick={() => setActiveId(item.reviewId)}
              >
                <div className="mm">{item.nameMm || "(no Myanmar name)"}</div>
                <div className="en">{item.nameEn || item.reviewId}</div>
                <div className="meta">
                  <span className="chip">{item.entityType || "—"}</span>
                  {item.township ? <span className="chip neutral">{item.township}</span> : null}
                  <span className="chip">{item.candidates.length} cand</span>
                  <span className="chip warn" title={item.nameEvidence || item.reviewReason}>
                    {item.nameEvidence || item.reviewReason || item.recommendedAction || "—"}
                  </span>
                  <span
                    className={`chip ${st === "decided" ? "ok" : st === "deferred" ? "warn" : "bad"}`}
                  >
                    {st}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="map-wrap">
        <div className="compare-banner">
          <div className="compare-title">{compareHeadline}</div>
          <div className="compare-keys">
            {showClipPreview && clipPreviewPath ? (
              <>
                <span className="key orange">Orange = MIMU new</span>
                <span className="key" style={{ color: "#64748b" }}>
                  Gray dashed = CoreMap before
                </span>
                <span className="key" style={{ color: "#dc2626" }}>
                  Red = overlap removed
                </span>
                <span className="key green">Green = CoreMap after clip</span>
              </>
            ) : (
              <>
                <span className="key orange">
                  Orange = MIMU source{active?.queue === "merge" ? " (reference)" : ""}
                </span>
                <span className="key green">
                  Green = {active?.queue === "merge" ? "survivor CoreMap" : "selected CoreMap"}
                </span>
                <span className="key blue">
                  Blue = {active?.queue === "merge" ? "other CoreMap duplicate" : "other candidates"}
                </span>
              </>
            )}
          </div>
          <div className="map-toolbar inline">
            <label>
              <input
                type="checkbox"
                checked={showBasemap}
                onChange={(e) => setShowBasemap(e.target.checked)}
              />{" "}
              Basemap
            </label>
            {clipPreviewPath ? (
              <label>
                <input
                  type="checkbox"
                  checked={showClipPreview}
                  onChange={(e) => setShowClipPreview(e.target.checked)}
                />{" "}
                Clip preview
              </label>
            ) : null}
            <label>
              <input
                type="checkbox"
                checked={showSource}
                onChange={(e) => setShowSource(e.target.checked)}
                disabled={showClipPreview && Boolean(clipPreviewPath)}
              />{" "}
              MIMU (orange)
            </label>
            <label>
              <input
                type="checkbox"
                checked={showSelected}
                onChange={(e) => setShowSelected(e.target.checked)}
              />{" "}
              Selected (green)
            </label>
            <label>
              <input
                type="checkbox"
                checked={showOthers}
                onChange={(e) => setShowOthers(e.target.checked)}
              />{" "}
              Other CoreMap (blue)
            </label>
            <button type="button" onClick={() => setFitToken((n) => n + 1)}>
              Fit all
            </button>
          </div>
        </div>
        <div className="map-stage">
          <ReviewMap
            item={active}
            selectedCandidateId={selectedCandidateId}
            showSource={showSource}
            showSelected={showSelected}
            showOthers={showOthers}
            showBasemap={showBasemap}
            showClipPreview={showClipPreview && Boolean(clipPreviewPath)}
            clipPreviewPath={clipPreviewPath}
            fitToken={fitToken}
          />
          <div className="map-legend">
            <div>
              <span className="swatch" style={{ background: "#F59E0B" }} /> MIMU source (orange)
            </div>
            <div>
              <span className="swatch" style={{ background: "#16A34A" }} />{" "}
              {active?.queue === "merge" ? "Survivor CoreMap" : "SELECTED candidate"}
              {selectedCandidate ? ` #${selectedCandidate.index}` : ""}
            </div>
            {showOthers ? (
              <div>
                <span className="swatch" style={{ background: "#2563EB" }} /> Other CoreMap
              </div>
            ) : null}
          </div>
        </div>
      </main>

      <aside className="panel right">
        <div className="evidence">
          {!active ? (
            <div className="state-box">Select a review row.</div>
          ) : (
            <>
              <div className="compare-pair">
                <section className="compare-side source-side">
                  <header>
                    <span className="side-dot orange" />
                    SOURCE (MIMU) — fixed
                  </header>
                  <div className="value mm">{active.nameMm || "—"}</div>
                  <div className="en">{active.nameEn || "—"}</div>
                  <div className="meta-line">{active.entityType || "—"}</div>
                  <div className="meta-line hierarchy">{active.parent || "—"}</div>
                  <div className="meta-line muted">
                    Not selectable. You decide what to do with this MIMU row.
                  </div>
                </section>

                <div className="compare-vs" aria-hidden>
                  ↔
                </div>

                <section className="compare-side cand-side">
                  <header>
                    <span className="side-dot green" />
                    SELECTED CANDIDATE
                    {selectedCandidate ? ` #${selectedCandidate.index}` : ""}
                  </header>
                  {!selectedCandidate ? (
                    <div className="muted">No candidate selected. Click a card below.</div>
                  ) : (
                    <>
                      <div className="value mm">
                        {selectedCandidate.nameMm || selectedCandidate.name || "—"}
                      </div>
                      <div className="en">{selectedCandidate.nameEn || "—"}</div>
                      <div className="meta-line">
                        id {selectedCandidate.id} · {selectedCandidate.type || "—"}
                      </div>
                      <div className="meta-line hierarchy">
                        {selectedCandidate.parent || "—"}
                      </div>
                      <div className="meta-line">
                        Distance{" "}
                        {selectedCandidate.distanceM != null
                          ? `${Math.round(selectedCandidate.distanceM)} m`
                          : "—"}
                        {" · "}
                        Overlap{" "}
                        {selectedCandidate.overlapPercent != null
                          ? `${selectedCandidate.overlapPercent.toFixed(1)}%`
                          : "—"}
                      </div>
                    </>
                  )}
                </section>
              </div>

              {(active.candidates.length >= 2 ||
                decision === "merge_confirmed_duplicate" ||
                isSelectiveMerge(decision) ||
                active.queue === "merge") && (
                <div className="guide-box">
                  <strong>Match vs Selective merge vs Merge CoreMaps</strong>
                  <br />
                  <code>Match</code> = same place; CoreMap name + CoreMap geometry.
                  <br />
                  <code>Selective merge</code> = same place; you choose name (MIMU or CoreMap) and
                  geometry (MIMU / CoreMap / union).
                  <br />
                  <code>Merge CoreMaps</code> = CoreMap duplicates only; survivor keeps geometry.
                </div>
              )}

              <h2 className="pick-title">
                CoreMap candidates
                <span className="muted">
                  {decision === "merge_confirmed_duplicate"
                    ? " — green = SURVIVOR (kept geometry); check losers"
                    : " — click one to compare (turns green)"}
                </span>
              </h2>
              {!active.candidates.length && (
                <div className="state-box">No CoreMap candidates.</div>
              )}
              <div className="candidate-list">
                {active.candidates.map((c) => {
                  const isSurvivor = selectedCandidateId === c.id;
                  const isLoser =
                    decision === "merge_confirmed_duplicate" &&
                    losingIds.includes(c.id) &&
                    !isSurvivor;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`candidate-card ${isSurvivor ? "selected" : ""} ${isLoser ? "loser" : ""}`}
                      onClick={() => {
                        setSelectedCandidateId(c.id);
                        if (active.queue === "merge" || decision === "merge_confirmed_duplicate") {
                          setLosingIds(
                            active.candidates.map((x) => x.id).filter((id) => id !== c.id),
                          );
                          if (active.queue === "merge") {
                            setDecision("merge_confirmed_duplicate");
                          }
                        }
                      }}
                    >
                      <div className="title">
                        <span>
                          #{c.index} · {c.id}
                          {isSurvivor && decision === "merge_confirmed_duplicate"
                            ? " · SURVIVOR"
                            : ""}
                          {isLoser ? " · LOSER" : ""}
                        </span>
                        <span className="chip">{c.type || "—"}</span>
                      </div>
                      <div className="value mm">{c.nameMm || c.name}</div>
                      <div className="en">{c.nameEn || "—"}</div>
                      <div className="cand-stats">
                        {c.overlapPercent != null ? `${c.overlapPercent.toFixed(0)}% overlap` : "—"}
                        {" · "}
                        {c.distanceM != null ? `${Math.round(c.distanceM)} m` : "—"}
                      </div>
                      {decision === "merge_confirmed_duplicate" ? (
                        <label
                          className="lose-label"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={losingIds.includes(c.id) && c.id !== selectedCandidateId}
                            disabled={c.id === selectedCandidateId}
                            onChange={(e) => {
                              setLosingIds((prev) => {
                                if (e.target.checked) return Array.from(new Set([...prev, c.id]));
                                return prev.filter((x) => x !== c.id);
                              });
                            }}
                          />{" "}
                          {c.id === selectedCandidateId
                            ? "Survivor (geometry kept)"
                            : "Mark as losing duplicate"}
                        </label>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {active.queue === "merge" ? (
                <div className="block">
                  <div className="label">Repoint plan</div>
                  <div className="value">{active.repointPlan}</div>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="decisions">
          <div className="decisions-scroll">
          <div className="decision-heading">Decide + save</div>
          <div className="decision-hint">
            Choose a type (and options if needed), then <strong>Save decision</strong>.{" "}
            <strong>Cancel</strong> discards unsaved edits on this row.
            {active?.queue === "merge"
              ? " Or use One unique (Y) in the footer for one-click keep + merge."
              : ""}
          </div>
          <div className="decision-grid">
            {DECISION_BUTTONS.map((b) => (
              <button
                key={b.code}
                type="button"
                title={b.hint}
                data-code={b.code}
                className={decision === b.code ? "active" : ""}
                onClick={() => {
                  setDecision(b.code);
                  if (b.code === "selective_merge") {
                    setNameSource((prev) => prev || "coremap");
                    setGeometryPolicy((prev) => prev || "union");
                  }
                  if (b.code === "merge_confirmed_duplicate" && active) {
                    const others = active.candidates
                      .map((c) => c.id)
                      .filter((id) => id && id !== selectedCandidateId);
                    if (others.length) setLosingIds(others);
                    else if (active.candidates.length >= 2 && selectedCandidateId) {
                      setLosingIds(
                        active.candidates.map((c) => c.id).filter((id) => id !== selectedCandidateId),
                      );
                    }
                    setShowOthers(true);
                  }
                  setSaveMsg(b.hint);
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
          {isSelectiveMerge(decision) ? (
            <div className="merge-options">
              <div className="merge-options-title">Selective merge options</div>
              <div className="merge-option-block">
                <div className="merge-option-label">Name to keep</div>
                <label className={nameSource === "coremap" ? "opt active" : "opt"}>
                  <input
                    type="radio"
                    name="name_source"
                    checked={nameSource === "coremap"}
                    onChange={() => setNameSource("coremap")}
                  />
                  <span>
                    <strong>CoreMap (local)</strong>
                    <small>
                      {selectedCandidate
                        ? `${selectedCandidate.nameMm || "—"} / ${selectedCandidate.nameEn || "—"}`
                        : "pick a green candidate"}
                    </small>
                  </span>
                </label>
                <label className={nameSource === "mimu" ? "opt active" : "opt"}>
                  <input
                    type="radio"
                    name="name_source"
                    checked={nameSource === "mimu"}
                    onChange={() => setNameSource("mimu")}
                  />
                  <span>
                    <strong>MIMU source</strong>
                    <small>
                      {active ? `${active.nameMm || "—"} / ${active.nameEn || "—"}` : "—"}
                    </small>
                  </span>
                </label>
              </div>
              <div className="merge-option-block">
                <div className="merge-option-label">Geometry to keep</div>
                <label className={geometryPolicy === "coremap" ? "opt active" : "opt"}>
                  <input
                    type="radio"
                    name="geometry_policy"
                    checked={geometryPolicy === "coremap"}
                    onChange={() => setGeometryPolicy("coremap")}
                  />
                  <span>
                    <strong>CoreMap only</strong>
                    <small>Green polygon/point</small>
                  </span>
                </label>
                <label className={geometryPolicy === "mimu" ? "opt active" : "opt"}>
                  <input
                    type="radio"
                    name="geometry_policy"
                    checked={geometryPolicy === "mimu"}
                    onChange={() => setGeometryPolicy("mimu")}
                  />
                  <span>
                    <strong>MIMU only</strong>
                    <small>Orange polygon/point</small>
                  </span>
                </label>
                <label className={geometryPolicy === "union" ? "opt active" : "opt"}>
                  <input
                    type="radio"
                    name="geometry_policy"
                    checked={geometryPolicy === "union"}
                    onChange={() => setGeometryPolicy("union")}
                  />
                  <span>
                    <strong>Union</strong>
                    <small>Combine MIMU + CoreMap shapes</small>
                  </span>
                </label>
              </div>
            </div>
          ) : null}
          {decision ? (
            <div className="decision-hint">
              Chosen: <strong>{decision}</strong>
              {decision === "match_existing" && selectedCandidateId
                ? ` → CoreMap ${selectedCandidateId}`
                : ""}
              {isSelectiveMerge(decision) && selectedCandidateId
                ? ` → CoreMap ${selectedCandidateId}; name=${nameSource}; geom=${geometryPolicy}`
                : ""}
              {decision === "merge_confirmed_duplicate"
                ? ` · survivor ${selectedCandidateId || "?"} · losers ${(losingIds.filter((id) => id !== selectedCandidateId).join(";") || "none")}`
                : ""}
            </div>
          ) : null}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Review note (optional)"
          />
          {saveMsg ? <div className="decision-hint">{saveMsg}</div> : null}
          {validateMsg ? <div className="decision-hint">{validateMsg}</div> : null}
          </div>
          <div className="decisions-footer">
          {active?.queue === "merge" ? (
            <div className="one-unique-box">
              <button
                type="button"
                className="primary-btn one-unique-btn"
                disabled={saving || !selectedCandidateId}
                onClick={() => void resolveUnique(false)}
                title="Keep green CoreMap, merge other CoreMaps into it, match MIMU to it"
              >
                {saving ? "Saving…" : "One unique (Y) — keep green, merge other CoreMaps"}
              </button>
            </div>
          ) : null}
          <div className="action-row">
            <button
              type="button"
              className="cancel-btn"
              disabled={saving}
              onClick={cancelDraft}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-btn save-btn"
              disabled={saving}
              onClick={() => void saveDecision(false)}
            >
              {saving ? "Saving…" : "Save decision"}
            </button>
          </div>
          <div className="nav-row">
            <button type="button" onClick={() => goUndecided(-1)}>
              ← Prev
            </button>
            <button type="button" onClick={() => goUndecided(1)}>
              Next →
            </button>
          </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
