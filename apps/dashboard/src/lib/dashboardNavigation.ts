import {
    Activity,
    Bus,
    CircleUser,
    Coins,
    Flag,
    Globe2,
    Library,
    LineChart,
    MapPinned,
    MessagesSquare,
    Star,
    Route,
    ScanSearch,
    Search,
    Users,
    Map,
    type LucideIcon,
} from "lucide-react";

import {
    accountPath,
    communityPath,
    coreReviewPath,
    localBasemapPath,
    devMapPath,
    pointManagementPath,
    referencesPath,
    reportsPath,
    reviewsPath,
    fieldSurveyPath,
    routingAdminPath,
    searchPath,
    tourismPath,
    transportPath,
    userAnalyticsPath,
    usersPath,
    adminGeographyPath,
} from "@/src/lib/dashboardPaths";

export {
    ACCOUNT_PATH,
    ADMIN_GEOGRAPHY_PATH,
    COMMUNITY_PATH,
    CORE_REVIEW_PATH,
    DASHBOARD_PATH,
    DEV_MAP_PATH,
    LOCAL_BASEMAP_PATH,
    POINT_MANAGEMENT_PATH,
    REFERENCES_PATH,
    REPORTS_PATH,
    REVIEWS_PATH,
    FIELD_SURVEY_PATH,
    SEARCH_PATH,
    TOURISM_PATH,
    TRANSPORT_PATH,
    USERS_PATH,
    USER_ANALYTICS_PATH,
    accountPath,
    adminGeographyPath,
    communityPath,
    coreReviewPath,
    localBasemapPath,
    devMapPath,
    pointManagementPath,
    referencesPath,
    reportsPath,
    reviewsPath,
    fieldSurveyPath,
    searchPath,
    tourismPath,
    transportPath,
    userAnalyticsPath,
    usersPath,
} from "@/src/lib/dashboardPaths";

export type DashboardSidebarModuleKey =
    | "core-review"
    | "admin-geography"
    | "references"
    | "routing"
    | "local-basemap"
    | "dev-map"
    | "transport"
    | "search"
    | "reports"
    | "reviews"
    | "field-survey"
    | "community"
    | "tourism"
    | "users"
    | "user-analytics"
    | "point-management"
    | "account";

export type FamilyNavTab = {
    label: string;
    segment: string;
    match?: "exact" | "prefix";
};

export type DashboardSidebarItem = {
    moduleKey: DashboardSidebarModuleKey;
    href: string;
    label: string;
    Icon: LucideIcon;
};

/** Non-sensitive dashboard modules exposed to read-only dashboard viewers. */
export const viewerDashboardModules: ReadonlySet<DashboardSidebarModuleKey> = new Set([
    "core-review",
    "admin-geography",
    "references",
    "routing",
    "transport",
    "search",
    "account",
]);

export function sidebarModuleFromPathname(pathname: string): DashboardSidebarModuleKey | null {
    const match = pathname.match(/^\/dashboard\/([^/]+)/);
    const key = match?.[1];
    if (key === "core-verification") {
        return "core-review";
    }
    if (
        key === "core-review" ||
        key === "admin-geography" ||
        key === "references" ||
        key === "routing" ||
        key === "local-basemap" ||
        key === "dev-map" ||
        key === "transport" ||
        key === "search" ||
        key === "reports" ||
        key === "reviews" ||
        key === "field-survey" ||
        key === "community" ||
        key === "tourism" ||
        key === "users" ||
        key === "user-analytics" ||
        key === "point-management" ||
        key === "account"
    ) {
        return key;
    }
    return null;
}

