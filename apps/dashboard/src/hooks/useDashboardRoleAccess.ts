"use client";

import { useEffect, useState } from "react";

import { DASHBOARD_AUTH_CHANGED_EVENT, getAccessToken } from "@/src/lib/authTokenStorage";
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
        // Memory tokens do not fire storage events; refresh on focus/pageshow
        // and when another tab shares a token over BroadcastChannel.
        window.addEventListener("focus", refreshRoles);
        window.addEventListener("pageshow", refreshRoles);
        window.addEventListener(DASHBOARD_AUTH_CHANGED_EVENT, refreshRoles);
        return () => {
            window.removeEventListener("focus", refreshRoles);
            window.removeEventListener("pageshow", refreshRoles);
            window.removeEventListener(DASHBOARD_AUTH_CHANGED_EVENT, refreshRoles);
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
