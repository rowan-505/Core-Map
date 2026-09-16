"use client";

import { useCallback, useEffect, useState } from "react";

import { isAbortError } from "@/src/lib/api";

import { loadDevMapInspectorDetail, mapLoadError } from "./devMapInspectorAdapters";
import type { DevMapInspectorLoadState } from "./devMapInspectorTypes";
import type { DevMapSelection } from "./devMapSelection";

export type UseDevMapInspectorDetailResult = {
    loadState: DevMapInspectorLoadState;
    refreshDetail: () => void;
};

/**
 * Fetches adapter detail after selection. Aborts in-flight request on reselect/close.
 * Does not move the map camera.
 */
export function useDevMapInspectorDetail(
    selection: DevMapSelection | null,
): UseDevMapInspectorDetailResult {
    const [state, setState] = useState<DevMapInspectorLoadState>({ status: "idle" });
    const [refreshToken, setRefreshToken] = useState(0);

    const refreshDetail = useCallback(() => {
        setRefreshToken((n) => n + 1);
    }, []);

    useEffect(() => {
        if (!selection) {
            setState({ status: "idle" });
            return;
        }

        const controller = new AbortController();
        setState({ status: "loading", selection });

        void loadDevMapInspectorDetail(selection, controller.signal)
            .then((detail) => {
                if (controller.signal.aborted) return;
                setState({ status: "ready", selection, detail });
            })
            .catch((error) => {
                if (controller.signal.aborted || isAbortError(error)) return;
                const mapped = mapLoadError(error);
                setState({
                    status: "error",
                    selection,
                    code: mapped.code,
                    message: mapped.message,
                });
            });

        return () => {
            controller.abort();
        };
    }, [selection, refreshToken]);

    return { loadState: state, refreshDetail };
}