export const dashboardSidebarItems: readonly DashboardSidebarItem[] = [
    {
        moduleKey: "core-review",
        href: coreReviewPath(),
        label: "Core review",
        Icon: ScanSearch,
    },
    {
        moduleKey: "admin-geography",
        href: adminGeographyPath(),
        label: "Admin geography",
        Icon: Globe2,
    },
    {
        moduleKey: "references",
        href: referencesPath(),
        label: "Reference data",
        Icon: Library,
    },
    {
        moduleKey: "routing",
        href: routingAdminPath(),
        label: "Routing",
        Icon: Route,
    },
    {
        moduleKey: "local-basemap",
        href: localBasemapPath(),
        label: "Local Basemap",
        Icon: Map,
    },
    {
        moduleKey: "dev-map",
        href: devMapPath(),
        label: "Dev Map",
        Icon: MapPinned,
    },
    {
        moduleKey: "transport",
        href: transportPath(),
        label: "Transport",
        Icon: Bus,
    },
    {
        moduleKey: "search",
        href: searchPath(),
        label: "Search",
        Icon: Search,
    },
    {
        moduleKey: "reports",
        href: reportsPath(),
        label: "Reports",
        Icon: Flag,
    },
    {
        moduleKey: "reviews",
        href: reviewsPath(),
        label: "Reviews",
        Icon: Star,
    },
    {
        moduleKey: "field-survey",
        href: fieldSurveyPath(),
        label: "Field Survey",
        Icon: Activity,
    },
    {
        moduleKey: "community",
        href: communityPath(),
        label: "Community Moderation",
        Icon: MessagesSquare,
    },
    {
        moduleKey: "tourism",
        href: tourismPath("places"),
        label: "Tourism",
        Icon: MapPinned,
    },
];

/** "User Management" sidebar section (auth users, analytics, manual points). */
export const userManagementSidebarItems: readonly DashboardSidebarItem[] = [
    {
        moduleKey: "users",
        href: usersPath(),
        label: "Users",
        Icon: Users,
    },
    {
        moduleKey: "user-analytics",
        href: userAnalyticsPath(),
        label: "Analytics",
        Icon: LineChart,
    },
    {
        moduleKey: "point-management",
        href: pointManagementPath(),
        label: "Point Management",
        Icon: Coins,
    },
];

/** Signed-in profile and logout. Shown to every dashboard role, including viewers. */
export const accountSidebarItem: DashboardSidebarItem = {
    moduleKey: "account",
    href: accountPath(),
    label: "Account",
    Icon: CircleUser,
};

/** Core review top nav. */
export const coreReviewTabs: readonly FamilyNavTab[] = [
    { label: "Overview", segment: "", match: "exact" },
    { label: "Buildings", segment: "buildings" },
    { label: "Places", segment: "places" },
    { label: "Recommendations", segment: "recommendations" },
    { label: "Settlements", segment: "settlements" },
    { label: "Roads", segment: "roads" },
    { label: "Land areas", segment: "land-areas" },
    { label: "Water lines", segment: "water-lines" },
    { label: "Water polygons", segment: "water-polygons" },
    { label: "Addresses", segment: "addresses" },
    { label: "Admin areas", segment: "admin-areas" },
];


export const referencesTabs: readonly FamilyNavTab[] = [
    { label: "Overview", segment: "", match: "exact" },
];

export const transportTabs: readonly FamilyNavTab[] = [
    { label: "Overview", segment: "", match: "exact" },
    { label: "Routes", segment: "routes" },
    { label: "Stops", segment: "stops" },
    { label: "Infrastructure", segment: "infrastructure" },
    { label: "Imports", segment: "imports" },
];

export const searchTabs: readonly FamilyNavTab[] = [
    { label: "Overview", segment: "", match: "exact" },
    { label: "Documents", segment: "documents" },
    { label: "Aliases", segment: "aliases" },
    { label: "Failed Searches", segment: "failed-searches" },
    { label: "Name Pairs", segment: "name-pairs" },
    { label: "Analytics", segment: "analytics" },
    { label: "Index Health", segment: "index-health" },
];

export const tourismTabs: readonly FamilyNavTab[] = [
    { label: "Attractions", segment: "places" },
    { label: "Activities", segment: "activities" },
    { label: "Events", segment: "events" },
    { label: "Foods", segment: "foods" },
    { label: "Guides", segment: "guides" },
    { label: "Advisories", segment: "advisories" },
    { label: "Research", segment: "research" },
    { label: "Candidates", segment: "candidates" },
    { label: "Ranking", segment: "ranking" },
];

function joinPath(base: string, segment?: string): string {
    const seg = segment?.replace(/^\/+|\/+$/g, "") ?? "";
    return seg ? `${base}/${seg}` : base;
}

export function familyTabsToHref(
    basePath: string,
    tabs: readonly FamilyNavTab[]
): { label: string; href: string; match?: "exact" | "prefix" }[] {
    return tabs.map((tab) => ({
        label: tab.label,
        href: joinPath(basePath, tab.segment || undefined),
        match: tab.match ?? (tab.segment === "" ? "exact" : "prefix"),
    }));
}
