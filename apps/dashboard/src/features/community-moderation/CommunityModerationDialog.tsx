"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  ACTIONS_REQUIRING_REASON,
  DESTRUCTIVE_ACTIONS,
  moderationActionLabel,
} from "./constants";
import type { CommunityModerationAction } from "./types";

type CommunityModerationDialogProps = {
  readonly open: boolean;
  readonly action: CommunityModerationAction | null;
  readonly postTitle: string;
  readonly isBusy?: boolean;
  readonly onConfirm: (note: string | undefined) => void;
  readonly onCancel: () => void;
};

export function CommunityModerationDialog({
  open,
  action,
  postTitle,
  isBusy = false,
  onConfirm,
  onCancel,
}: CommunityModerationDialogProps) {
  const titleId = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNote("");
    setError(null);
    noteRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, action]);

  if (!open || !action) return null;

  const requiresReason = ACTIONS_REQUIRING_REASON.has(action);
  const destructive = DESTRUCTIVE_ACTIONS.has(action);
  const label = moderationActionLabel(action);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          {label}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Apply <span className="font-medium text-slate-900">{label}</span> to “{postTitle}”?
          {destructive
            ? " This changes the public lifecycle of the post."
            : null}
        </p>

        <label className="mt-4 block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {requiresReason ? "Reason (required)" : "Note (optional)"}
          </span>
          <textarea
            ref={noteRef}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            placeholder={
              requiresReason
                ? "Explain why this action is needed"
                : "Optional internal note"
            }
          />
        </label>
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={onCancel}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              if (requiresReason && note.trim() === "") {
                setError("A reason is required for this action.");
                return;
              }
              onConfirm(note.trim() === "" ? undefined : note.trim());
            }}
            className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 ${
              destructive
                ? "bg-red-700 text-white hover:bg-red-800"
                : "bg-emerald-700 text-white hover:bg-emerald-800"
            }`}
          >
            {isBusy ? "Working…" : label}
          </button>
        </div>
      </div>
    </div>
  );
}
