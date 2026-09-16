/** Pure work-status rules for survey variant assignments. */
export type SurveyAssignmentWorkStatus = "not_started" | "partial" | "finished";

export function deriveSurveyAssignmentWorkStatus(input: {
    hasSession: boolean;
    isFinished: boolean;
}): SurveyAssignmentWorkStatus {
    if (input.isFinished) return "finished";
    if (input.hasSession) return "partial";
    return "not_started";
}

export function isSurveyAssignmentRemaining(input: {
    status: "active" | "cancelled";
    workStatus: SurveyAssignmentWorkStatus;
}): boolean {
    return input.status === "active" && input.workStatus !== "finished";
}
