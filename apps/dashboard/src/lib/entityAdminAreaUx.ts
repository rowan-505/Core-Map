"use client";

import { getAccessToken } from "@/src/lib/authTokenStorage";
import { rolesFromJwtAccessToken } from "@/src/lib/jwtRoles";

/** Matches API ENTITY_ADMIN_AREA_OVERRIDE_ROLES — admin may save geometry–township mismatches. */
export function canOverrideEntityAdminAreaGeometryMismatch(): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    const roles = rolesFromJwtAccessToken(getAccessToken());
    return roles.includes("admin");
}
