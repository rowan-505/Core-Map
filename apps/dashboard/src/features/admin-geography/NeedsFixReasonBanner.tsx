/** Banner for needs_fix verification status and stored reason. */

export function NeedsFixReasonBanner({
    status,
    note,
}: {
    status: string;
    note: string | null | undefined;
}) {
    if (status !== "needs_fix") {
        return null;
    }

    const trimmed = typeof note === "string" ? note.trim() : "";

    return (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-950">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-red-800">
                Needs fix — reason
            </div>
            {trimmed ? (
                <p className="mt-1 whitespace-pre-wrap text-red-950">{trimmed}</p>
            ) : (
                <p className="mt-1 text-red-800">No fix reason stored.</p>
            )}
        </div>
    );
}
