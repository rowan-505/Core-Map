import type { ValidationIssue } from "../../lib/core-review/ref-validation.js";

export class CoreReviewValidationError extends Error {
    readonly issues: ValidationIssue[];
    readonly code?: string;

    constructor(message: string, issues: ValidationIssue[] = [], code?: string) {
        super(message);
        this.name = "CoreReviewValidationError";
        this.issues = issues;
        this.code = code;
    }
}

export class CoreReviewNotFoundError extends Error {
    constructor(message = "Record not found") {
        super(message);
        this.name = "CoreReviewNotFoundError";
    }
}

export class CoreReviewLifecycleNotSupportedError extends Error {
    constructor(message = "Soft delete is not supported for this entity") {
        super(message);
        this.name = "CoreReviewLifecycleNotSupportedError";
    }
}

export class CoreReviewSuppressedError extends Error {
    constructor(message = "Record is deleted or suppressed in Core") {
        super(message);
        this.name = "CoreReviewSuppressedError";
    }
}

export type CoreReviewDemoteDependency = {
    code: string;
    count: number;
    message: string;
};

export class CoreReviewDemoteBlockedError extends Error {
    readonly dependencies: CoreReviewDemoteDependency[];

    constructor(message: string, dependencies: CoreReviewDemoteDependency[]) {
        super(message);
        this.name = "CoreReviewDemoteBlockedError";
        this.dependencies = dependencies;
    }
}
