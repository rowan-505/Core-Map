"use client";

import { Suspense } from "react";

import CoreEntityFormPage from "@/src/features/core-review/forms/CoreEntityFormPage";

export default function NewPlacePage() {
    return (
        <Suspense fallback={<p className="p-6 text-sm text-gray-500">Loading place form…</p>}>
            <CoreEntityFormPage entityKey="places" mode="create" />
        </Suspense>
    );
}
