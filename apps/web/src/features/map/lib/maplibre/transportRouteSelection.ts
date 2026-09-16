import type { PublicSearchResult } from '@/features/poi/api/publicMapApi';

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Build the existing API/search-preview selection contract from minimal MVT properties. */
export function transportRouteSelectionFromFeature(
  feature: { readonly properties?: unknown },
): PublicSearchResult | null {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const publicId = readString(properties.route_public_id);
  const routeCode = readString(properties.route_code);
  if (!publicId || !routeCode) return null;
  return {
    id: publicId,
    publicId,
    entityId: publicId,
    entityType: 'transport_route',
    type: 'transport_route',
    displayName: readString(properties.public_name) ?? routeCode,
    subtitle: routeCode,
    mode: readString(properties.mode),
    routeCode,
    reviewStatus: readString(properties.review_status),
    hasGeometry: true,
    geometryType: 'LineString',
  };
}
