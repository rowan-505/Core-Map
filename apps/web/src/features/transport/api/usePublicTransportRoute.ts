import { useQuery } from '@tanstack/react-query';
import { getPublicTransportRouteDetail } from './publicTransportApi';

/** Cached, abortable full route detail for a selected Martin route feature. */
export function usePublicTransportRoute(routeCode: string | null | undefined) {
  const code = routeCode?.trim() ?? '';
  return useQuery({
    queryKey: ['public-transport-route', code],
    queryFn: ({ signal }) => getPublicTransportRouteDetail(code, signal),
    enabled: code.length > 0,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}
