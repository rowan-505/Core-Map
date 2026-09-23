"use client";

import type { BoundaryReviewToggles } from "./types";

export type BoundaryReviewControlsProps = {
    toggles: BoundaryReviewToggles;
    onTogglesChange: (next: BoundaryReviewToggles) => void;
    onCheckGeometry: () => void;
    checkBusy?: boolean;
    palette?: "import" | "core";
};

export default function BoundaryReviewControls({
    toggles,
    onTogglesChange,
    onCheckGeometry,
    checkBusy = false,
    palette = "core",
}: BoundaryReviewControlsProps) {
    const labelClass = palette === "core" ? "text-slate-600" : "text-gray-600";
    const checkboxClass = palette === "core" ? "border-slate-300" : "border-gray-300";
    const buttonClass =
        palette === "core"
            ? "border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100"
            : "border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100";

    function toggle(key: keyof BoundaryReviewToggles) {
        onTogglesChange({ ...toggles, [key]: !toggles[key] });
    }

    return (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5">
            <label className={`flex cursor-pointer items-center gap-1 whitespace-nowrap text-[10px] ${labelClass}`}>
                <input
                    type="checkbox"
                    className={`h-3 w-3 rounded ${checkboxClass}`}
                    checked={toggles.neighbours}
                    onChange={() => toggle("neighbours")}
                />
                Neighbours
            </label>
            <label className={`flex cursor-pointer items-center gap-1 whitespace-nowrap text-[10px] ${labelClass}`}>
                <input
                    type="checkbox"
                    className={`h-3 w-3 rounded ${checkboxClass}`}
                    checked={toggles.labels}
                    onChange={() => toggle("labels")}
                />
                Labels
            </label>
            <label className={`flex cursor-pointer items-center gap-1 whitespace-nowrap text-[10px] ${labelClass}`}>
                <input
                    type="checkbox"
                    className={`h-3 w-3 rounded ${checkboxClass}`}
                    checked={toggles.parentBoundary}
                    onChange={() => toggle("parentBoundary")}
                />
                Parent boundary
            </label>
            <button
                type="button"
                disabled={checkBusy}
                onClick={onCheckGeometry}
                className={`shrink-0 whitespace-nowrap rounded border px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50 ${buttonClass}`}
            >
                {checkBusy ? "Checking…" : "Check geometry"}
            </button>
        </div>
    );
}
