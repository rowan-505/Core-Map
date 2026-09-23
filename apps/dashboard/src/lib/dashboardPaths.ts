export const DASHBOARD_PATH = "/dashboard";

export const CORE_REVIEW_PATH = `${DASHBOARD_PATH}/core-review`;
export const REFERENCES_PATH = `${DASHBOARD_PATH}/references`;
export const ROUTING_ADMIN_PATH = `${DASHBOARD_PATH}/routing`;
export const LOCAL_BASEMAP_PATH = `${DASHBOARD_PATH}/local-basemap`;
export const DEV_MAP_PATH = `${DASHBOARD_PATH}/dev-map`;
export const TRANSPORT_PATH = `${DASHBOARD_PATH}/transport`;
export const USERS_PATH = `${DASHBOARD_PATH}/users`;
export const USER_ANALYTICS_PATH = `${DASHBOARD_PATH}/user-analytics`;
export const POINT_MANAGEMENT_PATH = `${DASHBOARD_PATH}/point-management`;
export const REPORTS_PATH = `${DASHBOARD_PATH}/reports`;
export const REVIEWS_PATH = `${DASHBOARD_PATH}/reviews`;
export const FIELD_SURVEY_PATH = `${DASHBOARD_PATH}/field-survey`;
export const COMMUNITY_PATH = `${DASHBOARD_PATH}/community`;
export const TOURISM_PATH = `${DASHBOARD_PATH}/tourism`;
export const SEARCH_PATH = `${DASHBOARD_PATH}/search`;
export const ACCOUNT_PATH = `${DASHBOARD_PATH}/account`;
export const ADMIN_GEOGRAPHY_PATH = `${DASHBOARD_PATH}/admin-geography`;

function joinPath(base: string, segment?: string): string {
    const seg = segment?.replace(/^\/+|\/+$/g, "") ?? "";
    return seg ? `${base}/${seg}` : base;
}

export function coreReviewPath(segment?: string): string {
    return joinPath(CORE_REVIEW_PATH, segment);
}

export function referencesPath(segment?: string): string {
    return joinPath(REFERENCES_PATH, segment);
}

export function routingAdminPath(segment?: string): string {
    return joinPath(ROUTING_ADMIN_PATH, segment);
}

export function localBasemapPath(segment?: string): string {
    return joinPath(LOCAL_BASEMAP_PATH, segment);
}

export function devMapPath(segment?: string): string {
    return joinPath(DEV_MAP_PATH, segment);
}

export function transportPath(segment?: string): string {
    return joinPath(TRANSPORT_PATH, segment);
}

export function usersPath(segment?: string): string {
    return joinPath(USERS_PATH, segment);
}

export function userAnalyticsPath(segment?: string): string {
    return joinPath(USER_ANALYTICS_PATH, segment);
}

export function pointManagementPath(segment?: string): string {
    return joinPath(POINT_MANAGEMENT_PATH, segment);
}

export function reportsPath(segment?: string): string {
    return joinPath(REPORTS_PATH, segment);
}

export function reviewsPath(segment?: string): string {
    return joinPath(REVIEWS_PATH, segment);
}

export function fieldSurveyPath(segment?: string): string {
    return joinPath(FIELD_SURVEY_PATH, segment);
}

export function communityPath(segment?: string): string {
    return joinPath(COMMUNITY_PATH, segment);
}

export function tourismPath(segment?: string): string {
    return joinPath(TOURISM_PATH, segment);
}

export function searchPath(segment?: string): string {
    return joinPath(SEARCH_PATH, segment);
}

export function accountPath(segment?: string): string {
    return joinPath(ACCOUNT_PATH, segment);
}

export function adminGeographyPath(segment?: string): string {
    return joinPath(ADMIN_GEOGRAPHY_PATH, segment);
}
