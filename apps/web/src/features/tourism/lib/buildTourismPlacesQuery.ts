import type { TourismPlacesListQuery } from '../api/tourismApiTypes';

export function buildTourismPlacesQuery(query: TourismPlacesListQuery): string {
  const params = new URLSearchParams();
  params.set('mode', query.mode);
  if (query.cursor) params.set('cursor', query.cursor);
  if (typeof query.limit === 'number') params.set('limit', String(query.limit));
  if (query.lang) params.set('lang', query.lang);
  if (query.tourism_type) params.set('tourism_type', query.tourism_type);
  if (typeof query.lat === 'number') params.set('lat', String(query.lat));
  if (typeof query.lng === 'number') params.set('lng', String(query.lng));
  if (typeof query.radius_m === 'number') params.set('radius_m', String(query.radius_m));
  if (query.bbox) params.set('bbox', query.bbox);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
