/**
 * Client-safe error codes. Do not put SQL, tokens, or stack traces in the body.
 */
export function publicErrorCode(input: {
    urlPath: string;
    statusCode: number;
    hasValidation?: boolean;
}): string | null {
    const { urlPath, statusCode, hasValidation } = input;
    if (statusCode === 429) {
        return "RATE_LIMITED";
    }
    if (statusCode === 413) {
        return "PAYLOAD_TOO_LARGE";
    }

    const fieldOrMedia = urlPath.startsWith("/field/") || urlPath.startsWith("/media/");
    if (!fieldOrMedia) {
        return null;
    }

    if (hasValidation || statusCode === 400) {
        return "VALIDATION_ERROR";
    }
    if (statusCode === 401) {
        return "UNAUTHORIZED";
    }
    if (statusCode === 403) {
        return "FORBIDDEN";
    }
    if (urlPath.startsWith("/field/survey-sessions") && statusCode === 404) {
        return "SESSION_NOT_FOUND";
    }
    if (urlPath.startsWith("/field/survey-sessions") && statusCode === 409) {
        return "SESSION_CONFLICT";
    }
    if (statusCode === 404) {
        return "NOT_FOUND";
    }
    if (statusCode === 409) {
        return "CONFLICT";
    }
    if (statusCode >= 500) {
        return "INTERNAL_ERROR";
    }
    return "REQUEST_FAILED";
}
