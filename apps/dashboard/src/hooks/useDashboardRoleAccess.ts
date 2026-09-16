"use client";

import { useEffect, useState } from "react";

import { getAccessToken } from "@/src/lib/authTokenStorage";
import {
    canDashboardWrite,
    hasDashboardAccess,
    isViewer,
    rolesFromJwtAccessToken,
} from "@/src/lib/jwtRoles";

function readRolesFromMemory(): string[] {
    if (typeof window === "undefined") {
        return [];
    }
    return rolesFromJwtAccessToken(getAccessToken());
}

export function useDashboardRoleAccess() {
    const [roles, setRoles] = useState<string[]>([]);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const refreshRoles = () => {
            setRoles(readRolesFromMemory());
            setReady(true);
        };
        refreshRoles();
        // Memory tokens do not fire storage events; refresh on focus/pageshow.
        window.addEventListener("focus", refreshRoles);
        const onPageShow = () => {
            refreshRoles();
        };
        window.addEventListener("pageshow", onPageShow);
        return () => {
            window.removeEventListener("focus", refreshRoles);
            window.removeEventListener("pageshow", onPageShow);
        };
    }, []);

    return {
        roles,
        ready,
        hasAccess: hasDashboardAccess(roles),
        canWrite: canDashboardWrite(roles),
        isViewer: isViewer(roles),
    };
}
